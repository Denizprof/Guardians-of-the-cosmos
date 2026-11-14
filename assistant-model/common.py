"""Shared by train_lora.py and evaluate.py: data loading, the prompt, and the same output checks the app applies.

The prompt itself is NOT built here. build_dataset.mjs writes ready-made chat messages using the app's own code
(web/src/assistant/local/core.ts), so training, evaluation and the browser all see one format.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
BASE_MODEL = "Qwen/Qwen3-1.7B"
NO_ANSWER = "NO_ANSWER"
MARKER = re.compile(r"\[\[([A-Za-z0-9._:/#-]{1,200})\]\]")


def load_jsonl(name: str) -> list[dict]:
    path = DATA / f"{name}.jsonl"
    if not path.exists():
        raise SystemExit(f"{path} is missing. Run: node assistant-model/build_kb.mjs && node assistant-model/build_dataset.mjs")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def prompt_text(tokenizer, messages: list[dict]) -> str:
    """The text the model sees before it answers: system + user turns, then the start of the assistant turn.
    enable_thinking=False makes Qwen3 answer directly; the browser worker passes the same flag."""
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)


def fold(text: str) -> str:
    text = text.replace("İ", "i").replace("I", "i").replace("ı", "i").lower()
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", fold(MARKER.sub(" ", text))) if len(w) > 1]


def parse_output(raw: str, source_ids: list[str]) -> dict:
    """Mirror of parseOutput() in core.ts: what the app would do with this model output."""
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.S)
    text = re.sub(r"<think>.*$", "", text, flags=re.S).strip()
    if not text:
        return {"kind": "invalid", "cited": [], "text": ""}
    if NO_ANSWER in text.upper() and len(text) < 40:
        return {"kind": "none", "cited": [], "text": ""}
    cited: list[str] = []
    for marker in MARKER.findall(text):
        if marker not in source_ids:
            return {"kind": "invalid", "cited": [], "text": ""}
        if marker not in cited:
            cited.append(marker)
    if not cited:
        return {"kind": "invalid", "cited": [], "text": ""}
    return {"kind": "answer", "cited": cited, "text": text}


def sources_of(example: dict) -> dict[str, str]:
    """id -> text of every source in the example's prompt."""
    user = example["messages"][1]["content"]
    block = user.split("SOURCES\n", 1)[1].split("\n\nLEVEL\n", 1)[0]
    out: dict[str, str] = {}
    for line in block.split("\n"):
        m = re.match(r"\[\[([^\]]+)\]\] (.*)", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out
