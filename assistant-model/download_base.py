"""Download the base model, resuming after dropped connections (a flaky network breaks a 3.4 GB download).
    python assistant-model/download_base.py
"""
import time

from huggingface_hub import snapshot_download

from common import BASE_MODEL

for attempt in range(1, 200):
    try:
        path = snapshot_download(BASE_MODEL, allow_patterns=["*.json", "*.safetensors", "*.txt", "merges.txt", "vocab.json"], max_workers=1)
        print("done:", path, flush=True)
        break
    except Exception as e:  # noqa: BLE001
        print(f"attempt {attempt} failed ({type(e).__name__}); resuming in 5 s", flush=True)
        time.sleep(5)
