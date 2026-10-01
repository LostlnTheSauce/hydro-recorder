(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('t') || '';
  const STALE_MS = 30000;
  let points = [], cursor = 0, rev = 0, busy = false, skew = 0;

  function el(tag, props, ...kids) {
    const node = Object.assign(document.createElement(tag), props || {});
    kids.forEach((kid) => node.append(kid));
    return node;
  }
  const time = (ms, seconds) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  const date = (ms) => new Date(ms).toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' });
  const whole = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
  const span = (ms) => `${Math.floor(ms / 3600000)} h ${Math.floor((ms % 3600000) / 60000)} min`;
  function fresh(node, key) {
    if (node.dataset.key === key) return false;
    node.dataset.key = key;
    return true;
  }

  function gone(title, help) {
    $('test').hidden = true;
    $('welcome').hidden = false;
    $('alert').hidden = true;
    $('gone').textContent = title;
    $('goneHelp').textContent = help;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(`api.php?a=view&t=${encodeURIComponent(token)}&since=${cursor}&rev=${rev}`);
      const data = await response.json();
      if (!response.ok) gone(data.error || 'This test is not available.', 'Ask the person running the test for a new link.');
      else {
        if (data.fresh) points = [];
        rev = data.rev;
        points = points.concat(data.points);
        if (points.length) cursor = points[points.length - 1][0];
        if (points.length > 14000) { points = []; cursor = 0; }
        skew = data.now - Date.now();
        render(data);
      }
    } catch (e) {
      $('alert').hidden = false;
      $('alert').textContent = 'Cannot reach the website. Check your internet connection; this page keeps trying.';
    }
    busy = false;
  }

  function render(data) {
    const m = data.meta, d = m.details || {}, now = data.now, latest = points.length ? points[points.length - 1] : null;
    $('welcome').hidden = true;
    $('test').hidden = false;
    document.title = `${m.name} · live hydrotest`;
    $('name').textContent = m.name;
    $('jobLine').textContent = [d.job && `Job ${d.job}`, d.po && `PO/AFE ${d.po}`, d.location, d.inspector && `Inspector: ${d.inspector}`].filter(Boolean).join(' · ');
    $('psi').textContent = latest ? latest[1].toFixed(1) : '—';

    const quiet = now - data.updated, behind = latest ? now - latest[0] : null;
    let state = 'live', text = latest ? `Live. Last reading ${time(latest[0], true)}.` : 'Waiting for the first reading.';
    let warning = '';
    if (m.closed_at) { state = ''; text = `Test finished ${date(m.closed_at)} ${time(m.closed_at)}.`; }
    else if (quiet > STALE_MS) {
      state = 'lost'; text = `No update for ${span(quiet)}.`;
      warning = 'The test site has stopped sending. It has probably lost its internet connection. Recording continues there, and the missing part fills in here when it reconnects.';
    } else if (m.gauge !== 'live' || (behind !== null && behind > STALE_MS)) { state = 'silent'; text = 'Connected to the test site, but the gauge is not sending readings.'; }
    if (fresh($('gauge'), JSON.stringify([state, text]))) $('gauge').replaceChildren(el('span', { className: `dot ${state}` }), el('span', {}, text));
    $('alert').hidden = !warning;
    $('alert').textContent = warning;

    const from = m.official_start || 0, to = m.official_end || Infinity;
    const inside = points.filter(([at]) => at >= from && at <= to).map(([, psi]) => psi);
    $('low').textContent = inside.length ? whole(Math.min(...inside)) : '—';
    $('high').textContent = inside.length ? whole(Math.max(...inside)) : '—';

    const start = m.official_start, end = m.official_end;
    const big = !start ? 'Not started' : end ? `${time(start)} – ${time(end)}` : `Started ${time(start)}`;
    const hint = !start ? '' : end ? `${date(start)} · ${span(end - start)}`
      : now < start ? `Starts in ${span(start - now)}` : `${span(now - start)} elapsed · ${m.duration_hours} hours is up at ${time(start + m.duration_hours * 3600000)}`;
    if (fresh($('official'), big + hint)) $('official').replaceChildren(el('div', { className: 'big-line' }, big), el('p', { className: 'hint' }, hint));

    const notes = m.notes || [];
    $('notesCard').hidden = !notes.length;
    if (fresh($('marks'), JSON.stringify(notes))) $('marks').replaceChildren(...notes.map((n) => el('li', {}, el('time', {}, time(n.at)), el('span', {}, n.text))));

    const record = m.record || [];
    if (fresh($('rows'), JSON.stringify(record))) {
      const rows = record.map((r) => el('tr', {}, el('td', {}, date(r.at)), el('td', {}, time(r.at)),
        el('td', { className: r.pressure == null ? 'blank' : '' }, r.pressure == null ? 'No reading' : `${whole(r.pressure)} psi`), el('td', {}, r.remark)));
      $('rows').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 4, className: 'muted' }, 'Rows appear every 15 minutes.'))]));
    }

    RecorderChart.draw($('chart'), points, {
      max: m.chart_max, pen: 1, title: m.name, lift: true, low: m.window_low, high: m.window_high,
      start, end: end || (start ? start + m.duration_hours * 3600000 : null),
    });
  }

  setInterval(() => { $('clock').textContent = time(Date.now() + skew, true); }, 1000);
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) gone('This link is not valid.', 'Ask the person running the test for a new link.');
  else { tick(); setInterval(tick, 2000); }
})();
