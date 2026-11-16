# The Global SAR chatbot: knowledge base, training and browser export

The chat in the app ("Ask" in the top bar, and "Ask about this investigation") runs entirely in the visitor's
browser. This folder holds what it is built from.

## How it answers

1. **Sources only.** For each question the app picks sources: checked knowledge records
   (`web/public/data/assistant/kb.json`) and the items open in the view (the investigation, its layers, probed
   products). Nothing else may be used.
2. **Two modes, always labelled.**
   - *Knowledge-base mode* (works everywhere, no download): the best matching record is quoted as written.
   - *Model mode* (optional, WebGPU): a fine-tuned Qwen3-1.7B words the answer from those same sources.
3. **Checked before it is shown.** A model answer is shown only if every `[[citation]]` names a source it was
   given. Otherwise it is discarded and the record is quoted instead. With no source, the model is not asked
   at all and the chat says it has no checked source.

The model never supplies facts; it only words them. Facts live in the knowledge base, where each has a source
and can be corrected without retraining.

## The knowledge base (114 records)

`node assistant-model/build_kb.mjs` builds it from:

| Source | Records | Checked how |
| --- | --- | --- |
| The app's own vetted text: radar explainers, the five investigations, 20 satellite layers and their legends | 72 | Copied as is from `web/src/content/explain.ts`, `events.json`, `layers.json` |
| App guide (`knowledge/app.json`): the tools, labels, credits | 18 | Hand-written from what the app shows; English and Turkish |
| General SAR / NISAR facts (`knowledge/verified_sar.json`) | 24 | Each checked against its cited NASA / USGS / NOAA / Earth Engine page on 2026-11-14 |

The 24 general facts come from 83 legacy records supplied with the first prototype. Of those, 41 had no source
and were dropped; of the 42 with a source, 6 were supported as written, 18 were trimmed to what the source
actually says, 10 were not supported by the page they cited and 8 cited a NASA PDF that no longer exists. Only
the 24 supported or trimmed ones are used. `verified_sar.json` keeps the verdict and the evidence for all 42.

## Training

- **Base model:** `Qwen/Qwen3-1.7B` (Apache-2.0, Alibaba Cloud). Not trained by this project.
- **What we trained:** a LoRA adapter (17 M parameters, 1 % of the model), 2 epochs, 15 minutes on an RTX 5070
  Laptop GPU (8 GB).
- **What it teaches:** a skill, not facts: answer only from the SOURCES in the prompt, mark the source used,
  reply `NO_ANSWER` when they do not hold the answer. Every target answer in the training data is the text of
  a source, so the data cannot teach a false fact.
- **Data:** `node assistant-model/build_dataset.mjs` writes the examples. The prompt is built by the app's own
  code (`web/src/assistant/local/core.ts`), so training and the browser use one format.
- **The run reported below** used an earlier build of the data: 1,195 training, 171 validation and 212 test
  examples. The knowledge base and the question lists have grown since, so the script writes more examples
  today; the current counts and held-out records are in `data/manifest.json`. The adapter has **not** been
  retrained or re-measured on the current data.

The test records are chosen by position in the knowledge base, so they move when it changes. An adapter must
only be measured on the data it was trained with: after rebuilding the data, train again before running
`evaluate.py --adapter`, or the test set may hold records the adapter has already seen.
`node assistant-model/build_dataset.mjs --manifest-only` updates `data/manifest.json` and leaves the `.jsonl`
files as they are.

## Results (held-out test set, 212 questions)

The test set uses knowledge records, one whole investigation and decline-questions that were never seen in
training. Each output is judged by what the app would do with it (`evaluate.py`; raw outputs can be
regenerated with it).

| | Untrained Qwen3-1.7B | Fine-tuned |
| --- | --- | --- |
| Answerable (145): cites exactly the right source | 58 % | 75 % |
| Answerable: right source and at least 85 % of the words come from the sources | 21 % | 75 % |
| Answerable: wrongly declines | 3 % | 19 % |
| Answerable: bad or missing citation (discarded by the app) | 20 % | 0 % |
| No answer in sources (67): declines | 36 % | 98.5 % |
| No answer in sources: answers anyway with a valid-looking citation | 49 % | 1.5 % |

Reading this honestly:

- Training fixed the dangerous behaviour: the untrained model answered half of the questions it had no source
  for; the fine-tuned one does so 1.5 % of the time (1 of 67).
- It became **too cautious**: it declines about one answerable question in five. The app compensates: when the
  model declines but a record matched the question, that record is shown, labelled as the closest match.
- These numbers are for the full-precision model in Python. The browser runs a 4-bit version of it, which was
  checked to load and answer in the app but was **not** re-measured on the test set.
- 212 questions from one small knowledge base is a narrow test. It says nothing about questions outside it.

Full reports: `reports/base.json`, `reports/tuned.json`.

## Reproduce

```bash
# 1. knowledge base and data (Node 22.6+)
node assistant-model/build_kb.mjs
node assistant-model/build_dataset.mjs

# 2. training environment (Python 3.11 or 3.12; install the PyTorch build for your GPU first)
pip install -r assistant-model/requirements.txt

# 3. measure the untrained model, train, measure again
python assistant-model/evaluate.py --name base
python assistant-model/train_lora.py --epochs 2      # add --gpu-load 0.5 to run the GPU at half load
python assistant-model/evaluate.py --name tuned --adapter assistant-model/adapters/global-sar-lora

# 4. export for the browser (also needs: pip install "optimum[onnxruntime]" onnx onnx-ir)
python assistant-model/export_onnx.py --adapter assistant-model/adapters/global-sar-lora
```

Downloaded weights, the adapter, the generated data and the export are git-ignored (they are large and
rebuilt by the steps above).

## Putting the model on the site

The export step writes `assistant-model/export/global-sar-qwen3-1.7b-onnx/` (about 1.7 GB).

1. Create a free account at huggingface.co and a new **model** repository (public).
2. Upload the contents of that folder (the web upload works; the `onnx/` folder holds the large file).
3. In the GitHub repository, add a repository **variable** `ASSISTANT_MODEL` with the repository id
   (`your-name/global-sar-qwen3-1.7b-onnx`). The Pages workflow passes it to the build as
   `VITE_ASSISTANT_MODEL`. Without it the site runs in knowledge-base mode.

For local testing without an upload, copy the export folder to `web/public/models/` and start the app with
`VITE_ASSISTANT_MODEL=./models/global-sar-qwen3-1.7b-onnx`.

## Known limits

- Model mode needs WebGPU (recent Chrome or Edge on desktop; not most phones) and a 1.7 GB download.
- The export keeps arithmetic in 32-bit floats. A fully 16-bit export is smaller but produced garbage on
  WebGPU in our tests, and a fully 32-bit one exceeds the 2 GB a browser can load (`export_onnx.py` explains).
- English and Turkish. Turkish answers exist only for records that have a Turkish text (the app guide and the
  general SAR facts).
- The assistant cannot predict earthquakes or any other event, and says so.
