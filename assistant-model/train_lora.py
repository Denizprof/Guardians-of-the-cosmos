"""Fine-tune Qwen3-1.7B with LoRA to be the Global SAR chatbot.

    python assistant-model/train_lora.py            # about 3 epochs on an 8 GB GPU
    python assistant-model/train_lora.py --smoke    # 20 steps, to check that everything runs

What is trained: a small set of adapter weights (LoRA) on top of the published Qwen3-1.7B weights. The base
model is not ours and is not retrained from scratch. The adapter teaches one skill: answer only from the
SOURCES in the prompt, cite them, and reply NO_ANSWER when they do not contain the answer.
Whether that worked is measured by evaluate.py on data the model never saw; this script proves nothing by itself.
"""
from __future__ import annotations

import argparse
import json
import math
import time

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, get_cosine_schedule_with_warmup

from common import BASE_MODEL, ROOT, load_jsonl, prompt_text

parser = argparse.ArgumentParser()
parser.add_argument("--base", default=BASE_MODEL)
parser.add_argument("--out", default=str(ROOT / "adapters" / "global-sar-lora"))
parser.add_argument("--epochs", type=float, default=3.0)
parser.add_argument("--lr", type=float, default=2e-4)
parser.add_argument("--batch", type=int, default=1, help="1 fits an 8 GB GPU; a batch of 2 runs out of memory on the longest prompts")
parser.add_argument("--accum", type=int, default=16)
parser.add_argument("--max-len", type=int, default=1100)
parser.add_argument("--rank", type=int, default=16)
parser.add_argument("--gpu-load", type=float, default=1.0, help="share of the time the GPU works, e.g. 0.5 = pause as long as each step took (cooler and quieter, twice as slow)")
parser.add_argument("--qlora", action="store_true", help="4-bit base model: fits a 4 GB GPU (needs: pip install bitsandbytes)")
parser.add_argument("--smoke", action="store_true")
args = parser.parse_args()

torch.manual_seed(20261114)
device = "cuda" if torch.cuda.is_available() else "cpu"
if device == "cpu" and not args.smoke:
    raise SystemExit("No CUDA GPU found. Training on CPU would take days; use --smoke only to test the code path.")

tokenizer = AutoTokenizer.from_pretrained(args.base)
# bf16 needs an Ampere or newer GPU (RTX 30xx+). Older cards (GTX 16xx, RTX 20xx) use fp16.
use_bf16 = device == "cuda" and torch.cuda.is_bf16_supported()
amp_dtype = torch.bfloat16 if use_bf16 else torch.float16
if args.qlora:
    # 4-bit base weights (about 1.2 GB for Qwen3-1.7B) so training fits a 4 GB GPU. The LoRA adapter itself stays in fp32.
    from transformers import BitsAndBytesConfig
    model = AutoModelForCausalLM.from_pretrained(
        args.base, device_map={"": 0}, torch_dtype=amp_dtype, low_cpu_mem_usage=True,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=amp_dtype),
    )
    # prepare_model_for_kbit_training would upcast the 600 MB embedding matrix to fp32 (does not fit 4 GB); do the
    # two things that matter by hand: gradient checkpointing and gradients that can reach the adapter.
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
else:
    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=amp_dtype if device == "cuda" else torch.float32)
    model.to(device)
    model.gradient_checkpointing_enable()
model.config.use_cache = False
scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda" and not use_bf16)
model = get_peft_model(
    model,
    LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
               target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]),
)
model.print_trainable_parameters()


def encode(example: dict) -> dict:
    """Prompt tokens are masked out of the loss (-100): the model is graded only on the answer it must write."""
    prompt = tokenizer(prompt_text(tokenizer, example["messages"][:-1]), add_special_tokens=False)["input_ids"]
    answer = tokenizer(example["messages"][-1]["content"] + "<|im_end|>", add_special_tokens=False)["input_ids"]
    ids = (prompt + answer)[-args.max_len:] if len(prompt) + len(answer) > args.max_len else prompt + answer
    labels = ([-100] * len(prompt) + answer)[-len(ids):]
    return {"input_ids": ids, "labels": labels}


def answer_loss(batch: dict) -> torch.Tensor:
    """Cross-entropy on the answer tokens only. The model computes logits for just the last positions (the answer
    sits at the end of each example, batch size 1 has no padding), because logits for all ~900 positions over a
    152k-word vocabulary alone need more memory than a 4 GB GPU has."""
    labels = batch["labels"][0]
    n = int((labels != -100).sum().item())
    out = model(input_ids=batch["input_ids"], attention_mask=batch["attention_mask"], logits_to_keep=n + 1)
    logits = out.logits[0, :-1].float()
    return torch.nn.functional.cross_entropy(logits, batch["input_ids"][0, -n:])


def batches(rows: list[dict], size: int):
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        # round the length up to a multiple of 128: a handful of tensor shapes instead of hundreds keeps the GPU
        # memory pool from fragmenting (see the note at the empty_cache call in the training loop)
        width = max(len(r["input_ids"]) for r in chunk) if size == 1 else -(-max(len(r["input_ids"]) for r in chunk) // 128) * 128
        pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id
        yield {
            "input_ids": torch.tensor([r["input_ids"] + [pad] * (width - len(r["input_ids"])) for r in chunk], device=device),
            "attention_mask": torch.tensor([[1] * len(r["input_ids"]) + [0] * (width - len(r["input_ids"])) for r in chunk], device=device),
            "labels": torch.tensor([r["labels"] + [-100] * (width - len(r["labels"])) for r in chunk], device=device),
        }


train = [encode(e) for e in load_jsonl("train")]
val = [encode(e) for e in load_jsonl("val")]
if args.smoke:
    train, val = train[:40], val[:8]
truncated = sum(1 for r in train if len(r["input_ids"]) >= args.max_len)
print(f"train {len(train)} examples, val {len(val)}; longest {max(len(r['input_ids']) for r in train)} tokens; {truncated} truncated to {args.max_len}", flush=True)

steps_per_epoch = math.ceil(len(train) / (args.batch * args.accum))
total_steps = 20 if args.smoke else math.ceil(steps_per_epoch * args.epochs)
optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.0)
scheduler = get_cosine_schedule_with_warmup(optimizer, max(1, total_steps // 20), total_steps)


@torch.no_grad()
def val_loss() -> float:
    model.eval()
    total, count = 0.0, 0
    for batch in batches(val, args.batch):
        with torch.autocast(device_type=device, dtype=amp_dtype, enabled=device == "cuda"):
            total += (answer_loss(batch) if args.batch == 1 else model(**batch).loss).item()
        count += 1
    model.train()
    return total / max(1, count)


history = []
generator = torch.Generator().manual_seed(20261114)
step, started = 0, time.time()
model.train()
while step < total_steps:
    order = torch.randperm(len(train), generator=generator).tolist()
    # sort inside chunks so a batch holds similar lengths (less padding), keeping the epoch order random
    rows = [train[i] for i in order]
    running = 0.0
    for n, batch in enumerate(batches(rows, args.batch), start=1):
        began = time.time()
        with torch.autocast(device_type=device, dtype=amp_dtype, enabled=device == "cuda"):
            loss = answer_loss(batch) if args.batch == 1 else model(**batch).loss
        scaler.scale(loss / args.accum).backward()
        running += loss.item()
        # Examples of different lengths fragment PyTorch's memory pool. On Windows the pool then quietly spills into
        # shared (system) memory instead of failing, and every step becomes about ten times slower. Hand the pool
        # back whenever it has grown well past what one example needs.
        if device == "cuda" and torch.cuda.memory_reserved() > 0.8 * torch.cuda.get_device_properties(0).total_memory:
            torch.cuda.empty_cache()
        if step == 0 and n <= 6 and device == "cuda":  # early sign of trouble: an example should take well under a second
            torch.cuda.synchronize()
            print(f"  example {n}: {batch['input_ids'].shape[1]} tokens, {time.time() - began:.2f} s, peak GPU memory {torch.cuda.max_memory_allocated() / 1e9:.1f} GB", flush=True)
        if 0 < args.gpu_load < 1 and device == "cuda":
            torch.cuda.synchronize()
            time.sleep((time.time() - began) * (1 / args.gpu_load - 1))
        if n % args.accum == 0:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            if step % 10 == 0 or step == total_steps:
                print(f"step {step}/{total_steps}  train loss {running / args.accum:.4f}  {(time.time() - started) / 60:.1f} min", flush=True)
            running = 0.0
            if step % 25 == 0:
                model.save_pretrained(args.out)  # a crash late in training must not lose the work so far
            if step % steps_per_epoch == 0 or step == total_steps:
                v = val_loss()
                history.append({"step": step, "val_loss": round(v, 4)})
                print(f"  validation loss {v:.4f}", flush=True)
            if step >= total_steps:
                break

model.save_pretrained(args.out)
tokenizer.save_pretrained(args.out)
(ROOT / "adapters").mkdir(exist_ok=True)
with open(f"{args.out}/training.json", "w", encoding="utf-8") as f:
    json.dump({"base_model": args.base, "epochs": args.epochs, "lr": args.lr, "rank": args.rank, "steps": step, "train_examples": len(train),
               "minutes": round((time.time() - started) / 60, 1), "history": history, "smoke": args.smoke}, f, indent=1)
print(f"Adapter saved to {args.out}. Now run evaluate.py: a low loss is not proof that the answers are right.")
