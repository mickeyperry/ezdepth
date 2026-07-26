import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch
from PIL import Image
from transformers import pipeline

PORT = 8787
MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"

_lock = threading.Lock()
_pipe = None


def load_model():
    global _pipe
    device = 0 if torch.cuda.is_available() else -1
    print(f"[depth] loading {MODEL_ID} on {'cuda' if device == 0 else 'cpu'}...", flush=True)
    _pipe = pipeline(task="depth-estimation", model=MODEL_ID, device=device)
    print("[depth] model ready", flush=True)


def _load_when_ready(path: str, timeout_s: float = 5.0):
    # AE's saveFrameToPng can return control to the panel before the PNG is
    # fully flushed to disk, so a fresh capture may briefly be truncated.
    # Retry the full decode (not just an existence/size check) until it
    # succeeds or the timeout elapses, then let the real error surface.
    deadline = time.time() + timeout_s
    last_err = None
    while time.time() < deadline:
        try:
            img = Image.open(path)
            img.load()
            return img.convert("RGB")
        except Exception as e:
            last_err = e
            time.sleep(0.1)
    img = Image.open(path)
    img.load()
    return img.convert("RGB")  # re-raises last_err's kind of failure if still broken


def run_depth(in_path: str, out_path: str, invert: bool = False) -> None:
    img = _load_when_ready(in_path)
    with _lock:
        result = _pipe(img)
    depth_img = result["depth"].convert("L")  # near = white, out of the box
    if invert:
        depth_img = Image.eval(depth_img, lambda p: 255 - p)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    depth_img.save(out_path)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[depth]", fmt % args, flush=True)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            ready = _pipe is not None
            self._json(200 if ready else 503, {"ready": ready})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/depth":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
            in_path = req["in"]
            out_path = req["out"]
            invert = bool(req.get("invert", False))
            if not Path(in_path).exists():
                self._json(400, {"ok": False, "error": f"input not found: {in_path}"})
                return
            run_depth(in_path, out_path, invert)
            self._json(200, {"ok": True, "out": out_path})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})


if __name__ == "__main__":
    load_model()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[depth] listening on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
