#!/usr/bin/env python3
"""卡斯卡德罗（Cascadero）静态服务 + 对局记录接口（单机版）。
GET  /、/index.html  只提供首页（页面是单文件，不服务目录里的其他任何文件）
GET  /api/version     首页修改时间，客户端用来判断是否刷新
POST /api/gamelog     追加一行 JSON 到 games/gamelog.jsonl（同一对局 id 会多次上报，取最后一条为准；只接受同源页面的上报，文件上限 50MB）
默认监听所有网卡以便局域网里的手机/平板来玩；设 CASC_HOST=127.0.0.1 可只留本机。
"""
import json, os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
GAMES_DIR = os.path.join(ROOT, "games")
os.makedirs(GAMES_DIR, exist_ok=True)
LOG = os.path.join(GAMES_DIR, "gamelog.jsonl")
LOG_MAX = 50_000_000
ALLOWED_GET = {"/", "/index.html", "/api/version"}

class H(SimpleHTTPRequestHandler):
    timeout = 30   # 慢速连接不长期占用线程

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _route(self):
        p = self.path.split("?", 1)[0]
        return p if p == "/" else p.rstrip("/")

    def list_directory(self, path):
        self.send_error(404); return None

    def do_HEAD(self):
        if self._route() not in ALLOWED_GET: self.send_error(404); return
        super().do_HEAD()

    def do_GET(self):
        route = self._route()
        if route not in ALLOWED_GET:
            self.send_error(404); return
        if route == "/api/version":
            v = str(int(os.path.getmtime(os.path.join(ROOT, "index.html"))))
            body = json.dumps({"v": v}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self._route() != "/api/gamelog":
            self.send_error(404); return
        origin = self.headers.get("Origin") or self.headers.get("Referer") or ""
        host = self.headers.get("Host", "")
        if origin and host and ("//" + host) not in origin:   # 只接受本页面发出的上报
            self.send_error(403); return
        if os.path.exists(LOG) and os.path.getsize(LOG) > LOG_MAX:
            self.send_error(507); return
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
    host = os.environ.get("CASC_HOST", "0.0.0.0")
    ThreadingHTTPServer((host, port), H).serve_forever()
