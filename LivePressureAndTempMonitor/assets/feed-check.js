/* Temperature feed check: was the logger taking readings and we did not get
   them, or was it taking fewer readings than it should? Each minute of a
   recording is compared with the website reading interval, using when each
   reading reached the site and the field laptop's check-ins (every 5 seconds,
   saying whether MadgeTech is delivering readings). Read-only: nothing is
   changed or filled in. */
(function (root) {
  'use strict';
  const MINUTE = 60000;
  const STATUS = {
    ok: { label: 'On time', tone: 'ok' },
    late: { label: 'Internet dropped, caught up', tone: 'late', why: 'The laptop kept recording and sent these readings when the connection came back. Nothing was lost.' },
    madgetech: { label: 'MadgeTech not sending', tone: 'bad', why: 'The field laptop was online but MadgeTech was not giving it readings. Check the logger USB cable, MadgeTech 4 and the laptop temperature.' },
    silent: { label: 'Laptop silent', tone: 'bad', why: 'The field laptop was not checking in and these readings never arrived: it was frozen, asleep or off, or the field app was closed. (If it is still offline, they may arrive later.)' },
    waiting: { label: 'Taken, not received', tone: 'warn', why: 'MadgeTech was delivering readings, but they have not reached the site. Check the field app window for upload errors.' },
    short: { label: 'Fewer readings', tone: 'warn', why: 'MadgeTech sent fewer readings than the website interval expects. A slow or overheated laptop, or a longer reading interval in MadgeTech, does this.' },
    unknown: { label: 'Missing', tone: 'bad', why: 'Before laptop check-ins were logged, so the cause cannot be told apart.' },
  };

  function analyze(data, now = Date.now()) {
    const readings = new Map((data.minutes || []).map((row) => [Number(row.at), row]));
    const checkins = new Map((data.checkins || []).map((row) => [Number(row.at), row]));
    const since = data.checkins_since === null || data.checkins_since === undefined ? null : Number(data.checkins_since);
    const rows = [];
    for (const recording of data.recordings || []) {
      const expected = 60 / (Number(recording.interval_seconds) || 2);
      // Whole minutes only: the first and last partial minutes would look short.
      const first = Math.ceil(Number(recording.from) / MINUTE) * MINUTE;
      const end = Math.floor(Math.min(recording.to ?? now, now) / MINUTE) * MINUTE;
      for (let at = first; at < end; at += MINUTE) {
        const got = readings.get(at) || { readings: 0, late: 0 };
        const check = checkins.get(at);
        const count = Math.min(Number(got.readings) || 0, expected), late = Number(got.late) || 0;
        let status;
        if (count >= expected * 0.9) status = late >= count / 2 ? 'late' : 'ok';
        else if (since === null || at < since) status = count ? 'short' : 'unknown';
        else if (!check || !check.checkins) status = count && late >= count / 2 ? 'late' : 'silent';
        else if (check.ready < check.checkins / 2) status = 'madgetech';
        else status = count ? 'short' : 'waiting';
        rows.push({ at, status, readings: count, expected, late, laptopTempF: check?.laptop_temp_f ?? null });
      }
    }
    rows.sort((a, b) => a.at - b.at);
    const stretches = [];
    for (const row of rows) {
      const last = stretches.at(-1);
      if (last && last.status === row.status && last.to === row.at) {
        last.to = row.at + MINUTE; last.readings += row.readings; last.expected += row.expected; last.late += row.late; last.minutes++;
        if (row.laptopTempF !== null) last.laptopTempF = Math.max(last.laptopTempF ?? 0, row.laptopTempF);
      } else stretches.push({ status: row.status, from: row.at, to: row.at + MINUTE, readings: row.readings, expected: row.expected, late: row.late, minutes: 1, laptopTempF: row.laptopTempF });
    }
    const total = rows.reduce((sum, row) => ({ readings: sum.readings + row.readings, expected: sum.expected + row.expected, late: sum.late + row.late }), { readings: 0, expected: 0, late: 0 });
    return { rows, stretches, total, loggedSince: since };
  }

  const time = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render(box, result) {
    const { rows, stretches, total } = result;
    if (!rows.length) { box.innerHTML = '<p class="feed-empty">No full minutes of temperature recording yet.</p>'; return; }
    const percent = total.expected ? Math.round(total.readings / total.expected * 1000) / 10 : 0;
    const problems = stretches.filter((s) => s.status !== 'ok');
    const span = rows.at(-1).at + MINUTE - rows[0].at;
    const strip = stretches.map((s) => `<span class="feed-seg ${STATUS[s.status].tone}" style="flex-grow:${s.to - s.from}" title="${esc(`${time(s.from)}–${time(s.to)} · ${STATUS[s.status].label}`)}"></span>`).join('');
    box.innerHTML = `<p class="feed-summary"><strong>${percent}%</strong> of expected readings received (${total.readings.toLocaleString()} of ${total.expected.toLocaleString()})${total.late ? ` · ${total.late.toLocaleString()} arrived late after an internet drop` : ''}.</p>
      <div class="feed-strip" aria-hidden="true">${strip}</div>
      <div class="feed-strip-ends"><span>${esc(time(rows[0].at))}</span><span>${esc(time(rows[0].at + span))}</span></div>
      <div class="feed-legend">${['ok', 'late', 'warn', 'bad'].map((tone) => `<span><i class="feed-seg ${tone}"></i>${{ ok: 'On time', late: 'Caught up late', warn: 'Fewer / not received', bad: 'Missing' }[tone]}</span>`).join('')}</div>
      ${problems.length ? `<ul class="feed-problems">${problems.map((s) => `<li class="${STATUS[s.status].tone}"><b>${esc(time(s.from))}–${esc(time(s.to))}</b> · ${esc(STATUS[s.status].label)} · ${s.readings.toLocaleString()} of ${s.expected.toLocaleString()} readings${s.status === 'short' ? ` (about ${Math.round(s.readings / s.minutes)} a minute instead of ${Math.round(s.expected / s.minutes)})` : ''}${s.laptopTempF ? ` · laptop up to ${s.laptopTempF} °F` : ''}<small>${esc(STATUS[s.status].why)}</small></li>`).join('')}</ul>`
        : '<p class="feed-good">Every minute has its readings.</p>'}
      ${result.loggedSince === null ? '<p class="feed-note">Laptop check-ins are logged from now on, so later checks can say why a gap happened.</p>' : ''}`;
  }

  // Adds the card to a test's Temperatures page. load() returns the server's feed_check result.
  function mount(panel, { load }) {
    const card = document.createElement('details');
    card.className = 'feed-check-panel';
    card.innerHTML = `<summary><span>Feed check</span><small>Was the logger reading, and did the readings reach the site?</small></summary>
      <div class="feed-check-body"><button type="button" class="feed-check-run">Check the feed</button><p class="feed-check-status" role="status"></p><div class="feed-check-result"></div></div>`;
    const anchor = panel.querySelector('.manual-temperature-panel');
    panel.insertBefore(card, anchor || null);
    const status = card.querySelector('.feed-check-status'), box = card.querySelector('.feed-check-result'), button = card.querySelector('.feed-check-run');
    async function run() {
      button.disabled = true; status.textContent = 'Checking…';
      try {
        const data = await load();
        render(box, analyze(data, Number(data.server_time) || Date.now()));
        status.textContent = `Checked ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
      } catch (error) { status.textContent = error.message || String(error); }
      finally { button.disabled = false; }
    }
    button.addEventListener('click', run);
    card.addEventListener('toggle', () => { if (card.open && !box.innerHTML) run(); });
    return { run };
  }

  const api = { analyze, mount, STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydroFeedCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
