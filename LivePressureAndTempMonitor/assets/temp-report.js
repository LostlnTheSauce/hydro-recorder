/* Temperature comparison report: the electronic probes beside the recorder-chart
   temperatures entered in the Sheet, at each log row, with a summary and one chart
   per probe. Opens as a printable page (Print / Save as PDF) to hand to the owner.
   Read-only: values are shown as recorded and entered, never adjusted. */
(function (root) {
  'use strict';
  const PROBE = '#2a78d6', CHART = '#eb6834';
  const STYLE = `
      @page { size: letter; margin: 0.5in; }
      * { box-sizing: border-box; }
      body { margin: 0 auto; max-width: 7.5in; padding: 16px; font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #fff; }
      h1 { font-size: 19px; margin: 0; } h2 { font-size: 14px; margin: 22px 0 8px; }
      .sub { color: #57606a; margin: 2px 0 14px; }
      .facts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; padding: 10px 12px; border: 1px solid #d0d7de; border-radius: 6px; }
      .facts div span { color: #57606a; margin-right: 6px; }
      table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      th, td { padding: 4px 6px; border-bottom: 1px solid #e5e8eb; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      thead th { color: #57606a; font-weight: 600; font-size: 11px; border-bottom: 1px solid #c4cad1; }
      .summary th small { display: block; color: #57606a; font-weight: 400; }
      .rows { font-size: 10.5px; } .rows td.remarks { text-align: left; color: #57606a; max-width: 1.6in; } .rows td.diff { color: #57606a; }
      .legend { display: flex; gap: 18px; color: #57606a; margin: 4px 0 6px; }
      .legend i { display: inline-block; vertical-align: middle; margin-right: 6px; }
      .legend .line { width: 22px; height: 2px; background: ${PROBE}; } .legend .dot { width: 9px; height: 9px; border-radius: 50%; background: ${CHART}; }
      figure { margin: 0 0 12px; break-inside: avoid; } figcaption { font-weight: 600; margin-bottom: 2px; }
      svg { width: 100%; height: auto; display: block; } svg text { font-size: 10px; fill: #57606a; } svg .grid { stroke: #e5e8eb; stroke-width: 1; }
      .muted, .note { color: #57606a; } .warn { border: 1px solid #d4a72c; background: #fff8c5; padding: 8px 12px; border-radius: 6px; } .note { margin-top: 18px; font-size: 10.5px; }
      .actions { margin: 0 0 14px; } .actions button { font: inherit; padding: 6px 14px; border: 1px solid #c4cad1; border-radius: 6px; background: #f6f8fa; cursor: pointer; }
      /* Digital (blue) and physical (orange), matching the chart line and dots. Values stay dark
         on a light tint so they read and print clearly; headers carry the darker shade. */
      .rows th.digital, .digital-ink { color: #1c5cab; } .rows th.physical, .physical-ink { color: #b5441a; }
      .rows th.digital { background: #e3eefb; border-bottom: 2px solid ${PROBE}; } .rows th.physical { background: #fde9e0; border-bottom: 2px solid ${CHART}; }
      .rows td.digital { background: #f1f6fd; } .rows td.physical { background: #fef4ef; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @media print { .actions { display: none; } body { padding: 0; } }
    `;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
  const signed = (value, digits = 1) => { if (value === null) return '—'; const shown = Number(value.toFixed(digits)); return `${shown > 0 ? '+' : shown < 0 ? '−' : '±'}${Math.abs(shown).toFixed(digits)}`; };

  // Probe minus chart at every row that has both.
  function stats(rows, key) {
    const diffs = rows.map((row) => {
      const probe = num(row[key]?.probe), chart = num(row[key]?.chart);
      return probe === null || chart === null ? null : probe - chart;
    }).filter((value) => value !== null);
    if (!diffs.length) return { count: 0 };
    const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    const within = (limit) => Math.round(diffs.filter((value) => Math.abs(value) <= limit + 1e-9).length / diffs.length * 100);
    return { count: diffs.length, mean, min: Math.min(...diffs), max: Math.max(...diffs), within1: within(1), within2: within(2) };
  }

  // One probe: its readings as a line, the recorder-chart entries as dots, on one °F axis.
  function chartSvg(channel, series, rows, from, to, timeLabel) {
    const W = 680, H = 210, L = 44, R = 12, T = 12, B = 30;
    const points = rows.map((row) => ({ at: row.at, value: num(row[channel.key]?.chart) })).filter((p) => p.value !== null);
    const values = [...series.map((p) => p.value), ...points.map((p) => p.value)];
    if (!values.length) return '<p class="muted">No readings for this probe.</p>';
    let low = Math.floor(Math.min(...values) - 1), high = Math.ceil(Math.max(...values) + 1);
    const step = Math.max(1, Math.ceil((high - low) / 5));
    low = Math.floor(low / step) * step; high = low + step * Math.max(2, Math.ceil((high - low) / step));
    const x = (at) => L + (at - from) / Math.max(1, to - from) * (W - L - R);
    const y = (value) => T + (high - value) / (high - low) * (H - T - B);
    const grid = [];
    for (let value = low; value <= high + 1e-9; value += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="grid"/><text x="${L - 6}" y="${(y(value) + 3.5).toFixed(1)}" text-anchor="end">${value}°</text>`);
    const ticks = [];
    for (let i = 0; i <= 4; i++) { const at = from + (to - from) * i / 4; ticks.push(`<text x="${x(at).toFixed(1)}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${esc(timeLabel(at))}</text>`); }
    // Gaps over 5 minutes are left as gaps, not bridged.
    let path = '', last = null;
    series.forEach((p) => { path += `${last === null || p.at - last > 300000 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`; last = p.at; });
    const dots = points.map((p) => `<circle cx="${x(p.at).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="${CHART}" stroke="#fff" stroke-width="2"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(channel.name)}: digital probe line and physical chart readings">${grid.join('')}${ticks.join('')}<path d="${path}" fill="none" stroke="${PROBE}" stroke-width="2" stroke-linejoin="round"/>${dots}</svg>`;
  }

  function build(data) {
    const channels = data.channels || [];
    const rows = data.rows || [];
    const time = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const stamp = (at) => new Date(at).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const from = Math.min(...rows.map((row) => row.at)), to = Math.max(...rows.map((row) => row.at));
    const job = data.job || {};
    const facts = [['Job number', job.jobNumber], ['PO / AFE', job.poAfe], ['Line', job.line], ['Location', job.location], ['Owner', job.owner], ['Contractor', job.contractor],
      ["Owner's rep / inspector", job.ownerRep], ['Official test', job.period]].filter(([, value]) => value);
    const summary = channels.map((channel) => {
      const s = stats(rows, channel.key);
      return `<tr><th>${esc(channel.name)}${channel.chartSerial ? `<small>Physical chart S/N ${esc(channel.chartSerial)}</small>` : ''}</th><td>${s.count}</td><td><b>${s.count ? `${signed(s.mean)} °F` : '—'}</b></td><td>${s.count ? `${signed(s.min)} to ${signed(s.max)} °F` : '—'}</td><td>${s.count ? `${s.within1}%` : '—'}</td><td>${s.count ? `${s.within2}%` : '—'}</td></tr>`;
    }).join('');
    const charts = channels.map((channel) => `<figure><figcaption>${esc(channel.name)}</figcaption>${chartSvg(channel, data.series?.[channel.key] || [], rows, from, to, time)}</figure>`).join('');
    const head = channels.map((channel) => `<th colspan="3">${esc(channel.name)}</th>`).join('');
    const sub = channels.map(() => '<th class="digital">Digital</th><th class="physical">Physical</th><th>Diff.</th>').join('');
    const body = rows.map((row) => `<tr><td>${esc(time(row.at))}</td><td>${row.pressure === '' || row.pressure === null || row.pressure === undefined ? '—' : esc(row.pressure)}</td>${channels.map((channel) => {
      const probe = num(row[channel.key]?.probe), chart = num(row[channel.key]?.chart);
      return `<td class="digital">${probe === null ? '—' : probe.toFixed(1)}</td><td class="physical">${chart === null ? '—' : chart.toFixed(chart % 1 ? 1 : 0)}</td><td class="diff">${probe === null || chart === null ? '' : signed(probe - chart)}</td>`;
    }).join('')}<td class="remarks">${esc(row.comments || '')}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`Temperature comparison ${job.jobNumber || ''}`.trim())}</title><style>${STYLE}</style></head><body>
      <div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
      <h1>Temperature comparison: <span class="digital-ink">digital probes</span> vs <span class="physical-ink">physical charts</span></h1>
      <p class="sub">${esc(data.company || 'Grant G Solutions')} · prepared ${esc(stamp(data.generatedAt || Date.now()))}</p>
      <div class="facts">${facts.map(([label, value]) => `<div><span>${esc(label)}</span>${esc(value)}</div>`).join('')}</div>
      ${data.probeCount === 0 ? '<p class="warn">No electronic probe readings were loaded when this report was made, so the Digital columns are empty. Open the host page that recorded the test, let Temperatures finish loading, and make the report again.</p>'
        : data.probeCount ? `<p class="muted">${Number(data.probeCount).toLocaleString()} digital probe readings${data.probeSpan ? `, ${esc(stamp(data.probeSpan[0]))} to ${esc(stamp(data.probeSpan[1]))}` : ''}.</p>` : ''}
      <h2>Summary</h2>
      <table class="summary"><thead><tr><th>Probe</th><th>Readings compared</th><th>Average difference (digital − physical)</th><th>Range of difference</th><th>Within ±1 °F</th><th>Within ±2 °F</th></tr></thead><tbody>${summary}</tbody></table>
      <h2>Over the test</h2>
      <div class="legend"><span><i class="line"></i>Digital probe (every reading)</span><span><i class="dot"></i>Physical chart (log entries)</span></div>
      ${charts}
      <h2>Log entries</h2>
      <table class="rows"><thead><tr><th rowspan="2">Time</th><th rowspan="2">PSI</th>${head}<th rowspan="2">Remarks</th></tr><tr>${sub}</tr></thead><tbody>${body}</tbody></table>
      <p class="note"><b class="digital-ink">Digital</b> values are the electronic probe's own reading nearest each log time (${esc(data.loggerNote || 'field data logger')}); a dash means no digital reading was recorded at that time. <b class="physical-ink">Physical</b> values are the recorder-chart temperatures entered in the test log. Differences are digital minus physical. No values have been adjusted.</p>
    </body></html>`;
  }

  // Fewer points for drawing, by time rather than by count: at most one point per slice of the
  // span, so a stretch where readings arrived minutes apart keeps every one of them.
  function thin(list, maxPoints = 900) {
    if (list.length <= maxPoints) return list;
    const slice = (Number(list.at(-1).at) - Number(list[0].at)) / maxPoints;
    const kept = [];
    list.forEach((item) => { if (!kept.length || Number(item.at) - Number(kept.at(-1).at) >= slice) kept.push(item); });
    return kept;
  }

  // Closest reading to `at` in a list sorted by time.
  function nearestIn(list, at) {
    let low = 0, high = list.length - 1;
    if (high < 0) return null;
    while (low < high) { const mid = (low + high) >> 1; if (Number(list[mid].at) < at) low = mid + 1; else high = mid; }
    const after = list[low], before = low > 0 ? list[low - 1] : null;
    return before && Math.abs(Number(before.at) - at) <= Math.abs(Number(after.at) - at) ? before : after;
  }

  // Report data from a saved test (History page): the same log rows the operator page builds
  // (pre-test entries, then every 15 minutes from the official start to its end), the digital
  // probe's nearest reading within 5 minutes, and the physical values read back from the Sheet.
  function fromRecord(record) {
    const test = record.test || {}, events = Array.isArray(test.events) ? test.events : [];
    const readings = [...(record.readings || [])].sort((a, b) => a.at - b.at);
    const temps = [...(record.temperatureReadings || [])].sort((a, b) => a.at - b.at);
    const live = temps.filter((r) => r.source === 'live'), typed = temps.filter((r) => r.source === 'sheet' || r.source === 'manual');
    const startEvent = [...events].reverse().find((e) => e.type === 'official-start');
    const endEvent = [...events].reverse().find((e) => e.type === 'official-end');
    const start = Number(startEvent?.at) || Number(test.workflow?.officialStart) || Date.parse(test.officialStart) || 0;
    const end = Number(endEvent?.at) || Number(test.workflow?.officialEnd) || Date.parse(test.officialEnd) || 0;
    if (!start) throw new Error('This test has no official start time, so there are no log rows to compare.');
    const pressureAt = (at, preferred) => {
      if (num(preferred) !== null) return Math.round(Number(preferred));
      const reading = nearestIn(readings, at);
      return reading && Math.abs(reading.at - at) <= 30000 ? Math.round(Number(reading.pressure)) : '';
    };
    const pre = events.filter((e) => ['ramp', 'note'].includes(e.type) && Number(e.at) < start).sort((a, b) => a.at - b.at)
      .map((e) => ({ at: Number(e.at), pre: true, pressure: pressureAt(Number(e.at), e.pressure), comments: /^Begin pressurizing/i.test(e.label) ? 'Pressure is at 0 psi / Begin pressurizing' : e.label }));
    const last = end || Math.max(start, Number(readings.at(-1)?.at) || 0);
    const official = [];
    for (let at = start; at <= last; at += 15 * 60000) official.push(at);
    if (end && official.at(-1) !== end) official.push(end);
    const keys = ['ambient', 'pipe', 'soil'];
    const rows = [...pre, ...official.map((at, index, all) => ({ at, pressure: pressureAt(at), comments: [index === 0 ? 'Begin test' : '', end && index === all.length - 1 ? 'End test' : ''].filter(Boolean).join(' / ') }))]
      .map((row) => {
        const probe = nearestIn(live, row.at), sheet = typed.find((t) => Math.abs(Number(t.at) - row.at) <= 30000);
        const near = probe && Math.abs(Number(probe.at) - row.at) <= 5 * 60000 ? probe : null;
        return { ...row, ...Object.fromEntries(keys.map((key) => [key, { probe: num(near?.[key]), chart: num(sheet?.[key]) }])) };
      });
    const from = rows[0].at - 10 * 60000, to = rows.at(-1).at + 10 * 60000;
    const inRange = live.filter((r) => r.at >= from && r.at <= to);
    const names = { ambient: 'Ambient', pipe: 'Pipe', soil: 'Soil' };
    const when = (at) => new Date(at).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return {
      generatedAt: Date.now(),
      job: { jobNumber: test.jobNumber, poAfe: test.poAfe, line: test.design?.lineName || test.design?.projectName, location: test.location,
        owner: test.owner || 'Atmos Energy', contractor: test.contractor || 'Bobcat Contracting', ownerRep: test.ownerRep, period: [start, end].filter(Boolean).map(when).join(' to ') },
      channels: keys.map((key) => ({ key, name: names[key] })),
      series: Object.fromEntries(keys.map((key) => [key, thin(inRange.filter((r) => num(r[key]) !== null), 900).map((r) => ({ at: r.at, value: Number(r[key]) }))])),
      rows, probeCount: live.length, probeSpan: live.length ? [live[0].at, live.at(-1).at] : null, officialStart: start, officialEnd: end,
      loggerNote: 'MadgeTech field logger; nearest reading within 5 minutes',
    };
  }

  // Pressure over the test on one psi axis (at least 20 psi tall), with the test window
  // lines when set and the official start and end marked.
  function pressureSvg(series, from, to, windowLines, marks, timeLabel) {
    const W = 680, H = 230, L = 52, R = 12, T = 12, B = 30;
    const values = series.map((p) => p.value);
    if (!values.length) return '<p class="muted">No pressure readings in this period.</p>';
    const windows = [windowLines?.bottom, windowLines?.top].filter((v) => num(v) !== null).map(Number);
    let low = Math.min(...values, ...windows), high = Math.max(...values, ...windows);
    if (high - low < 20) { const mid = (high + low) / 2; low = mid - 10; high = mid + 10; }
    const rough = (high - low) / 5, power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((v) => v >= rough);
    low = Math.floor(low / step) * step; high = Math.ceil(high / step) * step;
    const x = (at) => L + (at - from) / Math.max(1, to - from) * (W - L - R);
    const y = (value) => T + (high - value) / (high - low) * (H - T - B);
    const grid = [];
    for (let value = low; value <= high + 1e-9; value += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="grid"/><text x="${L - 6}" y="${(y(value) + 3.5).toFixed(1)}" text-anchor="end">${Number(value.toFixed(1)).toLocaleString()}</text>`);
    const ticks = [];
    for (let i = 0; i <= 4; i++) { const at = from + (to - from) * i / 4; ticks.push(`<text x="${x(at).toFixed(1)}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${esc(timeLabel(at))}</text>`); }
    const lines = windows.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#57606a" stroke-width="1" stroke-dasharray="5 4"/><text x="${W - R - 2}" y="${(y(v) - 4).toFixed(1)}" text-anchor="end">window ${Number(v).toLocaleString()}</text>`).join('');
    const markLines = (marks || []).filter((m) => m.at >= from && m.at <= to).map((m) => `<line x1="${x(m.at).toFixed(1)}" x2="${x(m.at).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#8c959f" stroke-width="1"/><text x="${(x(m.at) + (x(m.at) > W - R - 40 ? -4 : 4)).toFixed(1)}" y="${T + 10}" text-anchor="${x(m.at) > W - R - 40 ? 'end' : 'start'}">${esc(m.label)}</text>`).join('');
    let path = '', last = null;
    series.forEach((p) => { path += `${last === null || p.at - last > 300000 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`; last = p.at; });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pressure over the test">${grid.join('')}${ticks.join('')}${lines}${markLines}<path d="${path}" fill="none" stroke="#1f2328" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  // Full test report from a saved test: details, pressure summary, the pressure chart, one
  // temperature chart per probe (digital line, physical dots), the 15-minute log and events.
  function fullFromRecord(record) {
    const data = fromRecord(record), test = record.test || {}, design = test.design || {};
    const readings = [...(record.readings || [])].sort((a, b) => a.at - b.at);
    const official = data.rows.filter((row) => !row.pre);
    const start = data.officialStart, end = data.officialEnd || Number(readings.at(-1)?.at) || start;
    const inTest = readings.filter((r) => r.at >= start && r.at <= end && num(r.pressure) !== null);
    const from = start - 15 * 60000, to = end + 15 * 60000;
    const shown = thin(readings.filter((r) => r.at >= from && r.at <= to && num(r.pressure) !== null), 1400);
    const at = (t) => { const r = nearestIn(readings, t); return r && Math.abs(r.at - t) <= 60000 ? Number(r.pressure) : null; };
    const startP = at(start), endP = at(end);
    return { ...data, full: true, design, chartFrom: from, chartTo: to,
      pressureSeries: shown.map((r) => ({ at: r.at, value: Number(r.pressure) })),
      window: { bottom: test.windowBottom || design.windowBottom, top: test.windowTop || design.windowTop },
      pressure: { start: startP, end: endP, change: startP !== null && endP !== null ? endP - startP : null,
        min: inTest.length ? Math.min(...inTest.map((r) => Number(r.pressure))) : null, max: inTest.length ? Math.max(...inTest.map((r) => Number(r.pressure))) : null,
        hours: (end - start) / 3600000, offset: num(test.offset) },
      events: [...(test.events || []), ...(record.notes || []).map((n) => ({ at: n.at, label: n.text }))].filter((e) => e && e.at).sort((a, b) => a.at - b.at),
      officialRows: official.length };
  }

  // The pieces of the digital-only report, shared by the full report and the post-test package.
  function fullParts(data) {
    const channels = data.channels || [], rows = data.rows || [], job = data.job || {}, design = data.design || {}, p = data.pressure || {};
    const time = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const stamp = (at) => new Date(at).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const psi = (v, digits = 1) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(digits)} psi`);
    const facts = [['Job number', job.jobNumber], ['PO / AFE', job.poAfe], ['Line', job.line], ['Location', job.location], ['Owner', job.owner], ['Contractor', job.contractor],
      ["Owner's rep / inspector", job.ownerRep], ['Official test', job.period], ['Test medium', design.testMedium], ['Section length', design.sectionLengthFt ? `${design.sectionLengthFt} ft` : ''],
      ['Target pressure', design.targetPressure ? `${design.targetPressure} psi` : ''], ['Test window', data.window?.bottom && data.window?.top ? `${data.window.bottom}–${data.window.top} psi` : ''],
      ...(data.extraFacts || [])].filter(([, v]) => v);
    const insideWindow = num(data.window?.bottom) !== null && num(data.window?.top) !== null && p.min !== null
      ? (p.min >= Number(data.window.bottom) && p.max <= Number(data.window.top) ? 'Yes' : 'No') : '—';
    // Digital (electronic probe) values only: the physical charts have their own comparison report.
    const official = rows.filter((r) => !r.pre);
    const fmt = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}°`);
    const tempStats = channels.map((channel) => {
      const values = official.map((r) => num(r[channel.key]?.probe)).filter((v) => v !== null);
      const first = official.find((r) => num(r[channel.key]?.probe) !== null), last = [...official].reverse().find((r) => num(r[channel.key]?.probe) !== null);
      const start = first ? num(first[channel.key].probe) : null, end = last ? num(last[channel.key].probe) : null;
      return { channel, start, end, change: start !== null && end !== null ? end - start : null, low: values.length ? Math.min(...values) : null, high: values.length ? Math.max(...values) : null };
    });
    const tempTable = `<table class="summary"><thead><tr><th>Probe</th><th>Start of test</th><th>End of test</th>${data.package ? '<th>Change</th>' : ''}<th>Low</th><th>High</th></tr></thead><tbody>${tempStats.map((t) => `<tr><th>${esc(t.channel.name)}</th><td>${fmt(t.start)}</td><td>${fmt(t.end)}</td>${data.package ? `<td>${t.change === null ? '—' : `${signed(t.change)}°`}</td>` : ''}<td>${fmt(t.low)}</td><td>${fmt(t.high)}</td></tr>`).join('')}</tbody></table>`;
    const tempCharts = channels.map((channel) => `<figure><figcaption>${esc(channel.name)} temperature (°F)</figcaption>${chartSvg(channel, (data.series?.[channel.key] || []).filter((s) => s.at >= data.chartFrom && s.at <= data.chartTo), [], data.chartFrom, data.chartTo, time)}</figure>`).join('');
    const head = channels.map((channel) => `<th>${esc(channel.name)} °F</th>`).join('');
    const body = official.map((row) => `<tr><td>${esc(stamp(row.at))}</td><td>${row.pressure === '' || row.pressure === null || row.pressure === undefined ? '—' : esc(row.pressure)}</td>${channels.map((channel) => {
      const d = num(row[channel.key]?.probe);
      return `<td>${d === null ? '—' : d.toFixed(1)}</td>`;
    }).join('')}<td class="remarks">${esc(row.comments || '')}</td></tr>`).join('');
    const events = (data.events || []).map((e) => `<tr><td>${esc(stamp(e.at))}</td><td class="remarks">${esc(e.label || '')}</td><td>${num(e.pressure) === null ? '' : `${Number(e.pressure).toFixed(1)}`}</td></tr>`).join('');
    return {
      time, stamp, psi, tempStats, tempTable, tempCharts, insideWindow,
      style: `<style>${STYLE}
      .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 4px; }
      .tiles div { border: 1px solid #d0d7de; border-radius: 6px; padding: 8px 10px; } .tiles span { display: block; color: #57606a; font-size: 10.5px; } .tiles b { font-size: 15px; }
      .rows td:first-child { white-space: nowrap; } .page-break { break-before: page; }
      h2 { break-after: avoid; } figure, .tiles, .facts { break-inside: avoid; }
    </style>`,
      header: (title) => `<div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
      <h1>${esc(title)}</h1>
      <p class="sub">${esc(data.company || 'Grant G Solutions')} · prepared ${esc(stamp(data.generatedAt || Date.now()))}</p>
      <div class="facts">${facts.map(([label, value]) => `<div><span>${esc(label)}</span>${esc(value)}</div>`).join('')}</div>`,
      pressureTiles: `<div class="tiles"><div><span>Start of test</span><b>${psi(p.start)}</b></div><div><span>End of test</span><b>${psi(p.end)}</b></div><div><span>Change</span><b>${p.change === null || p.change === undefined ? '—' : `${signed(p.change)} psi`}</b></div><div><span>Duration</span><b>${p.hours ? `${p.hours.toFixed(1)} h` : '—'}</b></div>
        <div><span>Lowest in test</span><b>${psi(p.min)}</b></div><div><span>Highest in test</span><b>${psi(p.max)}</b></div><div><span>Stayed inside window</span><b>${insideWindow}</b></div><div><span>Gauge offset applied</span><b>${p.offset === null || p.offset === undefined ? '—' : `${signed(p.offset)} psi`}</b></div></div>`,
      pressureChart: `<figure style="margin-top:12px"><figcaption>Pressure (psi)</figcaption>${pressureSvg(data.pressureSeries || [], data.chartFrom, data.chartTo, data.window, [{ at: data.officialStart, label: 'Start' }, { at: data.officialEnd, label: 'End' }].filter((m) => m.at), time)}</figure>`,
      log: `<table class="rows"><thead><tr><th>Time</th><th>PSI</th>${head}<th>Remarks</th></tr></thead><tbody>${body}</tbody></table>`,
      events: events ? `<h2>Events and notes</h2><table class="rows"><thead><tr><th>Time</th><th style="text-align:left">Entry</th><th>PSI</th></tr></thead><tbody>${events}</tbody></table>` : '',
      note: `<p class="note">Pressure is the recorded gauge pressure with the gauge offset shown above applied. Temperatures are the electronic (digital) probes' readings nearest each log time (${esc(data.loggerNote || 'field data logger')}). Missing readings are shown as dashes. No values have been adjusted.</p>`,
    };
  }

  function buildFull(data) {
    const parts = fullParts(data), job = data.job || {};
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`Hydrostatic test ${job.jobNumber || ''}`.trim())}</title>${parts.style}</head><body>
      ${parts.header('Hydrostatic test report')}
      <h2>Pressure</h2>
      ${parts.pressureTiles}
      ${parts.pressureChart}
      <h2>Temperatures (digital probes)</h2>
      ${parts.tempTable}
      <div style="margin-top:10px">${parts.tempCharts}</div>
      <h2 class="page-break">Test log (every 15 minutes)</h2>
      ${parts.log}
      ${parts.events}
      ${parts.note}
    </body></html>`;
  }

  // Post-test package: everything a saved test can tell an interested party, official test only.
  function packageFromRecord(record) {
    const data = fullFromRecord(record), test = record.test || {}, wf = test.workflow || {};
    const start = data.officialStart, end = data.officialEnd || data.chartTo;
    const inventory = Array.isArray(record.equipment) ? record.equipment : [];
    const roles = [['deadweight', 'Deadweight tester'], ['pressure_recorder', 'Pressure recorder'], ['digital_gauge', 'Digital gauge'], ['ambient_chart', 'Ambient temperature chart'],
      ['pipe_chart', 'Pipe temperature chart'], ['ground_chart', 'Ground temperature chart'], ['pump', 'Pump']];
    const equipment = roles.map(([role, label]) => {
      const item = inventory.find((entry) => entry.id === (test.equipment || {})[role]);
      if (!item) return null;
      const calibrated = Date.parse(item.calibrationDate || '');
      let due = null;
      if (Number.isFinite(calibrated) && Number(item.intervalMonths) > 0) { const d = new Date(calibrated); d.setMonth(d.getMonth() + Number(item.intervalMonths)); due = d.getTime(); }
      return { role: label, name: item.name || '', serial: item.serial || '', manufacturer: item.manufacturer || '', range: item.range || '', capacity: item.capacity || '', calibrated: Number.isFinite(calibrated) ? calibrated : null, due };
    }).filter(Boolean);
    const baseline = wf.baseline, strokes = Array.isArray(wf.strokes) ? wf.strokes : [];
    const live = (record.temperatureReadings || []).filter((r) => r.source === 'live' && r.at >= start && r.at <= end).sort((a, b) => a.at - b.at);
    const design = test.design || {};
    const official = (record.readings || []).filter((r) => r.at >= start && r.at <= end && num(r.pressure) !== null).sort((a, b) => a.at - b.at);
    return { ...data, package: true, equipment, chartFrom: start, chartTo: end,
      pressureSeries: thin(official, 1400).map((r) => ({ at: r.at, value: Number(r.pressure) })),
      requiredHours: num(design.testDurationHours),
      extraFacts: [['Project', design.projectName], ['Estimated fill', design.estimatedFillGallons ? `${design.estimatedFillGallons} gal` : ''],
        ['Begin GPS', design.beginGps], ['End GPS', design.endGps], ['Recorder GPS', design.recorderGps]],
      strokes: baseline ? { baseline, rows: strokes, step: Number(wf.strokePlan?.step) || 10 } : null,
      pipeline: Array.isArray(test.design?.pipelineRows) ? test.design.pipelineRows : [],
      chartMax: Number(test.chartMax) || 0, traceColor: test.traceColor || '#d43b3b', traceThickness: Number(test.traceThickness) || 1,
      officialReadings: thin(official, 4000), officialTemps: thin(live, 3000), officialEnd: end, testDate: start };
  }

  // Draws the site's own charts (round pressure recorder, round temperature recorder and the
  // combined pressure + temperature graph) for the official test and returns them as images.
  function renderImages(data) {
    const doc = root.document, images = {};
    const holder = doc.createElement('div');
    holder.style.cssText = 'position:fixed;left:-20000px;top:0;width:1000px;';
    doc.body.append(holder);
    const canvas = (width) => { const c = doc.createElement('canvas'); c.style.width = `${width}px`; c.style.display = 'block'; holder.append(c); return c; };
    const startIso = new Date(data.officialStart).toISOString(), endIso = new Date(data.officialEnd).toISOString();
    try {
      const pressure = root.PressureChartRenderer;
      if (pressure) {
        const top = data.officialReadings.reduce((high, r) => Math.max(high, Number(r.pressure)), Number(data.window?.top) || 0);
        const chartMax = data.chartMax && data.chartMax >= top ? data.chartMax : Math.ceil((top * 1.15) / 500) * 500;
        const round = canvas(700);
        pressure.draw(round, data.officialReadings, { chartMax, traceColor: data.traceColor, traceThickness: data.traceThickness, showWindow: true,
          windowTop: num(data.window?.top) === null ? '' : String(data.window.top), windowBottom: num(data.window?.bottom) === null ? '' : String(data.window.bottom),
          testStart: startIso, testEnd: endIso, windowThickness: 1, warningMargin: 10 });
        images.roundPressure = round.toDataURL('image/png');
        const channels = (root.TemperatureChartRenderer?.DEFAULT_CHANNELS || []).filter((c) => ['ambient', 'pipe', 'soil'].includes(c.key));
        const temps = canvas(700);
        pressure.draw(temps, [], { chartMax: 150, gridStep: 10, title: 'TEMPERATURE RECORDER', scaleLabel: '0–150 °F', traceThickness: 1.6, legend: channels,
          traces: channels.map((c) => ({ color: c.color, readings: data.officialTemps.map((r) => ({ at: r.at, value: num(r[c.key]) })) })) });
        images.roundTemps = temps.toDataURL('image/png');
      }
      const timeline = root.TemperatureChartRenderer?.drawTimeline;
      if (timeline) {
        const combined = canvas(1000);
        const channels = root.TemperatureChartRenderer.DEFAULT_CHANNELS.filter((c) => ['ambient', 'pipe', 'soil'].includes(c.key));
        timeline(combined, { pressureReadings: data.officialReadings, showPressure: true, temperatureReadings: data.officialTemps, channelConfig: channels,
          visibleKeys: channels.map((c) => c.key), testPeriod: { start: data.officialStart, end: data.officialEnd }, historyRange: 'official', officialOnly: true,
          notes: [], selectedAt: null, wholeDegrees: false, zoom: null, replay: true, gapLimits: { pressure: 300000, temperature: 300000 } });
        images.combined = combined.toDataURL('image/png');
        images.combinedLegend = channels.map((c) => ({ name: c.name, color: c.color }));
      }
    } finally { holder.remove(); }
    return images;
  }

  function buildPackage(data) {
    const parts = fullParts(data), job = data.job || {}, p = data.pressure || {}, images = data.images || {};
    const day = (at) => (at ? new Date(at).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—');
    // A plain-language summary built only from the recorded values, for readers who skip the tables.
    const said = [];
    if (data.officialStart && data.officialEnd) said.push(`The official test ran ${p.hours ? `${p.hours.toFixed(1)} hours` : ''} from ${parts.stamp(data.officialStart)} to ${parts.stamp(data.officialEnd)}${data.requiredHours ? ` (${data.requiredHours} hours required)` : ''}.`);
    if (p.start !== null && p.end !== null && p.start !== undefined && p.end !== undefined) said.push(`Pressure went from ${parts.psi(p.start)} to ${parts.psi(p.end)} (${signed(p.change)} psi)${parts.insideWindow === 'Yes' ? ' and stayed inside the test window the whole time' : parts.insideWindow === 'No' ? ' and went outside the test window' : ''}.`);
    const moved = parts.tempStats.filter((t) => t.change !== null).map((t) => `${t.channel.name.toLowerCase()} ${t.start.toFixed(1)}° to ${t.end.toFixed(1)}° (${signed(t.change)}°)`);
    if (moved.length) said.push(`Over the same period the digital probes read ${moved.join(', ')}.`);
    const legend = (images.combinedLegend || []).map((c) => `<span><i class="swatch" style="background:${esc(c.color)}"></i>${esc(c.name)}</span>`).join('');
    const rounds = images.roundPressure || images.roundTemps ? `<h2>Recorder charts (official test)</h2><div class="rounds">${images.roundPressure ? `<figure><figcaption>Pressure recorder</figcaption><img src="${images.roundPressure}" alt="Round pressure recorder chart"></figure>` : ''}${images.roundTemps ? `<figure><figcaption>Temperature recorder (digital probes)</figcaption><img src="${images.roundTemps}" alt="Round temperature recorder chart"></figure>` : ''}</div>` : '';
    const combined = images.combined ? `<h2>Pressure and temperatures together</h2><div class="legend"><span><i class="swatch" style="background:#c83d3d"></i>Pressure (left scale)</span>${legend}<span class="muted">temperatures on the right scale</span></div><figure><img src="${images.combined}" alt="Pressure and temperatures over the official test"></figure>` : '';
    const equipment = (data.equipment || []).length ? `<h2>Equipment</h2><table class="rows"><thead><tr><th>Role</th><th style="text-align:left">Equipment</th><th>Serial</th><th>Range</th><th>Calibrated</th><th>Calibration due</th></tr></thead><tbody>${data.equipment.map((e) => {
      const overdue = e.due && data.testDate && e.due < data.testDate;
      return `<tr><td>${esc(e.role)}</td><td class="remarks">${esc([e.name, e.manufacturer].filter(Boolean).join(' · '))}${e.capacity ? ` · ${esc(e.capacity)} gal/stroke` : ''}</td><td>${esc(e.serial || '—')}</td><td>${esc(e.range || '—')}</td><td>${esc(day(e.calibrated))}</td><td${overdue ? ' class="overdue"' : ''}>${e.due ? `${esc(day(e.due))}${overdue ? ' (past due at test)' : ''}` : '—'}</td></tr>`;
    }).join('')}</tbody></table>` : '';
    const pipeline = (data.pipeline || []).filter((r) => Object.values(r || {}).some(Boolean));
    const pipe = pipeline.length ? `<h2>Pipeline data</h2><table class="rows"><thead><tr><th>O.D.</th><th>W.T.</th><th>Grade</th><th>Length</th><th>Buried</th><th>Exposed</th><th>Remarks</th></tr></thead><tbody>${pipeline.map((r) => `<tr>${['od', 'wt', 'grade', 'length', 'buried', 'exposed', 'remarks'].map((k) => `<td${k === 'remarks' ? ' class="remarks"' : ''}>${esc(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    const st = data.strokes;
    let strokes = '';
    if (st && st.rows.length) {
      const last = st.rows.at(-1), totalStrokes = last.counter - st.baseline.counter, capacity = Number(st.baseline.capacity) || 0;
      const rise = Number(last.target) - Number(st.baseline.pressure), gallons = totalStrokes * capacity;
      const lines = [`<tr><td>${esc(st.baseline.pressure)} psi</td><td>${esc(st.baseline.counter)}</td><td>start</td><td></td><td></td><td>${st.baseline.at ? esc(parts.time(st.baseline.at)) : ''}</td></tr>`,
        ...st.rows.map((r) => `<tr><td>${esc(r.target)} psi</td><td>${esc(r.counter)}</td><td>${esc(r.strokes)}</td><td>${Number(r.gallons || 0).toFixed(2)}</td><td>${Number(r.totalGallons || 0).toFixed(2)}</td><td>${r.at ? esc(parts.time(r.at)) : ''}</td></tr>`)];
      const halves = lines.length > 16 ? [lines.slice(0, Math.ceil(lines.length / 2)), lines.slice(Math.ceil(lines.length / 2))] : [lines];
      strokes = `<h2>Stroke count</h2>
        <div class="tiles"><div><span>Pumped up</span><b>${esc(st.baseline.pressure)} → ${esc(last.target)} psi</b></div><div><span>Total strokes</span><b>${totalStrokes.toLocaleString()}</b></div><div><span>Total volume pumped</span><b>${capacity ? `${gallons.toFixed(2)} gal` : '—'}</b></div><div><span>Average per ${esc(st.step)} psi</span><b>${rise > 0 ? `${Math.round(totalStrokes / rise * st.step).toLocaleString()} strokes` : '—'}</b></div></div>
        <p class="muted" style="margin:6px 0 0">${rise > 0 ? `${rise} psi increase. ` : ''}Gallons figured at ${capacity ? `${capacity} gal/stroke${rise > 0 ? `, ${(gallons / rise * st.step).toFixed(2)} gal per ${esc(st.step)} psi on average` : ''}` : 'no pump rate'}.</p>
        <div class="halves">${halves.map((half) => `<table class="rows compact"><thead><tr><th>Pressure</th><th>Counter</th><th>Strokes</th><th>Gallons</th><th>Total gal</th><th>Time</th></tr></thead><tbody>${half.join('')}</tbody></table>`).join('')}</div>`;
    }
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`Post-test package ${job.jobNumber || ''}`.trim())}</title>${parts.style}<style>
      .rounds { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } .rounds figure { margin: 0; }
      .rounds img, figure img { width: 100%; height: auto; display: block; border: 1px solid #e5e8eb; border-radius: 6px; }
      .swatch { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 6px; } td.overdue { color: #b5441a; font-weight: 600; }
      .said { margin: 10px 0 0; padding: 10px 12px; border-left: 3px solid #2a78d6; background: #f6f8fa; border-radius: 0 6px 6px 0; }
      .compact { font-size: 10px; line-height: 1.25; } .compact td, .compact th { padding: 1.5px 5px; } .halves { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; align-items: start; } table.rows { break-inside: auto; } tr { break-inside: avoid; }
    </style></head><body>
      ${parts.header('Hydrostatic test: post-test package')}
      <h2>Result</h2>
      ${parts.pressureTiles}
      ${said.length ? `<p class="said">${esc(said.join(' '))}</p>` : ''}
      ${rounds}
      <div class="page-break">${combined}</div>
      <h2>Pressure (official test)</h2>
      ${parts.pressureChart}
      <h2 class="page-break">Temperatures (digital probes)</h2>
      ${parts.tempTable}
      <div style="margin-top:10px">${parts.tempCharts}</div>
      ${pipe || equipment || strokes ? `<div class="page-break">${pipe}${equipment}${strokes}</div>` : ''}
      <h2 class="page-break">Test log (every 15 minutes)</h2>
      ${parts.log.replace('class="rows"', 'class="rows compact"')}
      ${parts.events.replace('class="rows"', 'class="rows compact"')}
      ${parts.note}
    </body></html>`;
  }

  // Opens the report in a new tab and brings up the print dialog (Save as PDF).
  function open(data) {
    const win = root.open('', '_blank');
    if (!win) throw new Error('The report window was blocked. Allow pop-ups for this site and try again.');
    win.document.open();
    win.document.write(data.package ? buildPackage({ ...data, images: data.images || renderImages(data) }) : data.full ? buildFull(data) : build(data));
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 400);
    return win;
  }

  const api = { build, buildFull, buildPackage, renderImages, stats, open, fromRecord, fullFromRecord, packageFromRecord, thin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydroTempReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
