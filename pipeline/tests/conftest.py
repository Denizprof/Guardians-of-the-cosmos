"""pytest setup: make pipeline/python importable and provide a local HTTP fixture server.

Everything here is a LOCAL FIXTURE (127.0.0.1) serving synthetic bytes. Nothing talks to ASF or
Earthdata, and no real credential is used (tokens in tests are the literal string "TEST-TOKEN-NOT-REAL").
"""
from __future__ import annotations

import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PIPELINE = HERE.parent
sys.path.insert(0, str(PIPELINE / "python"))

TOKEN = "TEST-TOKEN-NOT-REAL"


class FixtureServer:
    """Range-capable file server with scriptable misbehaviour.

    fail_first:   respond `fail_code` to the first N requests (retry tests)
    redirect_to:  respond 302 to this absolute URL (Authorization-forwarding tests)
    require_auth: 401 unless "Authorization: Bearer TEST-TOKEN-NOT-REAL"
    ignore_range: serve 200 + full body without Content-Range
    log:          list of (path, headers dict) for every request received
    """

    def __init__(self, body: bytes = b""):
        self.body = body
        self.fail_first = 0
        self.fail_code = 503
        self.redirect_to: str | None = None
        self.require_auth = False
        self.ignore_range = False
        self.fail_after: tuple[int, int] | None = None  # (request number, code): fail exactly one later request
        self.log: list[tuple[str, dict]] = []
        self.bytes_sent = 0
        self._lock = threading.Lock()
        outer = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):  # keep pytest output clean
                pass

            def do_GET(self):  # noqa: N802
                with outer._lock:
                    outer.log.append((self.path, {k.lower(): v for k, v in self.headers.items()}))
                    n = len(outer.log)
                if n <= outer.fail_first:
                    return self._send(outer.fail_code, b"fail")
                if outer.fail_after and n == outer.fail_after[0]:
                    return self._send(outer.fail_after[1], b"fail")
                if outer.redirect_to:
                    self.send_response(302)
                    self.send_header("Location", outer.redirect_to)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if outer.require_auth and self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    return self._send(401, b"unauthorized")
                rng = self.headers.get("Range")
                body = outer.body
                if rng and not outer.ignore_range:
                    m = re.match(r"bytes=(\d+)-(\d*)", rng)
                    a = int(m.group(1))
                    b = min(int(m.group(2)) if m.group(2) else len(body) - 1, len(body) - 1)
                    if a >= len(body):
                        return self._send(416, b"", {"Content-Range": f"bytes */{len(body)}"})
                    chunk = body[a : b + 1]
                    outer.bytes_sent += len(chunk)
                    return self._send(206, chunk, {"Content-Range": f"bytes {a}-{b}/{len(body)}"})
                outer.bytes_sent += len(body)
                return self._send(200, body)

            def _send(self, code, payload, extra=None):
                self.send_response(code)
                self.send_header("Content-Length", str(len(payload)))
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(payload)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}/file.h5"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def make_server():
    servers: list[FixtureServer] = []

    def make(body: bytes = b"") -> FixtureServer:
        s = FixtureServer(body)
        servers.append(s)
        return s

    yield make
    for s in servers:
        s.close()


@pytest.fixture
def token():
    return TOKEN


@pytest.fixture
def no_sleep(monkeypatch):
    """Skip real backoff sleeps in nisar_io; record the requested delays."""
    import nisar_io

    delays: list[float] = []
    monkeypatch.setattr(nisar_io.time, "sleep", lambda d: delays.append(d))
    return delays
