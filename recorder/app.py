"""What the recorder does: tests, gauges, marks, the 15-minute record and exports."""
from __future__ import annotations

import csv
import io
import json
import secrets
from datetime import datetime

from . import core
from .db import DB, now_ms
from .gauges import DEMO, Gauges, list_ports
from .share import Uploader, post

NEAR_MS = 30_000  # a 15-minute row is left blank rather than filled from a reading further away than this
STEPS = {15, 60, 300, 600, 900}  # seconds; what the on-screen record can be stepped by
SCREEN_ROWS = 240  # finer steps show only the latest rows
DEFAULT_SITE = "https://grantgsolutions.com/live"
EDITABLE = {"name": str, "offset": float, "chart_max": float, "window_low": float, "window_high": float,
            "duration_hours": float, "official_start": int, "official_end": int}
CLEARABLE = {"window_low", "window_high", "official_start", "official_end"}


class Problem(Exception):
    pass


def stamp(ms: int, fmt: str = "%m/%d/%Y %I:%M %p") -> str:
    return datetime.fromtimestamp(ms / 1000).strftime(fmt)


class App:
    def __init__(self, db_path):
        self.db = DB(db_path)
        self.gauges = Gauges(self._reading)
        # A reboot or crash mid-test picks the gauges back up with nobody touching anything.
        for row in self.db.all("SELECT id, port FROM tests WHERE closed_at IS NULL AND port IS NOT NULL"):
            self.gauges.start(row["id"], row["port"])
        self.uploader = Uploader(self)
        self.uploader.start()

    def _reading(self, test_id: int, raw: float, unit: str) -> None:
        self.db.run("INSERT OR REPLACE INTO readings (test_id, at, raw, unit) VALUES (?,?,?,?)", (test_id, now_ms(), raw, unit))

    # ---- tests
    def _need(self, test_id: int, open_only: bool = False) -> dict:
        t = self.db.test(test_id)
        if not t:
            raise Problem("That test no longer exists.")
        if open_only and t["closed_at"]:
            raise Problem("This test is finished.")
        return t

    def create(self, data: dict) -> int:
        name = str(data.get("name") or "").strip() or f"Test {stamp(now_ms(), '%m/%d %I:%M %p')}"
        test_id = self.db.run("INSERT INTO tests (name, created_at) VALUES (?,?)", (name, now_ms()))
        self.update(test_id, data)
        return test_id

    def update(self, test_id: int, data: dict) -> None:
        t = self._need(test_id)
        for key, kind in EDITABLE.items():
            if key not in data:
                continue
            value = data[key]
            if value in (None, ""):
                if key not in CLEARABLE:
                    continue
                value = None
            else:
                try:
                    value = kind(value) if kind is not str else str(value).strip()
                except (TypeError, ValueError):
                    raise Problem(f"{key.replace('_', ' ')} needs a number.")
            if key == "chart_max" and not value > 0:
                raise Problem("Chart maximum must be above zero.")
            if key == "name" and not value:
                continue
            if key == "offset" and value != t["offset"]:
                # Every shared pressure changes with the offset, so viewers get the whole trace again.
                self.db.run("UPDATE tests SET share_rev=share_rev+1 WHERE id=?", (test_id,))
            self.db.run(f"UPDATE tests SET {key}=? WHERE id=?", (value, test_id))
        if isinstance(data.get("details"), dict):
            details = {**t["details"], **{k: str(v).strip() for k, v in data["details"].items()}}
            self.db.run("UPDATE tests SET details=? WHERE id=?", (json.dumps(details), test_id))

    def connect(self, test_id: int, port: str) -> None:
        self._need(test_id, open_only=True)
        other = self.gauges.in_use().get(port)
        if port != DEMO and other not in (None, test_id):
            raise Problem(f"{port} is already recording {self._need(other)['name']}.")
        self.db.run("UPDATE tests SET port=? WHERE id=?", (port, test_id))
        self.gauges.start(test_id, port)

    def disconnect(self, test_id: int) -> None:
        self.gauges.stop(test_id)
        self.db.run("UPDATE tests SET port=NULL WHERE id=?", (test_id,))

    def finish(self, test_id: int) -> None:
        self._need(test_id, open_only=True)
        self.disconnect(test_id)
        self.db.run("UPDATE tests SET closed_at=? WHERE id=?", (now_ms(), test_id))

    def ports(self) -> list[dict]:
        used = self.gauges.in_use()
        names = {r["id"]: r["name"] for r in self.db.all("SELECT id, name FROM tests")}
        found = [{**p, "used_by": names.get(used.get(p["port"]))} for p in list_ports()]
        return found + [{"port": DEMO, "label": "Practice gauge (simulated pressure)", "used_by": None}]

    # ---- live viewing through the website
    def site(self) -> str:
        return self.db.get("site_url", DEFAULT_SITE)

    def share_start(self, test_id: int, url: str) -> None:
        t = self._need(test_id)
        url = (url or "").strip().rstrip("/")
        if not url.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise Problem("The website address must start with https://")
        self.db.put("site_url", url)
        if not self.db.get("site_key"):
            self.db.put("site_key", secrets.token_hex(32))
        if not t["share_token"]:
            self.db.run("UPDATE tests SET share_token=? WHERE id=?", (secrets.token_urlsafe(16), test_id))
        problem = self.uploader.push(self.db.test(test_id))
        if problem:
            self.db.run("UPDATE tests SET share_token=NULL WHERE id=?", (test_id,))
            raise Problem(problem)

    def share_stop(self, test_id: int) -> None:
        t = self._need(test_id)
        if not t["share_token"]:
            return
        with self.uploader.lock:  # no upload may land after the link is removed
            self.db.run("UPDATE tests SET share_token=NULL WHERE id=?", (test_id,))
            self.uploader.forget(test_id)
            try:
                post(self.site(), "stop", {"key": self.db.get("site_key"), "token": t["share_token"]})
            except Exception:
                pass  # the site drops a link by itself after 30 days without updates

    def share_meta(self, t: dict) -> dict:
        """What viewers see besides the trace."""
        keep = ("name", "details", "chart_max", "window_low", "window_high", "duration_hours", "official_start", "official_end", "closed_at")
        gauge = self.gauges.info(t["id"])
        return {**{k: t[k] for k in keep}, "gauge": gauge["status"] if gauge else None,
                "record": self.official(t), "notes": [m for m in self.marks(t["id"]) if m["kind"] == "note"]}

    # ---- readings
    def latest(self, t: dict) -> dict | None:
        row = self.db.one("SELECT at, raw, unit FROM readings WHERE test_id=? ORDER BY at DESC LIMIT 1", (t["id"],))
        return {"at": row["at"], "raw": row["raw"], "unit": row["unit"], "pressure": core.adjust(row["raw"], t["offset"])} if row else None

    def trace(self, t: dict, since: int, max_points: int = 6000) -> list[tuple[int, float]]:
        floor = max(since, now_ms() - 24 * 3600 * 1000) if not t["closed_at"] else since
        rows = self.db.all("SELECT at, raw FROM readings WHERE test_id=? AND at>? ORDER BY at", (t["id"], floor))
        return core.thin([(r["at"], round(core.adjust(r["raw"], t["offset"]), 2)) for r in rows], max_points)

    def summary(self, t: dict) -> dict:
        lo, hi = t["official_start"] or 0, t["official_end"] or 2 ** 62
        row = self.db.one("SELECT MIN(raw) lo, MAX(raw) hi, COUNT(*) n FROM readings WHERE test_id=? AND at BETWEEN ? AND ?", (t["id"], lo, hi))
        low, high = (core.adjust(row[k], t["offset"]) for k in ("lo", "hi")) if row["n"] else (None, None)
        gauge = self.gauges.info(t["id"])
        share = {"link": f"{self.site()}/?t={t['share_token']}", **self.uploader.status(t["id"])} if t["share_token"] else None
        return {**t, "gauge": gauge, "latest": self.latest(t), "low": low, "high": high, "count": row["n"], "share": share}

    def official(self, t: dict) -> list[dict]:
        """The 15-minute record that goes on paperwork."""
        return self.record(t)

    def record(self, t: dict, step: int = core.QUARTER_MS) -> list[dict]:
        """One row per step. Before the official start is set, it runs from the first reading."""
        quarter = step == core.QUARTER_MS
        near = min(NEAR_MS, step // 2)
        start, end = t["official_start"], t["official_end"]
        if not start:
            first = self.db.one("SELECT MIN(at) a FROM readings WHERE test_id=?", (t["id"],))["a"]
            if not first:
                return []
            start = core.next_mark(first, step, self._utc_offset(first))
        last = self.db.one("SELECT MAX(at) a FROM readings WHERE test_id=?", (t["id"],))["a"] or 0
        stop = min(end or 2 ** 62, max(last, now_ms() if not t["closed_at"] else last))
        if stop < start:
            return []
        rows = []
        times = core.official_times(start, end) if quarter and end and end <= stop else range(start, stop + 1, step)
        if not quarter:
            times = times[-SCREEN_ROWS:]
        for at in times:
            hit = self.db.one("SELECT raw FROM readings WHERE test_id=? AND at BETWEEN ? AND ? ORDER BY ABS(at-?) LIMIT 1",
                              (t["id"], at - near, at + near, at))
            remark = "Test start" if at == t["official_start"] else "Test end" if at == end else ""
            rows.append({"at": at, "pressure": round(core.adjust(hit["raw"], t["offset"]), 0 if quarter else 1) if hit else None,
                         "remark": remark if hit else (remark + " · no gauge reading").strip(" ·")})
        return rows

    @staticmethod
    def _utc_offset(ms: int) -> int:
        return int(datetime.fromtimestamp(ms / 1000).astimezone().utcoffset().total_seconds() * 1000)

    # ---- marks (notes and stroke counts)
    def marks(self, test_id: int) -> list[dict]:
        return [dict(r) for r in self.db.all("SELECT * FROM marks WHERE test_id=? ORDER BY at DESC, id DESC", (test_id,))]

    def add_mark(self, test_id: int, data: dict) -> None:
        t = self._need(test_id)
        text, strokes = str(data.get("text") or "").strip()[:500], data.get("strokes")
        at = int(data.get("at") or now_ms())
        if strokes in (None, ""):
            if not text:
                raise Problem("Type a note first.")
            self.db.run("INSERT INTO marks (test_id, at, kind, text) VALUES (?,?,'note',?)", (test_id, at, text))
            return
        try:
            strokes = float(strokes)
        except (TypeError, ValueError):
            raise Problem("Stroke count needs a number.")
        pressure = data.get("pressure")
        if pressure in (None, ""):
            near = self.db.one("SELECT raw FROM readings WHERE test_id=? AND at BETWEEN ? AND ? ORDER BY ABS(at-?) LIMIT 1",
                               (test_id, at - NEAR_MS, at + NEAR_MS, at))
            pressure = round(core.adjust(near["raw"], t["offset"])) if near else None
        self.db.run("INSERT INTO marks (test_id, at, kind, text, pressure, strokes) VALUES (?,?,'stroke',?,?,?)",
                    (test_id, at, text, pressure, strokes))

    def delete_mark(self, mark_id: int) -> None:
        self.db.run("DELETE FROM marks WHERE id=?", (mark_id,))

    # ---- what the screen asks for every second
    def state(self, selected: int | None, since: int, step: int = 900) -> dict:
        open_tests = [self.summary(self.db.test(r["id"])) for r in self.db.all("SELECT id FROM tests WHERE closed_at IS NULL ORDER BY id")]
        out = {"now": now_ms(), "tests": open_tests, "selected": None, "site": self.site()}
        t = self.db.test(selected) if selected else None
        if t:
            out["selected"] = {**self.summary(t), "points": self.trace(t, since), "marks": self.marks(t["id"]),
                               "official": self.record(t, (step if step in STEPS else 900) * 1000)}
        return out

    def history(self) -> list[dict]:
        return [{**dict(r), "details": json.loads(r["details"] or "{}")} for r in self.db.all(
            "SELECT t.id, t.name, t.created_at, t.closed_at, t.details, (SELECT COUNT(*) FROM readings r WHERE r.test_id=t.id) AS count "
            "FROM tests t WHERE closed_at IS NOT NULL ORDER BY closed_at DESC")]

    # ---- downloads
    def export(self, test_id: int, kind: str) -> tuple[str, str]:
        t = self._need(test_id)
        out = io.StringIO()
        w = csv.writer(out, lineterminator="\r\n")
        if kind == "log":
            w.writerow(["Date", "Time", "Pressure (psi)", "Remarks"])
            for r in self.official(t):
                w.writerow([stamp(r["at"], "%m/%d/%Y"), stamp(r["at"], "%I:%M %p"), "" if r["pressure"] is None else r["pressure"], r["remark"]])
        elif kind == "pressure":
            w.writerow(["Date", "Time", "Gauge reading", "Offset", "Recorded pressure", "Unit"])
            for r in self.db.all("SELECT at, raw, unit FROM readings WHERE test_id=? ORDER BY at", (test_id,)):
                w.writerow([stamp(r["at"], "%m/%d/%Y"), stamp(r["at"], "%I:%M:%S %p"), r["raw"], t["offset"],
                            round(core.adjust(r["raw"], t["offset"]), 2), r["unit"]])
        elif kind == "notes":
            w.writerow(["Date", "Time", "Type", "Pressure (psi)", "Stroke count", "Strokes since last", "Note"])
            previous = None
            for m in reversed(self.marks(test_id)):
                gap = ""
                if m["kind"] == "stroke":
                    gap = "" if previous is None else m["strokes"] - previous
                    previous = m["strokes"]
                w.writerow([stamp(m["at"], "%m/%d/%Y"), stamp(m["at"], "%I:%M %p"), "Stroke count" if m["kind"] == "stroke" else "Note",
                            "" if m["pressure"] is None else m["pressure"], "" if m["strokes"] is None else m["strokes"], gap, m["text"]])
        else:
            raise Problem("Unknown download.")
        safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in t["name"]).strip() or "test"
        return f"{safe} - {kind}.csv", out.getvalue()
