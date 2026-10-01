"""One background reader per test. Asks the Crystal gauge for pressure once a second and reconnects by itself."""
from __future__ import annotations

import math
import random
import threading
import time
from typing import Callable

from .core import parse_reply

DEMO = "DEMO"
QUERY = b"?PRE\r"
SILENT_AFTER = 5.0


def list_ports() -> list[dict]:
    try:
        from serial.tools import list_ports as lp
        return [{"port": p.device, "label": p.description or p.device} for p in sorted(lp.comports(), key=lambda p: p.device)]
    except Exception:
        return []


class Reader(threading.Thread):
    def __init__(self, test_id: int, port: str, on_reading: Callable[[int, float, str], None]):
        super().__init__(daemon=True, name=f"gauge-{test_id}")
        self.test_id, self.port, self.on_reading = test_id, port, on_reading
        self.status, self.unit, self.last = "connecting", "", 0.0
        self._halt = threading.Event()

    def stop(self) -> None:
        self._halt.set()

    def info(self) -> dict:
        return {"port": self.port, "status": self.status, "unit": self.unit}

    def _got(self, raw: float, unit: str) -> None:
        self.last, self.unit, self.status = time.monotonic(), unit, "live"
        self.on_reading(self.test_id, raw, unit)

    def run(self) -> None:
        if self.port == DEMO:
            return self._demo()
        import serial
        while not self._halt.is_set():
            try:
                with serial.Serial(self.port, 9600, bytesize=8, parity="N", stopbits=1, timeout=0.2) as link:
                    self.last, buf, due = time.monotonic(), "", time.monotonic() + 0.2
                    while not self._halt.is_set():
                        if time.monotonic() >= due:
                            link.write(QUERY)
                            due += 1.0
                        buf += link.read(64).decode("ascii", "ignore")
                        *lines, buf = buf.replace("\n", "\r").split("\r")
                        buf = buf[-128:]
                        for line in lines:
                            reply = parse_reply(line)
                            if reply:
                                self._got(*reply)
                        if time.monotonic() - self.last > SILENT_AFTER:
                            self.status = "silent"
            except Exception:
                # Unplugged, or another program holds the port. Keep trying.
                self.status = "lost"
                self._halt.wait(2.0)

    def _demo(self) -> None:
        start, value = time.monotonic(), 0.0
        while not self._halt.is_set():
            t = time.monotonic() - start
            target = 0 if t < 8 else 675 if t < 60 else 900
            value += (target - value) * 0.12 if abs(target - value) > 1 else 0
            wobble = 0 if value < 1 else math.sin(t / 40) * 1.5 + random.uniform(-0.2, 0.2)
            self._got(round(value + wobble, 1), "PSI")
            self._halt.wait(1.0)


class Gauges:
    def __init__(self, on_reading: Callable[[int, float, str], None]):
        self.on_reading, self.readers, self.lock = on_reading, {}, threading.Lock()

    def start(self, test_id: int, port: str) -> None:
        with self.lock:
            self._drop(test_id)
            self.readers[test_id] = Reader(test_id, port, self.on_reading)
            self.readers[test_id].start()

    def stop(self, test_id: int) -> None:
        with self.lock:
            self._drop(test_id)

    def _drop(self, test_id: int) -> None:
        old = self.readers.pop(test_id, None)
        if old:
            old.stop()
            old.join(1.5)

    def info(self, test_id: int) -> dict | None:
        reader = self.readers.get(test_id)
        return reader.info() if reader else None

    def in_use(self) -> dict[str, int]:
        return {r.port: tid for tid, r in self.readers.items()}
