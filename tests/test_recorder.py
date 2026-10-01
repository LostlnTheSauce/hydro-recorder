import tempfile
import time
import unittest
from pathlib import Path

from recorder import core
from recorder.app import App, Problem
from recorder.db import now_ms

Q = core.QUARTER_MS


class Core(unittest.TestCase):
    def test_parse_reply(self):
        self.assertEqual(core.parse_reply("983.9 PSI"), (983.9, "PSI"))
        self.assertEqual(core.parse_reply("984.1,psi"), (984.1, "PSI"))
        self.assertEqual(core.parse_reply("-0.2 psi"), (-0.2, "PSI"))
        self.assertEqual(core.parse_reply("12.5 BAR"), (12.5, "BAR"))
        self.assertIsNone(core.parse_reply("983.9"))
        self.assertIsNone(core.parse_reply(""))

    def test_offset_keeps_zero_at_zero(self):
        self.assertEqual(core.adjust(110, -2), 108)
        self.assertEqual(core.adjust(0.3, -2), 0)
        self.assertEqual(core.adjust(-0.5, 5), 0)

    def test_next_quarter(self):
        self.assertEqual(core.next_quarter(Q * 4), Q * 4)
        self.assertEqual(core.next_quarter(Q * 4 + 1), Q * 5)
        # The quarter hour is taken on the local clock, not UTC.
        self.assertEqual(core.next_quarter(Q * 4 + 1, 5 * 60000), Q * 5 - 5 * 60000)

    def test_official_times_include_an_off_quarter_end(self):
        self.assertEqual(core.official_times(0, Q * 2), [0, Q, Q * 2])
        self.assertEqual(core.official_times(0, Q + 5), [0, Q, Q + 5])

    def test_thin_keeps_spikes(self):
        rows = [(i, 100.0) for i in range(10000)]
        rows[4321] = (4321, 950.0)
        out = core.thin(rows, 500)
        self.assertLessEqual(len(out), 500)
        self.assertIn((4321, 950.0), out)
        self.assertEqual(out, sorted(out))


class Recorder(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "t.db"
        self.app = App(self.path)

    def tearDown(self):
        for test_id in list(self.app.gauges.readers):
            self.app.gauges.stop(test_id)
        self.app.db.conn.close()
        self.dir.cleanup()

    def fill(self, test_id, start, minutes, psi=900.0, skip=()):
        rows = [(test_id, start + s * 1000, psi, "PSI") for s in range(minutes * 60 + 1) if s // 60 not in skip]
        self.app.db.conn.executemany("INSERT INTO readings VALUES (?,?,?,?)", rows)

    def test_official_record_rounds_and_leaves_gaps_blank(self):
        t = self.app.create({"name": "A", "offset": -2})
        start = (now_ms() // Q) * Q - 4 * Q
        self.fill(t, start, 45, psi=901.6, skip={29, 30})
        self.app.update(t, {"official_start": start, "official_end": start + 3 * Q})
        rows = self.app.official(self.app.db.test(t))
        self.assertEqual([r["pressure"] for r in rows], [900, 900, None, 900])
        self.assertEqual(rows[0]["remark"], "Test start")
        self.assertIn("no gauge reading", rows[2]["remark"])
        self.assertEqual(rows[3]["remark"], "Test end")

    def test_low_high_follow_the_official_window(self):
        t = self.app.create({"name": "A"})
        start = now_ms() - 3 * Q
        self.fill(t, start, 10, psi=500)
        self.fill(t, start + Q, 10, psi=900)
        self.app.update(t, {"official_start": start + Q})
        s = self.app.summary(self.app.db.test(t))
        self.assertEqual((s["low"], s["high"]), (900, 900))

    def test_stroke_count_picks_up_pressure(self):
        t = self.app.create({"name": "A", "offset": 1})
        self.app.db.run("INSERT INTO readings VALUES (?,?,?,?)", (t, now_ms(), 849.4, "PSI"))
        self.app.add_mark(t, {"strokes": "1240"})
        self.app.add_mark(t, {"text": "swapped pump"})
        marks = self.app.marks(t)
        self.assertEqual({m["kind"] for m in marks}, {"stroke", "note"})
        self.assertEqual(next(m for m in marks if m["kind"] == "stroke")["pressure"], 850)
        with self.assertRaises(Problem):
            self.app.add_mark(t, {"text": "  "})

    def test_practice_gauge_records_and_survives_restart(self):
        t = self.app.create({"name": "A"})
        self.app.connect(t, "DEMO")
        time.sleep(2.3)
        count = self.app.summary(self.app.db.test(t))["count"]
        self.assertGreaterEqual(count, 2)
        self.app.gauges.stop(t)
        self.app.db.conn.close()
        self.app = App(self.path)  # as after a reboot
        self.assertEqual(self.app.gauges.info(t)["port"], "DEMO")
        time.sleep(1.3)
        self.assertGreater(self.app.summary(self.app.db.test(t))["count"], count)

    def test_finish_stops_recording_and_exports(self):
        t = self.app.create({"name": "Henrietta 6\" main"})
        self.fill(t, now_ms() - 2 * Q, 20)
        self.app.finish(t)
        self.assertIsNone(self.app.gauges.info(t))
        with self.assertRaises(Problem):
            self.app.connect(t, "DEMO")
        name, text = self.app.export(t, "pressure")
        self.assertTrue(name.endswith("pressure.csv") and '"' not in name)
        self.assertEqual(len(text.strip().splitlines()), 20 * 60 + 2)
        self.assertEqual(len(self.app.history()), 1)

    def test_sharing_sends_backlog_then_resends_on_offset_change(self):
        site = {"rev": None, "rows": {}, "meta": None, "stopped": False}

        def fake_post(url, action, body):
            if action == "pair":
                if body["password"] != "open sesame":
                    raise share.NeedsPassword("That host password is not correct.")
                site["paired"] = True
                return {"ok": True}
            if not site.get("paired"):
                raise share.NeedsPassword("Enter the host password to let this computer share.", fresh=True)
            if action == "stop":
                site.update(stopped=True, rows={}, meta=None)
                return {"ok": True}
            if site["rev"] != body["rev"]:
                site.update(rev=body["rev"], rows={})
            else:
                site["rows"].update({at: psi for at, psi in body["readings"]})
            site["meta"] = body["meta"] or site["meta"]
            return {"ok": True, "last": max(site["rows"], default=0), "has_meta": site["meta"] is not None}

        from recorder import app as app_module, share
        real = share.post
        share.post = app_module.post = fake_post
        try:
            t = self.app.create({"name": "A"})
            self.fill(t, now_ms() - 2 * Q, 5, psi=900)
            with self.assertRaises(Problem) as asked:
                self.app.share_start(t, "https://example.test/live/")
            self.assertEqual(asked.exception.extra, {"password": True, "fresh": True})
            with self.assertRaises(Problem):
                self.app.share_start(t, "https://example.test/live/", "wrong")
            self.assertIsNone(self.app.db.test(t)["share_token"])
            self.app.share_start(t, "https://example.test/live/", "open sesame")
            self.assertNotIn("open sesame", [r["value"] for r in self.app.db.all("SELECT value FROM kv")])
            self.assertEqual(self.app.site(), "https://example.test/live")
            while self.app.uploader.status(t)["pending"]:
                self.assertIsNone(self.app.uploader.push(self.app.db.test(t)))
            self.assertEqual(len(site["rows"]), 301)
            self.assertEqual(site["meta"]["name"], "A")
            self.app.update(t, {"offset": -2})
            for _ in range(3):
                self.app.uploader.push(self.app.db.test(t))
            self.assertEqual(set(site["rows"].values()), {898.0})
            self.app.share_stop(t)
            self.assertTrue(site["stopped"])
            self.assertIsNone(self.app.uploader.push({"id": t}))  # a late upload must not revive the link
            self.assertEqual(site["rows"], {})
            with self.assertRaises(Problem):
                self.app.share_start(t, "ftp://nope")
        finally:
            share.post = app_module.post = real

    def test_bad_numbers_are_refused(self):
        t = self.app.create({"name": "A"})
        with self.assertRaises(Problem):
            self.app.update(t, {"chart_max": "abc"})
        with self.assertRaises(Problem):
            self.app.update(t, {"chart_max": 0})


if __name__ == "__main__":
    unittest.main()
