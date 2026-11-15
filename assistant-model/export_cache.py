"""When may export_onnx.py reuse the merged model and full-precision ONNX file left by an earlier run?

Only when they were built from the same base model and the same adapter weights. export_onnx.py writes a stamp
(source.json) next to them once steps 1 and 2 have finished; a work folder without a matching stamp is rebuilt.
Without this check a retrained adapter, another --adapter or another --base would silently export the old model.

No heavy imports here, so the rule can be tested without the training environment.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

STAMP_NAME = "source.json"
ADAPTER_FILES = ("adapter_model.safetensors", "adapter_config.json")


def _sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def source_stamp(base: str, adapter: str | None) -> str:
    """What the cached files were built from: the base model id, the adapter folder and the adapter's contents."""
    folder = Path(adapter).resolve() if adapter else None
    return json.dumps(
        {
            "base": str(base),
            "adapter": str(folder) if folder else None,
            "adapter_files": {name: _sha256(folder / name) for name in ADAPTER_FILES} if folder else None,
        },
        sort_keys=True,
    )


def can_reuse(work: Path, base: str, adapter: str | None) -> bool:
    """True only if steps 1 and 2 finished earlier for exactly this base model and this adapter."""
    work = Path(work)
    stamp_file = work / STAMP_NAME
    if not (work / "onnx-fp32" / "model.onnx").is_file() or not stamp_file.is_file():
        return False
    return stamp_file.read_text(encoding="utf-8") == source_stamp(base, adapter)


def write_stamp(work: Path, base: str, adapter: str | None) -> None:
    """Call only after the ONNX export has returned, so a half-written model is never taken for a finished one."""
    (Path(work) / STAMP_NAME).write_text(source_stamp(base, adapter), encoding="utf-8")
