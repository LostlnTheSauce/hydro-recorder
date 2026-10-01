"""Sends shared tests to the website. Recording never waits on this; anything unsent goes up when the internet is back."""
from __future__ import annotations

import hashlib
import json
import threading
import time
import urllib.error
import urllib.request

from . import core

BATCH = 2000
HEARTBEAT = 10.0


def post(site: str, action: str, body: dict) -> dict:
    request = urllib.request.Request(f"{site}/api.php?a={action}", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "User-Agent": "HydroRecorder/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read()).get("error")
        except Exception:
            message = None
        raise RuntimeError(message or f"The website answered with error {e.code}. Check the website address.")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError("Could not reach the website. Check the internet connection and the address.")
    except ValueError:
        raise RuntimeError("That address did not answer like the live-viewing site. Check the website address.")


class Uploader(threading.Thread):
    def __init__(self, app):
        super().__init__(daemon=True, name="uploader")
        self.app, self.lock = app, threading.Lock()
        self.acked: dict[int, int] = {}      # newest reading the site has, per test
        self.meta: dict[int, str] = {}       # fingerprint of the details the site has
        self.errors: dict[int, str] = {}
        self.sent_at: dict[int, float] = {}

    def forget(self, test_id: int) -> None:
        for box in (self.acked, self.meta, self.errors, self.sent_at):
            box.pop(test_id, None)

    def status(self, test_id: int) -> dict:
        pending = self.app.db.one("SELECT COUNT(*) n FROM readings WHERE test_id=? AND at>?", (test_id, self.acked.get(test_id, 0)))["n"]
        return {"pending": pending, "error": self.errors.get(test_id)}

    @staticmethod
    def _mark(meta: dict) -> str:
        return hashlib.sha1(json.dumps(meta, sort_keys=True).encode()).hexdigest()

    def push(self, t: dict) -> str | None:
        """One round trip. Returns a message if it failed."""
        with self.lock:
            tid, db = t["id"], self.app.db
            t = db.test(tid)  # sharing may have been stopped while this upload was waiting its turn
            if not t or not t["share_token"]:
                return None
            acked = self.acked.get(tid)
            rows = [] if acked is None else db.all("SELECT at, raw FROM readings WHERE test_id=? AND at>? ORDER BY at LIMIT ?", (tid, acked, BATCH))
            meta = self.app.share_meta(t)
            mark = self._mark(meta)
            body = {"key": db.get("site_key"), "token": t["share_token"], "rev": t["share_rev"],
                    "meta": meta if self.meta.get(tid) != mark else None,
                    "readings": [[r["at"], round(core.adjust(r["raw"], t["offset"]), 2)] for r in rows]}
            try:
                answer = post(self.app.site(), "push", body)
            except RuntimeError as e:
                self.errors[tid] = str(e)
                return str(e)
            self.acked[tid] = int(answer.get("last") or 0)
            self.meta[tid] = mark if answer.get("has_meta") else ""
            self.errors.pop(tid, None)
            self.sent_at[tid] = time.monotonic()
            return None

    def run(self) -> None:
        while True:
            time.sleep(2.0)
            try:
                for row in self.app.db.all("SELECT id FROM tests WHERE share_token IS NOT NULL"):
                    t = self.app.db.test(row["id"])
                    for _ in range(30):  # catch up a backlog quickly, then yield to the next test
                        waiting = self.acked.get(t["id"]) is None or self.status(t["id"])["pending"]
                        changed = self.meta.get(t["id"]) != self._mark(self.app.share_meta(t))
                        quiet = time.monotonic() - self.sent_at.get(t["id"], 0) > HEARTBEAT
                        if not waiting and not changed and (t["closed_at"] or not quiet):
                            break
                        if self.push(t) or not self.status(t["id"])["pending"]:
                            break
            except Exception:
                continue  # never let a surprise here stop future uploads
