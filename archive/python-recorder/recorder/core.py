"""Pure pressure math: gauge reply parsing, offset, 15-minute marks, trace thinning."""
from __future__ import annotations

import re

QUARTER_MS = 15 * 60 * 1000
# Same reply shape the old browser recorder accepted: "983.9 PSI", "984.1,PSI", "-0.2 psi".
REPLY = re.compile(r"(?:^|[^0-9+\-.])([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([A-Za-z][A-Za-z0-9/²^.\-]*)")
ZERO_BAND = 0.5


def parse_reply(line: str) -> tuple[float, str] | None:
    m = REPLY.search(line)
    return (float(m.group(1)), m.group(2).upper()) if m else None


def adjust(raw: float, offset: float) -> float:
    """Deadweight offset. A gauge resting at zero stays zero whatever the offset is."""
    return 0.0 if abs(raw) <= ZERO_BAND else raw + offset


def next_mark(ms: int, step_ms: int, utc_offset_ms: int = 0) -> int:
    """First round step (quarter hour, minute, ...) at or after ms, on the local clock."""
    local = ms + utc_offset_ms
    return -(-local // step_ms) * step_ms - utc_offset_ms


def next_quarter(ms: int, utc_offset_ms: int = 0) -> int:
    return next_mark(ms, QUARTER_MS, utc_offset_ms)


def official_times(start: int, end: int) -> list[int]:
    """Every 15 minutes from start, always including the end time."""
    times = list(range(start, end + 1, QUARTER_MS))
    if times[-1] != end:
        times.append(end)
    return times


def thin(rows: list[tuple[int, float]], max_points: int) -> list[tuple[int, float]]:
    """Cut a long trace down for drawing, keeping each bucket's low and high so spikes survive."""
    if len(rows) <= max_points:
        return rows
    size = -(-len(rows) // (max_points // 2))
    out: list[tuple[int, float]] = []
    for i in range(0, len(rows), size):
        bucket = rows[i:i + size]
        lo, hi = min(bucket, key=lambda r: r[1]), max(bucket, key=lambda r: r[1])
        out.extend(sorted({lo, hi}))
    return out
