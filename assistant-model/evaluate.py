"""Measure the chatbot on questions it never saw in training, with and without the LoRA adapter.

    python assistant-model/evaluate.py --name base
    python assistant-model/evaluate.py --name tuned --adapter assistant-model/adapters/global-sar-lora

Writes assistant-model/reports/<name>.json (+ every raw output in <name>.outputs.jsonl, so anyone can re-check).

The test set (data/test.jsonl) holds knowledge records, one whole investigation and decline-questions that
were kept out of training. For each example we ask what the APP would do with the model's output, using the
same rules as the browser (common.parse_output mirrors core.ts):

  answerable questions (a source holds the answer)
    shown           the answer passes the citation check and is shown
    cites_right     ...and it cites exactly the source(s) that hold the answer
    grounded        ...and at least 85 % of its words come from the sources it was given (no added facts)
    wrongly_declined  the model said NO_ANSWER although the answer was there
    discarded       the output failed the citation check (the app quotes the record instead)
  questions with no answer in the sources (off-topic, predictions, missing record, rule-override attempts)
    declined        the model said NO_ANSWER                      <- correct
    discarded       it answered without a valid citation          <- caught by the app, never shown
    answered_anyway it answered WITH a valid citation             <- the dangerous case: shown to the user
"""
from __future__ import annotations

import argparse
import json
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from common import BASE_MODEL, ROOT, load_jsonl, parse_output, prompt_text, sources_of, words

parser = argparse.ArgumentParser()
parser.add_argument("--name", required=True)
parser.add_argument("--base", default=BASE_MODEL)
parser.add_argument("--adapter", default=None)
parser.add_argument("--split", default="test")
parser.add_argument("--qlora", action="store_true", help="4-bit base model: fits a 4 GB GPU (needs bitsandbytes)")
parser.add_argument("--limit", type=int, default=0)
parser.add_argument("--max-new-tokens", type=int, default=320)
parser.add_argument("--gpu-load", type=float, default=1.0, help="share of the time the GPU works (0.5 = half load, twice as slow)")
args = parser.parse_args()

device = "cuda" if torch.cuda.is_available() else "cpu"
tokenizer = AutoTokenizer.from_pretrained(args.base)
half = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float16
if args.qlora:
    # 4-bit base so it fits a 4 GB GPU; the adapter is applied on top without merging
    from transformers import BitsAndBytesConfig
    model = AutoModelForCausalLM.from_pretrained(
        args.base, device_map={"": 0},
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=half),
    )
else:
    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=half if device == "cuda" else torch.float32).to(device)
if args.adapter:
    from peft import PeftModel
    model = PeftModel.from_pretrained(model, args.adapter)
    if not args.qlora:
        model = model.merge_and_unload()
model.eval()

examples = load_jsonl(args.split)
if args.limit:
    examples = examples[:: max(1, len(examples) // args.limit)][: args.limit]

rows = []
started = time.time()
for i, ex in enumerate(examples, start=1):
    began = time.time()
    inputs = tokenizer(prompt_text(tokenizer, ex["messages"][:-1]), return_tensors="pt", add_special_tokens=False).to(device)
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=args.max_new_tokens, do_sample=False, repetition_penalty=1.05, pad_token_id=tokenizer.eos_token_id)
    if 0 < args.gpu_load < 1 and device == "cuda":
        time.sleep((time.time() - began) * (1 / args.gpu_load - 1))
    raw = tokenizer.decode(out[0, inputs["input_ids"].shape[-1]:], skip_special_tokens=True).strip()
    parsed = parse_output(raw, ex["source_ids"])
    src = sources_of(ex)
    row = {"id": ex["id"], "type": ex["type"], "lang": ex["lang"], "gold": ex["gold"], "output": raw, "kind": parsed["kind"], "cited": parsed["cited"]}
    if parsed["kind"] == "answer":
        allowed = set(words(" ".join(src.values()))) | set(words(ex["messages"][1]["content"].split("QUESTION\n", 1)[1]))
        said = words(parsed["text"])
        row["grounded_share"] = round(sum(1 for w in said if w in allowed) / max(1, len(said)), 3)
        row["cites_right"] = set(parsed["cited"]) == set(ex["gold"])
    rows.append(row)
    if i % 25 == 0:
        print(f"{i}/{len(examples)}  {(time.time() - started) / 60:.1f} min", flush=True)


def rate(part: list[dict], test) -> float | None:
    return round(sum(1 for r in part if test(r)) / len(part), 3) if part else None


def summarize(part: list[dict]) -> dict:
    answerable = [r for r in part if r["gold"]]
    unanswerable = [r for r in part if not r["gold"]]
    return {
        "answerable": {
            "n": len(answerable),
            "shown": rate(answerable, lambda r: r["kind"] == "answer"),
            "cites_right": rate(answerable, lambda r: r["kind"] == "answer" and r["cites_right"]),
            "grounded": rate(answerable, lambda r: r["kind"] == "answer" and r["cites_right"] and r["grounded_share"] >= 0.85),
            "wrongly_declined": rate(answerable, lambda r: r["kind"] == "none"),
            "discarded": rate(answerable, lambda r: r["kind"] == "invalid"),
        },
        "unanswerable": {
            "n": len(unanswerable),
            "declined": rate(unanswerable, lambda r: r["kind"] == "none"),
            "discarded": rate(unanswerable, lambda r: r["kind"] == "invalid"),
            "answered_anyway": rate(unanswerable, lambda r: r["kind"] == "answer"),
        },
    }


report = {
    "name": args.name, "base_model": args.base, "adapter": args.adapter, "split": args.split, "examples": len(rows),
    "minutes": round((time.time() - started) / 60, 1),
    "overall": summarize(rows),
    "by_type": {t: summarize([r for r in rows if r["type"] == t]) for t in sorted({r["type"] for r in rows})},
    "by_language": {lang: summarize([r for r in rows if r["lang"] == lang]) for lang in sorted({r["lang"] for r in rows})},
}
out_dir = ROOT / "reports"
out_dir.mkdir(exist_ok=True)
(out_dir / f"{args.name}.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
(out_dir / f"{args.name}.outputs.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
print(json.dumps(report["overall"], indent=1))
