"""Turn the fine-tuned chatbot into files a browser can run (ONNX, 4-bit weights, for WebGPU via transformers.js).

    python assistant-model/export_onnx.py --adapter assistant-model/adapters/global-sar-lora

Steps: merge the LoRA adapter into the base weights -> export to ONNX -> quantize the big weight matrices to
4 bits ("q4", which transformers.js loads with dtype "q4"), keeping all arithmetic in 32-bit floats.
Output: assistant-model/export/global-sar-qwen3-1.7b-onnx/  (upload this folder to a Hugging Face model repo).

Quantizing to 4 bits changes the model slightly. evaluate.py measures the full-precision model, not this file;
the browser test is what shows the exported model answering in the app.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import onnx
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from common import BASE_MODEL, ROOT

parser = argparse.ArgumentParser()
parser.add_argument("--base", default=BASE_MODEL)
parser.add_argument("--adapter", default=None, help="LoRA adapter folder; omit to export the base model unchanged")
parser.add_argument("--out", default=str(ROOT / "export" / "global-sar-qwen3-1.7b-onnx"))
parser.add_argument("--work", default=str(ROOT / "export" / "_work"))
parser.add_argument("--keep-work", action="store_true")
args = parser.parse_args()

out, work = Path(args.out), Path(args.work)
merged, fp32 = work / "merged", work / "onnx-fp32"
for d in (out / "onnx", merged, fp32):
    d.mkdir(parents=True, exist_ok=True)

# Steps 1 and 2 are skipped when their output is already there (a re-run after a failure in step 3 or 4).
if not (fp32 / "model.onnx").exists():
    # 1. merge
    print("1/4 merging the adapter into the base weights", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=torch.float32)
    if args.adapter:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.adapter).merge_and_unload()
    model.save_pretrained(merged, safe_serialization=True)
    tokenizer.save_pretrained(merged)
    del model

    # 2. ONNX export (full precision, with the key/value cache inputs transformers.js expects)
    print("2/4 exporting to ONNX", flush=True)
    from optimum.exporters.onnx import main_export

    main_export(model_name_or_path=str(merged), output=str(fp32), task="text-generation-with-past", device="cpu", do_validation=False,
                no_post_process=True)  # the post-processing step cannot handle graphs over 2 GB

# 3. quantize the big weight matrices to 4 bits
print("3/4 quantizing to 4-bit weights", flush=True)
import numpy as np
import onnxruntime
from onnx import TensorProto, helper, numpy_helper
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

graph = onnx.load(str(fp32 / "model.onnx"), load_external_data=True)
quantizer = MatMulNBitsQuantizer(graph, block_size=32, is_symmetric=True, accuracy_level=4)
quantizer.process()
model_proto = quantizer.model.model

# 4. Store the token-embedding table as 16-bit floats and cast it back to 32-bit right after the lookup.
# Why not convert the whole model to 16-bit ("q4f16")? We tried: that file opens and answers correctly on CPU,
# but on WebGPU its arithmetic overflows and the model emits garbage. And with everything in 32-bit the file is
# 2.3 GB, over the 2 GB a browser can hold in one buffer. The embedding table is half of that and is only looked
# up, never multiplied, so halving its storage costs almost nothing and keeps all arithmetic in 32-bit.
print("4/4 storing the embedding table in 16-bit floats", flush=True)
g = model_proto.graph
inits = {i.name: i for i in g.initializer}
changed = 0
for node in list(g.node):
    if node.op_type != "Gather" or node.input[0] not in inits:
        continue
    init = inits[node.input[0]]
    if init.data_type != TensorProto.FLOAT or len(init.dims) != 2 or init.dims[0] < 50000:
        continue
    init.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name))
    looked_up = node.output[0]
    node.output[0] = looked_up + "_f16"
    g.node.insert(list(g.node).index(node) + 1, helper.make_node("Cast", [node.output[0]], [looked_up], to=TensorProto.FLOAT, name=node.name + "_to_f32"))
    changed += 1
if changed != 1:
    raise SystemExit(f"expected exactly one token-embedding lookup, found {changed}")

# The weights go into a separate data file: as one file the browser has to hold the whole model in memory twice
# while loading and fails with an out-of-memory error; with a data file it streams them.
target = out / "onnx" / "model_q4.onnx"
data_name = "model_q4.onnx_data"
for stale in (target, target.with_name(data_name)):
    stale.unlink(missing_ok=True)
onnx.save(model_proto, str(target), save_as_external_data=True, all_tensors_to_one_file=True, location=data_name, size_threshold=1024)
size = target.with_name(data_name).stat().st_size
print(f"wrote {target} + {data_name} ({size / 1e6:.0f} MB)", flush=True)
if size >= 2_000_000_000:
    raise SystemExit("the data file is over 2 GB: a browser cannot load it")
# the file must at least open as a valid model here; a type error would otherwise only show up in a visitor's browser
onnxruntime.InferenceSession(str(target), providers=["CPUExecutionProvider"])
print("checked: the exported file opens in ONNX Runtime", flush=True)

for name in ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "chat_template.jinja"]:
    for src_dir in (fp32, merged):
        if (src_dir / name).exists():
            shutil.copy2(src_dir / name, out / name)
            break
# transformers.js needs two things the Python tools do not write where it looks:
#  - the chat template inside tokenizer_config.json (newer transformers saves it as chat_template.jinja only);
#  - a note in config.json that the weights are in a separate data file.
import json

tok_cfg = json.loads((out / "tokenizer_config.json").read_text(encoding="utf-8"))
if "chat_template" not in tok_cfg and (out / "chat_template.jinja").exists():
    tok_cfg["chat_template"] = (out / "chat_template.jinja").read_text(encoding="utf-8")
    (out / "tokenizer_config.json").write_text(json.dumps(tok_cfg, indent=2, ensure_ascii=False), encoding="utf-8")
if "chat_template" not in tok_cfg:
    raise SystemExit("no chat template found: the browser could not build a prompt for this model")
model_cfg = json.loads((out / "config.json").read_text(encoding="utf-8"))
model_cfg["transformers.js_config"] = {"use_external_data_format": {"model_q4.onnx": 1}}
(out / "config.json").write_text(json.dumps(model_cfg, indent=2), encoding="utf-8")

(out / "README.md").write_text(
    "---\nlicense: apache-2.0\nbase_model: Qwen/Qwen3-1.7B\nlibrary_name: transformers.js\n---\n\n"
    "# Global SAR assistant (Qwen3-1.7B + LoRA, ONNX q4)\n\n"
    "Qwen3-1.7B fine-tuned with LoRA to answer only from the sources given in the prompt, cite them, and decline\n"
    "otherwise. Built for the Global SAR web app (https://globalsar.earth/), where it runs in the browser with WebGPU.\n"
    "The base model is Qwen/Qwen3-1.7B (Apache-2.0) by Alibaba Cloud; only the LoRA adapter was trained by this project.\n"
    "It is not a general assistant and must not be used without the app's citation checks.\n",
    encoding="utf-8",
)
if not args.keep_work:
    shutil.rmtree(work, ignore_errors=True)
print(f"Done. Upload the folder {out} to a Hugging Face model repository.")
