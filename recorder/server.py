"""Local web server. The screen is a browser page, but it only ever talks to this computer."""
from __future__ import annotations

import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .app import App, Problem

WEB = Path(__file__).parent / "web"
LOCAL = re.compile(r"^(localhost|127\.0\.0\.1)(:\d+)?$")


class Handler(BaseHTTPRequestHandler):
    app: App

    def log_message(self, *args) -> None:
        pass

    def _send(self, status: int, body: bytes, kind: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, status: int = 200) -> None:
        self._send(status, json.dumps(data).encode(), "application/json")

    def _local(self) -> bool:
        origin = self.headers.get("Origin")
        return bool(LOCAL.match(self.headers.get("Host", ""))) and (not origin or bool(LOCAL.match(urlparse(origin).netloc)))

    def do_GET(self) -> None:
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if not self._local():
                return self._json({"error": "Local use only."}, 403)
            if url.path == "/api/state":
                return self._json(self.app.state(int(q["test"]) if q.get("test") else None, int(q.get("since") or 0), int(q.get("step") or 900)))
            if url.path == "/api/ports":
                return self._json(self.app.ports())
            if url.path == "/api/history":
                return self._json(self.app.history())
            m = re.match(r"^/api/tests/(\d+)/(log|pressure|notes)\.csv$", url.path)
            if m:
                name, text = self.app.export(int(m.group(1)), m.group(2))
                return self._send(200, ("﻿" + text).encode(), "text/csv; charset=utf-8",
                                  {"Content-Disposition": f'attachment; filename="{name}"'})
            target = (WEB / (url.path.lstrip("/") or "index.html")).resolve()
            if WEB.resolve() in target.parents and target.is_file():
                return self._send(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self._json({"error": "Not found."}, 404)
        except Problem as e:
            self._json({"error": str(e)}, 400)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if not self._local():
                return self._json({"error": "Local use only."}, 403)
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if path == "/api/tests":
                return self._json({"id": self.app.create(data)})
            m = re.match(r"^/api/tests/(\d+)(?:/(connect|disconnect|finish|marks|share|unshare))?$", path)
            if m:
                test_id, action = int(m.group(1)), m.group(2)
                if action == "connect":
                    self.app.connect(test_id, str(data.get("port") or ""))
                elif action == "disconnect":
                    self.app.disconnect(test_id)
                elif action == "finish":
                    self.app.finish(test_id)
                elif action == "share":
                    self.app.share_start(test_id, str(data.get("site") or ""))
                elif action == "unshare":
                    self.app.share_stop(test_id)
                elif action == "marks":
                    self.app.add_mark(test_id, data)
                else:
                    self.app.update(test_id, data)
                return self._json({"ok": True})
            m = re.match(r"^/api/marks/(\d+)/delete$", path)
            if m:
                self.app.delete_mark(int(m.group(1)))
                return self._json({"ok": True})
            self._json({"error": "Not found."}, 404)
        except Problem as e:
            self._json({"error": str(e)}, 400)
        except (ValueError, TypeError):
            self._json({"error": "That request could not be read."}, 400)


def serve(app: App, port: int) -> ThreadingHTTPServer:
    Handler.app = app
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server
