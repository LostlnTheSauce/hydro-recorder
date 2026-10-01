"""SQLite store. Every reading is committed to disk as it arrives."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER,
  port TEXT, offset REAL NOT NULL DEFAULT 0, chart_max REAL NOT NULL DEFAULT 1000,
  window_low REAL, window_high REAL, duration_hours REAL NOT NULL DEFAULT 8,
  official_start INTEGER, official_end INTEGER, details TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS readings (
  test_id INTEGER NOT NULL, at INTEGER NOT NULL, raw REAL NOT NULL, unit TEXT NOT NULL,
  PRIMARY KEY (test_id, at)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY, test_id INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', pressure REAL, strokes REAL
);
CREATE INDEX IF NOT EXISTS marks_test ON marks(test_id, at);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def now_ms() -> int:
    return int(time.time() * 1000)


class DB:
    def __init__(self, path: str | Path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=FULL")  # a reading on screen is a reading on disk
        self.conn.executescript(SCHEMA)
        have = {r["name"] for r in self.conn.execute("PRAGMA table_info(tests)")}
        for name, kind in (("share_token", "TEXT"), ("share_rev", "INTEGER NOT NULL DEFAULT 1")):
            if name not in have:
                self.conn.execute(f"ALTER TABLE tests ADD COLUMN {name} {kind}")

    def get(self, key: str, default: str = "") -> str:
        row = self.one("SELECT value FROM kv WHERE key=?", (key,))
        return row["value"] if row else default

    def put(self, key: str, value: str) -> None:
        self.run("INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def run(self, sql: str, args: tuple = ()) -> int:
        with self.lock:
            return self.conn.execute(sql, args).lastrowid

    def all(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple = ()) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def test(self, test_id: int) -> dict | None:
        row = self.one("SELECT * FROM tests WHERE id=?", (test_id,))
        if not row:
            return None
        t = dict(row)
        t["details"] = json.loads(t["details"] or "{}")
        return t
