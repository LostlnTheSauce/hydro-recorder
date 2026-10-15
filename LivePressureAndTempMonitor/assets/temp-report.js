/* Temperature comparison report: the electronic probes beside the recorder-chart
   temperatures entered in the Sheet, at each log row, with a summary and one chart
   per probe. Opens as a printable page (Print / Save as PDF) to hand to the owner.
   Read-only: values are shown as recorded and entered, never adjusted. */
(function (root) {
  'use strict';
  const PROBE = '#2a78d6', CHART = '#eb6834';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
  const signed = (value, digits = 1) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}`);

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
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(channel.name)}: electronic probe line and recorder chart readings">${grid.join('')}${ticks.join('')}<path d="${path}" fill="none" stroke="${PROBE}" stroke-width="2" stroke-linejoin="round"/>${dots}</svg>`;
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
      return `<tr><th>${esc(channel.name)}${channel.chartSerial ? `<small>Chart S/N ${esc(channel.chartSerial)}</small>` : ''}</th><td>${s.count}</td><td><b>${s.count ? `${signed(s.mean)} °F` : '—'}</b></td><td>${s.count ? `${signed(s.min)} to ${signed(s.max)} °F` : '—'}</td><td>${s.count ? `${s.within1}%` : '—'}</td><td>${s.count ? `${s.within2}%` : '—'}</td></tr>`;
    }).join('');
    const charts = channels.map((channel) => `<figure><figcaption>${esc(channel.name)}</figcaption>${chartSvg(channel, data.series?.[channel.key] || [], rows, from, to, time)}</figure>`).join('');
    const head = channels.map((channel) => `<th colspan="3">${esc(channel.name)}</th>`).join('');
    const sub = channels.map(() => '<th>Probe</th><th>Chart</th><th>Diff.</th>').join('');
    const body = rows.map((row) => `<tr><td>${esc(time(row.at))}</td><td>${row.pressure === '' || row.pressure === null || row.pressure === undefined ? '—' : esc(row.pressure)}</td>${channels.map((channel) => {
      const probe = num(row[channel.key]?.probe), chart = num(row[channel.key]?.chart);
      return `<td>${probe === null ? '—' : probe.toFixed(1)}</td><td>${chart === null ? '—' : chart.toFixed(chart % 1 ? 1 : 0)}</td><td class="diff">${probe === null || chart === null ? '' : signed(probe - chart)}</td>`;
    }).join('')}<td class="remarks">${esc(row.comments || '')}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`Temperature comparison ${job.jobNumber || ''}`.trim())}</title><style>
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
      .muted, .note { color: #57606a; } .note { margin-top: 18px; font-size: 10.5px; }
      .actions { margin: 0 0 14px; } .actions button { font: inherit; padding: 6px 14px; border: 1px solid #c4cad1; border-radius: 6px; background: #f6f8fa; cursor: pointer; }
      @media print { .actions { display: none; } body { padding: 0; } }
    </style></head><body>
      <div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
      <h1>Temperature comparison: electronic probes and recorder charts</h1>
      <p class="sub">${esc(data.company || 'Grant G Solutions')} · prepared ${esc(stamp(data.generatedAt || Date.now()))}</p>
      <div class="facts">${facts.map(([label, value]) => `<div><span>${esc(label)}</span>${esc(value)}</div>`).join('')}</div>
      <h2>Summary</h2>
      <table class="summary"><thead><tr><th>Probe</th><th>Readings compared</th><th>Average difference (probe − chart)</th><th>Range of difference</th><th>Within ±1 °F</th><th>Within ±2 °F</th></tr></thead><tbody>${summary}</tbody></table>
      <h2>Over the test</h2>
      <div class="legend"><span><i class="line"></i>Electronic probe (every reading)</span><span><i class="dot"></i>Recorder chart (log entries)</span></div>
      ${charts}
      <h2>Log entries</h2>
      <table class="rows"><thead><tr><th rowspan="2">Time</th><th rowspan="2">PSI</th>${head}<th rowspan="2">Remarks</th></tr><tr>${sub}</tr></thead><tbody>${body}</tbody></table>
      <p class="note">Probe values are the electronic probe's own reading nearest each log time (${esc(data.loggerNote || 'field data logger')}); a dash means no probe reading was recorded at that time. Chart values are the recorder-chart temperatures entered in the test log. Differences are probe minus chart. No values have been adjusted.</p>
    </body></html>`;
  }

  // Opens the report in a new tab and brings up the print dialog (Save as PDF).
  function open(data) {
    const win = root.open('', '_blank');
    if (!win) throw new Error('The report window was blocked. Allow pop-ups for this site and try again.');
    win.document.open();
    win.document.write(build(data));
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 400);
    return win;
  }

  const api = { build, stats, open };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydroTempReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
