/* Log book: pressure and temperatures at a chosen interval, newest first.
   Each cell is an actual recorded reading near that time (never averaged or
   filled in); hovering a cell shows when it was recorded. Missing stays "—".
   Shared by the host page and the read-only viewer. */
(function (root) {
  'use strict';
  const INTERVALS = [[5000, '5 sec'], [15000, '15 sec'], [60000, '1 min'], [300000, '5 min'], [900000, '15 min'], [1800000, '30 min'], [3600000, '1 hr']];
  const PAGE = 300;
  const finite = (value) => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));

  // Nearest reading to `at` that has a value for `key`, within `tolerance` ms.
  function nearest(rows, key, at, tolerance) {
    let low = 0, high = rows.length;
    while (low < high) { const mid = (low + high) >>> 1; if (Number(rows[mid].at) < at) low = mid + 1; else high = mid; }
    let best = null;
    for (let i = low - 1; i >= 0 && at - Number(rows[i].at) <= tolerance; i--) if (finite(rows[i][key])) { best = rows[i]; break; }
    for (let i = low; i < rows.length && Number(rows[i].at) - at <= tolerance; i++) {
      if (!finite(rows[i][key])) continue;
      if (!best || Math.abs(Number(rows[i].at) - at) < Math.abs(Number(best.at) - at)) best = rows[i];
      break;
    }
    return best ? { value: Number(best[key]), at: Number(best.at) } : null;
  }

  // Typical gap between logger readings, so a 2-second or 60-second logger is
  // matched sensibly without reaching across an outage.
  function temperatureTolerance(temperatures) {
    const gaps = [];
    for (let i = Math.max(1, temperatures.length - 60); i < temperatures.length; i++) {
      const gap = Number(temperatures[i].at) - Number(temperatures[i - 1].at);
      if (gap > 0) gaps.push(gap);
    }
    gaps.sort((a, b) => a - b);
    return Math.max(30000, Math.min(65000, (gaps[Math.floor(gaps.length / 2)] || 0) + 5000));
  }

  function buildRows({ pressure = [], temperatures = [], channels = [], intervalMs = 60000, maxRows = PAGE }) {
    const latest = Math.max(Number(pressure.at(-1)?.at) || 0, Number(temperatures.at(-1)?.at) || 0);
    if (!latest) return { rows: [], more: false };
    const earliest = Math.min(pressure.length ? Number(pressure[0].at) : Infinity, temperatures.length ? Number(temperatures[0].at) : Infinity);
    const pressureTolerance = Math.min(30000, Math.max(2000, intervalMs / 2));
    const tempTolerance = temperatureTolerance(temperatures);
    const times = [latest];
    let at = Math.floor(latest / intervalMs) * intervalMs;
    if (at === latest) at -= intervalMs;
    while (at >= earliest - intervalMs / 2 && times.length < maxRows + 1) { times.push(at); at -= intervalMs; }
    const more = times.length > maxRows;
    const rows = times.slice(0, maxRows).map((time, index) => ({
      at: time,
      latest: index === 0,
      pressure: nearest(pressure, 'pressure', time, pressureTolerance),
      temps: Object.fromEntries(channels.map((channel) => [channel.key, nearest(temperatures, channel.key, time, tempTolerance)])),
    }));
    rows.forEach((row, index) => {
      const older = rows[index + 1]?.pressure;
      row.change = row.pressure && older ? row.pressure.value - older.value : null;
      // Rate between the two readings actually used, in psi per minute.
      row.rate = row.change !== null && row.pressure.at !== older.at ? row.change / ((row.pressure.at - older.at) / 60000) : null;
    });
    return { rows, more };
  }

  // `extra` is a trailing word (unit, "latest") that phones hide to save width.
  function cell(text, recorded, rowAt, className, extra) {
    const td = document.createElement('td');
    td.textContent = text;
    if (extra) { const span = document.createElement('span'); span.className = 'logbook-extra'; span.textContent = extra; td.append(span); }
    if (className) td.className = className;
    if (recorded && Math.abs(recorded - rowAt) >= 1000) td.title = `Recorded ${new Date(recorded).toLocaleTimeString()}`;
    return td;
  }

  function render(table, data, intervalMs, maxRows) {
    const channels = data.channels || [];
    const { rows, more } = buildRows({ ...data, intervalMs, maxRows });
    const head = document.createElement('tr');
    for (const title of ['Time', 'Pressure', 'Change', ...channels.map((channel) => channel.name)]) {
      const th = document.createElement('th'); th.textContent = title; head.append(th);
      if (title === 'Pressure') { const unit = document.createElement('span'); unit.className = 'logbook-head-unit'; unit.textContent = ' psi'; th.append(unit); }
    }
    table.tHead.replaceChildren(head);
    const body = document.createDocumentFragment();
    const withSeconds = intervalMs < 60000;
    const decimals = data.wholeDegrees ? 0 : 1;
    let day = '';
    for (const row of rows) {
      const date = new Date(row.at);
      const label = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      if (label !== day) {
        day = label;
        const separator = document.createElement('tr'); separator.className = 'logbook-day';
        const td = document.createElement('td'); td.colSpan = 3 + channels.length; td.textContent = label;
        separator.append(td); body.append(separator);
      }
      const tr = document.createElement('tr');
      if (row.latest) tr.className = 'logbook-latest';
      const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(withSeconds || row.latest ? { second: '2-digit' } : {}) });
      tr.append(cell(time, null, row.at, 'logbook-time', row.latest ? ' · latest' : ''));
      tr.append(cell(row.pressure ? row.pressure.value.toFixed(1) : '—', row.pressure?.at, row.at, 'logbook-pressure', row.pressure ? ' psi' : ''));
      const change = row.change;
      const over = data.rateLimit > 0 && row.rate !== null && row.rate > data.rateLimit;
      const changeCell = cell(change === null ? '' : Math.abs(change) < 0.05 ? '0.0' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}`, null, row.at,
        (change === null || Math.abs(change) < 0.05 ? 'logbook-change' : change > 0 ? 'logbook-change up' : 'logbook-change down') + (over ? ' over-limit' : ''));
      if (over) changeCell.title = `${row.rate.toFixed(1)} psi/min, over the ${data.rateLimit} psi/min maximum`;
      // The latest row also shows live pacing against the max rate.
      if (row.latest && data.pace) {
        const pace = document.createElement('span');
        pace.className = `logbook-pace ${data.pace.tone}`;
        pace.textContent = `${data.pace.word} · ${data.pace.shown}`;
        changeCell.append(pace);
      }      tr.append(changeCell);
      for (const channel of channels) {
        const value = row.temps[channel.key];
        tr.append(cell(value ? `${value.value.toFixed(decimals)}°` : '—', value?.at, row.at, 'logbook-temp'));
      }
      body.append(tr);
    }
    if (!rows.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td');
      td.colSpan = 3 + channels.length; td.className = 'log-empty'; td.textContent = 'Readings will appear here as the test records.';
      tr.append(td); body.append(tr);
    }
    table.tBodies[0].replaceChildren(body);
    return more;
  }

  // Builds the interval buttons, table and "show older" button inside `container`.
  // getData() returns { pressure, temperatures, channels: [{key,name}], wholeDegrees }.
  function mount(container, { getData, storageKey = 'grantg-logbook-interval', title = 'Log book' }) {
    let intervalMs = 60000;
    try { const saved = Number(root.localStorage?.getItem(storageKey)); if (INTERVALS.some(([ms]) => ms === saved)) intervalMs = saved; } catch (_) {}
    let maxRows = PAGE, signature = '';
    container.classList.add('logbook');
    container.innerHTML = `<header class="logbook-header"><h3></h3><div class="logbook-intervals" role="group" aria-label="Log book interval">${INTERVALS.map(([ms, label]) => `<button type="button" data-logbook-interval="${ms}">${label}</button>`).join('')}</div></header><p class="logbook-help">Actual readings nearest each time, newest first. Hover a value to see exactly when it was recorded. Missing readings stay blank.</p><div class="log-table-wrap"><table class="logbook-table"><thead></thead><tbody></tbody></table></div><button type="button" class="logbook-more" hidden>Show older rows</button>`;
    container.querySelector('h3').textContent = title;
    const table = container.querySelector('table');
    const moreButton = container.querySelector('.logbook-more');
    const markActive = () => container.querySelectorAll('[data-logbook-interval]').forEach((button) => button.classList.toggle('active', Number(button.dataset.logbookInterval) === intervalMs));
    function refresh(force = false) {
      const data = getData();
      const latest = Math.max(Number(data.pressure?.at(-1)?.at) || 0, Number(data.temperatures?.at(-1)?.at) || 0);
      const next = JSON.stringify([intervalMs, maxRows, latest, data.temperatures?.length || 0, (data.channels || []).map((c) => c.key + c.name), data.wholeDegrees, data.rateLimit, data.pace && data.pace.word + data.pace.shown]);
      if (!force && next === signature) return;
      signature = next;
      moreButton.hidden = !render(table, data, intervalMs, maxRows);
    }
    container.querySelector('.logbook-intervals').addEventListener('click', (event) => {
      const button = event.target.closest('[data-logbook-interval]');
      if (!button) return;
      intervalMs = Number(button.dataset.logbookInterval);
      maxRows = PAGE;
      try { root.localStorage?.setItem(storageKey, String(intervalMs)); } catch (_) {}
      markActive();
      refresh(true);
    });
    moreButton.addEventListener('click', () => { maxRows += PAGE; refresh(true); });
    markActive();
    refresh(true);
    return { refresh };
  }

  const api = { INTERVALS, buildRows, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydroLogbook = api;
})(typeof window !== 'undefined' ? window : globalThis);
