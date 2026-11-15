"""export_onnx.py must not reuse a merged/ONNX model built from another base model or adapter.

    python -m pytest assistant-model/test_assistant_model_export_cache.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from export_cache import can_reuse, write_stamp  # noqa: E402

BASE = "Qwen/Qwen3-1.7B"


def make_adapter(folder: Path, weights: bytes) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "adapter_model.safetensors").write_bytes(weights)
    (folder / "adapter_config.json").write_text('{"r": 16}', encoding="utf-8")
    return str(folder)


def make_work(tmp_path: Path) -> Path:
    work = tmp_path / "_work"
    (work / "onnx-fp32").mkdir(parents=True)
    (work / "onnx-fp32" / "model.onnx").write_bytes(b"onnx")
    return work


def test_same_base_and_adapter_is_reused(tmp_path):
    work, a = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a")
    write_stamp(work, BASE, a)
    assert can_reuse(work, BASE, a)


def test_another_adapter_is_not_reused(tmp_path):
    work, a, b = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a"), make_adapter(tmp_path / "b", b"weights-a")
    write_stamp(work, BASE, a)
    assert not can_reuse(work, BASE, b)


def test_no_adapter_is_not_reused_for_an_adapter_build_and_the_reverse(tmp_path):
    work, a = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a")
    write_stamp(work, BASE, a)
    assert not can_reuse(work, BASE, None)
    write_stamp(work, BASE, None)
    assert can_reuse(work, BASE, None)
    assert not can_reuse(work, BASE, a)


def test_another_base_is_not_reused(tmp_path):
    work, a = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a")
    write_stamp(work, BASE, a)
    assert not can_reuse(work, "Qwen/Qwen3-0.6B", a)


def test_a_retrained_adapter_in_the_same_folder_is_not_reused(tmp_path):
    work, a = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a")
    write_stamp(work, BASE, a)
    make_adapter(tmp_path / "a", b"weights-b")  # same folder, same size, other bytes
    assert not can_reuse(work, BASE, a)


def test_a_model_without_a_stamp_is_not_reused(tmp_path):
    work, a = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a")
    assert not can_reuse(work, BASE, a)  # e.g. left by an interrupted export, or by an older version of the script


def test_a_stamp_without_a_model_is_not_reused(tmp_path):
    work, a = make_work(tmp_path), make_adapter(tmp_path / "a", b"weights-a")
    write_stamp(work, BASE, a)
    (work / "onnx-fp32" / "model.onnx").unlink()
    assert not can_reuse(work, BASE, a)


def test_export_script_decides_through_can_reuse_and_says_when_it_skips():
    """The script itself needs the training environment, so its wiring is checked in the source."""
    src = (HERE / "export_onnx.py").read_text(encoding="utf-8")
    assert 'if not (fp32 / "model.onnx").exists():' not in src
    assert re.search(r"can_reuse\(work, args\.base, args\.adapter\)", src)
    assert "skipped" in src and "reusing" in src
    assert src.index("main_export(") < src.index("write_stamp(work, args.base, args.adapter)")
