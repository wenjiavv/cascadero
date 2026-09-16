#!/usr/bin/env python3
"""使者与城邦 静态服务 + 对局记录接口（单机版）。
GET  /*            静态文件（同 http.server）
POST /api/gamelog  追加一行 JSON 到 games/gamelog.jsonl（同一对局 id 会多次上报，取最后一条为准）
"""
import json, os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
GAMES_DIR = os.path.join(ROOT, "games")
os.makedirs(GAMES_DIR, exist_ok=True)
LOG = os.path.join(GAMES_DIR, "gamelog.jsonl")

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        if self.path.rstrip("/") == "/api/version":
            v = str(int(os.path.getmtime(os.path.join(ROOT, "index.html"))))
            body = json.dumps({"v": v}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.rstrip("/") != "/api/gamelog":
            self.send_error(404); return
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n <= 0 or n > 2_000_000:
                self.send_error(400); return
            rec = json.loads(self.rfile.read(n).decode("utf-8"))
            if not isinstance(rec, dict) or "id" not in rec or "moves" not in rec:
                self.send_error(400); return
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.end_headers(); self.wfile.write(b'{"ok":true}')
        except Exception:
            self.send_error(500)

    def log_message(self, fmt, *args):
        if self.command == "POST":
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5235
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
