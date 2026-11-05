/* Temperature log PDF (History page). One document for an owner or inspector: a cover page with
   the job, the temperature data logger and its calibration status, a summary and a chart, then
   the log table at the chosen interval, a sign-off block, and the logger's calibration
   certificate attached at the end. Readings are the logger's as recorded: each row is the
   reading nearest its time, never averaged or adjusted. */
(function (root) {
  'use strict';
  const API = 'calibration-api.php';
  const STYLE_KEY = 'grantg-hydro-temp-log-style';
  const KEYS = ['ambient', 'pipe', 'soil', 'aux'];
  const NAMES = { ambient: 'Ambient', pipe: 'Pipe', soil: 'Soil', aux: 'Auxiliary' };
  const COLORS = { ambient: '#3f7fbe', pipe: '#e07832', soil: '#77624c', aux: '#8a55ae' };
  // An unplugged probe reads about -300 °F; anything outside this is not a temperature.
  const LOW_F = -60, HIGH_F = 250;
  const num = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
  const temp = (value) => { const n = num(value); return n !== null && n >= LOW_F && n <= HIGH_F ? n : null; };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Official start and end, the way the rest of the History page finds them.
  function officialPeriod(test) {
    const events = Array.isArray(test.events) ? test.events : [];
    const startEvent = [...events].reverse().find((e) => e.type === 'official-start');
    const endEvent = [...events].reverse().find((e) => e.type === 'official-end');
    return {
      start: Number(startEvent?.at) || Number(test.workflow?.officialStart) || Date.parse(test.officialStart) || 0,
      end: Number(endEvent?.at) || Number(test.workflow?.officialEnd) || Date.parse(test.officialEnd) || 0,
    };
  }

  function loggerReadings(record) {
    return (record.temperatureReadings || []).filter((r) => r && r.source === 'live' && Number.isFinite(Number(r.at)))
      .map((r) => ({ ...r, at: Number(r.at) })).sort((a, b) => a.at - b.at);
  }

  // Probes that have at least one real reading in this test.
  function probesWithData(record) {
    const live = loggerReadings(record);
    return KEYS.filter((key) => live.some((r) => temp(r[key]) !== null));
  }

  // Index of the first reading at or after `at` in a list sorted by time.
  function firstAtOrAfter(list, at) {
    let low = 0, high = list.length;
    while (low < high) { const mid = (low + high) >> 1; if (list[mid].at < at) low = mid + 1; else high = mid; }
    return low;
  }

  // The log itself: rows every `intervalMin` minutes over the official test (or the whole
  // recording), each probe's nearest reading within half the interval (30 s to 5 min).
  function logData(record, { period = 'official', intervalMin = 15, probes = null } = {}) {
    const test = record.test || {}, live = loggerReadings(record);
    if (!live.length) throw new Error('This test has no readings from the temperature logger.');
    const official = officialPeriod(test);
    const keys = (probes || probesWithData(record)).filter((key) => KEYS.includes(key));
    if (!keys.length) throw new Error('Choose at least one probe for the log.');
    let from, to;
    if (period === 'official') {
      if (!official.start) throw new Error('This test has no official start time. Choose Entire recording.');
      from = official.start; to = official.end || live.at(-1).at;
    } else {
      from = live[0].at; to = live.at(-1).at;
    }
    if (to <= from) throw new Error('There are no logger readings in that period.');
    const step = Math.max(1, Number(intervalMin) || 15) * 60000;
    const within = Math.min(300000, Math.max(30000, step / 2));
    // Whole recording: rows land on the clock (10:00, 10:15…). Official test: rows count from the start, like the paper log.
    const first = period === 'official' ? from : Math.ceil(from / step) * step;
    const times = [];
    if (period !== 'official' && first > from) times.push(from);
    for (let at = first; at <= to + 1; at += step) times.push(at);
    if (times.at(-1) < to - 1000) times.push(to);
    const rows = times.map((at, index) => {
      const values = {};
      // Each probe's nearest reading that has it, inside the window.
      const begin = firstAtOrAfter(live, at - within);
      for (const key of keys) {
        let best = null;
        for (let i = begin; i < live.length && live[i].at <= at + within; i++) {
          if (temp(live[i][key]) !== null && (!best || Math.abs(live[i].at - at) < Math.abs(best.at - at))) best = live[i];
        }
        values[key] = best ? temp(best[key]) : null;
      }
      const remarks = [];
      if (official.start && Math.abs(at - official.start) < 1000) remarks.push('Begin test');
      if (official.end && Math.abs(at - official.end) < 1000) remarks.push('End test');
      return { at, values, remarks: remarks.join(' / '), index };
    });
    const inPeriod = live.filter((r) => r.at >= from && r.at <= to);
    const stats = keys.map((key) => {
      const all = inPeriod.map((r) => temp(r[key])).filter((v) => v !== null);
      const filled = rows.filter((r) => r.values[key] !== null);
      return { key, name: NAMES[key], count: all.length,
        start: filled.length ? filled[0].values[key] : null, end: filled.length ? filled.at(-1).values[key] : null,
        low: all.length ? all.reduce((a, b) => Math.min(a, b)) : null, high: all.length ? all.reduce((a, b) => Math.max(a, b)) : null,
        average: all.length ? all.reduce((s, v) => s + v, 0) / all.length : null };
    });
    const series = Object.fromEntries(keys.map((key) => [key, thin(inPeriod.filter((r) => temp(r[key]) !== null), 900).map((r) => ({ at: r.at, value: temp(r[key]) }))]));
    return { from, to, official, keys, rows, stats, series, intervalMin: step / 60000, within, readingCount: inPeriod.length, period };
  }

  function thin(list, maxPoints) {
    if (list.length <= maxPoints) return list;
    const slice = (list.at(-1).at - list[0].at) / maxPoints, kept = [];
    list.forEach((item) => { if (!kept.length || item.at - kept.at(-1).at >= slice) kept.push(item); });
    return kept;
  }

  function dueDate(item) {
    const calibrated = item?.calibrationDate ? new Date(`${item.calibrationDate}T12:00:00`) : null;
    if (!calibrated || Number.isNaN(calibrated.getTime())) return { calibrated: null, due: null };
    const due = new Date(calibrated); due.setMonth(due.getMonth() + (Number(item.intervalMonths) || 6));
    return { calibrated, due };
  }

  // ---- PDF -----------------------------------------------------------------------------------
  async function loadPdfLib() {
    if (root.HydroCalibration?.loadPdfLib) return root.HydroCalibration.loadPdfLib();
    if (root.PDFLib) return root.PDFLib;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'assets/pdf-lib.min.js';
      script.onload = resolve; script.onerror = () => reject(new Error('The PDF tool could not be loaded. Check the connection and try again.'));
      document.head.append(script);
    });
    if (!root.PDFLib) throw new Error('The PDF tool did not load.');
    return root.PDFLib;
  }

  // Standard PDF fonts only carry Latin-1 and a few extras.
  const pdfText = (value) => String(value ?? '').replace(/−/g, '-').replace(/→/g, 'to').replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, '?');

  // A phone photo or screenshot often has black bands around the page; crop them off.
  async function cleanImage(bytes, mime) {
    if (root.HydroCalibration?.trimDark) return root.HydroCalibration.trimDark(bytes, mime);
    return { bytes, mime };
  }

  /* opts: { period, intervalMin, probes, decimals, logger (equipment item), paper ({ mime, file_name }),
     paperBytes (Uint8Array), company, logoBytes } */
  async function build(record, opts = {}) {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const data = logData(record, opts);
    const test = record.test || {}, design = test.design || {};
    const decimals = [0, 1, 2, 3].includes(Number(opts.decimals)) ? Number(opts.decimals) : 1;
    const logger = opts.logger || null, cal = dueDate(logger);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    const ink = hex('#1f2328'), muted = hex('#5b636b'), rule = hex('#c9d0d6'), faint = hex('#e6eaee'), navy = hex('#1d3557'), band = hex('#f2f5f8'), red = hex('#b5441a');
    const W = 612, H = 792, M = 54, CW = W - M * 2;
    const tz = (() => { try { return new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date(data.from)).find((p) => p.type === 'timeZoneName')?.value || ''; } catch (_) { return ''; } })();
    const day = (at) => new Date(at).toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' });
    const clock = (at, seconds = false) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
    const stamp = (at) => `${day(at)} ${clock(at)}${tz ? ` ${tz}` : ''}`;
    const deg = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(decimals)}`);
    const signed = (v) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '-' : '±'}${Math.abs(v).toFixed(decimals)}`);
    const width = (text, size, f = font) => f.widthOfTextAtSize(pdfText(text), size);
    const fit = (text, size, f, max) => { let t = pdfText(text); while (t && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + '…'; return t; };
    const text = (page, value, x, y, { size = 9, f = font, color = ink, align = 'left', max = null } = {}) => {
      const t = max ? fit(value, size, f, max) : pdfText(value);
      const w = f.widthOfTextAtSize(t, size);
      page.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y, size, font: f, color });
    };
    const job = test.jobNumber || '';
    const serial = logger?.serial || '';
    doc.setTitle(pdfText(`Temperature log${job ? ` - ${job}` : ''}`));
    doc.setAuthor(pdfText(opts.company || 'Grant G Solutions'));
    doc.setCreator('Grant G Solutions hydrotest recorder');
    doc.setSubject('Hydrostatic test temperature log');
    let logo = null;
    if (opts.logoBytes) { try { logo = await doc.embedPng(opts.logoBytes); } catch (_) { logo = null; } }

    // Letterhead on every page of the log (certificate pages get a small footer only).
    // Plain layout: just the data and the calibration details, no letterhead, job section,
    // summary, chart or sign-off.
    const plain = opts.style === 'plain';
    const letterhead = (page, title) => {
      if (plain) return H - M - 6;
      let x = M;
      if (logo) { const s = 26 / logo.height; page.drawImage(logo, { x, y: H - M - 20, width: logo.width * s, height: 26 }); x += logo.width * s + 8; }
      text(page, opts.company || 'Grant G Solutions', x, H - M - 4, { size: 11, f: bold, color: navy });
      text(page, 'Hydrostatic testing', x, H - M - 16, { size: 8, color: muted });
      text(page, title, W - M, H - M - 4, { size: 11, f: bold, color: navy, align: 'right' });
      text(page, [job ? `Job ${job}` : '', test.location || ''].filter(Boolean).join(' · '), W - M, H - M - 16, { size: 8, color: muted, align: 'right', max: 260 });
      page.drawRectangle({ x: M, y: H - M - 28, width: CW, height: 1.5, color: navy });
      return H - M - 46;
    };
    const section = (page, label, y) => {
      text(page, label.toUpperCase(), M, y, { size: 8.5, f: bold, color: navy });
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.6, color: rule });
      return y - 19;
    };
    // Two-column label/value grid.
    const facts = (page, list, y) => {
      const colW = CW / 2, rowH = 15;
      list.forEach(([label, value], i) => {
        const col = i % 2, x = M + col * colW, rowY = y - Math.floor(i / 2) * rowH;
        text(page, label, x, rowY, { size: 8, color: muted });
        text(page, value || '—', x + 96, rowY, { size: 9, f: bold, max: colW - 104 });
      });
      return y - Math.ceil(list.length / 2) * rowH - 6;
    };

    // ---- Cover page
    let page = doc.addPage([W, H]);
    let y = letterhead(page, 'TEMPERATURE LOG');
    text(page, plain ? 'Temperature Log' : 'Hydrostatic Test Temperature Log', M, y - 6, { size: plain ? 16 : 18, f: bold });
    const periodText = `${stamp(data.from)} to ${stamp(data.to)}`;
    text(page, `${data.period === 'official' ? 'Official test' : 'Entire recording'} · ${periodText}`, M, y - 22, { size: 9.5, color: muted });
    y -= 46;
    const hours = (data.to - data.from) / 3600000;
    if (!plain) y = facts(page, [['Job number', job], ['PO / AFE', test.poAfe], ['Owner', test.owner], ['Contractor', test.contractor], ['Location', test.location || design.projectLocation],
      ['Line', design.lineName || design.projectName], ["Owner's rep", test.ownerRep], ['Test medium', design.testMedium],
      ['Official start', data.official.start ? stamp(data.official.start) : ''], ['Official end', data.official.end ? stamp(data.official.end) : ''],
      ['Log period', `${hours.toFixed(hours < 10 ? 2 : 1)} hours`], ['Log interval', `Every ${data.intervalMin} minute${data.intervalMin === 1 ? '' : 's'}`]], section(page, 'Job', y));

    y = section(page, 'Temperature data logger', y - 4);
    const pastDue = cal.due && cal.due.getTime() < data.from;
    y = facts(page, [['Instrument', logger ? [logger.manufacturer, logger.name].filter(Boolean).join(' ') : 'Not selected'], ['Serial number', serial],
      ['Calibrated', cal.calibrated ? day(cal.calibrated) : ''], ['Calibration due', cal.due ? `${day(cal.due)}${pastDue ? ' (PAST DUE)' : ''}` : ''],
      ['Range', logger?.range || ''], ['Certificate', opts.paperBytes ? 'Attached at the end' : 'Not on file'],
      ['Probes logged', data.keys.map((k) => NAMES[k]).join(', ')], ['Readings in period', data.readingCount.toLocaleString()]], y);
    if (pastDue) { text(page, 'The logger\'s calibration was past due when this log began.', M, y + 2, { size: 8.5, f: bold, color: red }); y -= 12; }

    // Summary table and chart (full layout only).
    if (!plain) {
    y = section(page, 'Summary (°F)', y - 4);
    const sumCols = [['Probe', M, 'left'], ['Start', M + 150, 'right'], ['End', M + 215, 'right'], ['Change', M + 285, 'right'], ['Low', M + 350, 'right'], ['High', M + 415, 'right'], ['Average', W - M, 'right']];
    page.drawRectangle({ x: M, y: y - 4, width: CW, height: 15, color: band });
    sumCols.forEach(([label, x, align]) => text(page, label, align === 'right' ? x - 4 : x + 4, y, { size: 8, f: bold, color: muted, align }));
    y -= 16;
    for (const s of data.stats) {
      const change = s.start !== null && s.end !== null ? s.end - s.start : null;
      page.drawRectangle({ x: M + 4, y: y + 1, width: 8, height: 3, color: hex(COLORS[s.key]) });
      text(page, s.name, M + 16, y, { size: 9, f: bold });
      [deg(s.start), deg(s.end), signed(change), deg(s.low), deg(s.high), deg(s.average)].forEach((v, i) => text(page, v, sumCols[i + 1][1] - 4, y, { size: 9, align: 'right' }));
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.4, color: faint });
      y -= 15;
    }
    text(page, 'Start and end are the first and last log rows. Low, high and average use every logger reading in the period.', M, y - 2, { size: 7.5, color: muted });
    y -= 22;

    // Chart.
    y = section(page, 'Temperatures over the period', y);
    const chartH = Math.min(190, y - (M + 70));
    if (chartH > 90) {
      const L = M + 34, R = W - M - 6, T = y - 4, B = y - chartH;
      const values = data.keys.flatMap((k) => data.series[k].map((p) => p.value));
      if (values.length) {
        let low = Math.floor(values.reduce((a, b) => Math.min(a, b)) - 1), high = Math.ceil(values.reduce((a, b) => Math.max(a, b)) + 1);
        const span = Math.max(2, high - low), stepY = [1, 2, 5, 10, 20, 25, 50].find((s) => span / s <= 6) || 50;
        low = Math.floor(low / stepY) * stepY; high = Math.ceil(high / stepY) * stepY; if (high === low) high = low + stepY;
        const px = (at) => L + (at - data.from) / Math.max(1, data.to - data.from) * (R - L);
        const py = (v) => B + (v - low) / (high - low) * (T - B);
        for (let v = low; v <= high + 1e-9; v += stepY) {
          page.drawLine({ start: { x: L, y: py(v) }, end: { x: R, y: py(v) }, thickness: 0.4, color: faint });
          text(page, `${v}°`, L - 5, py(v) - 3, { size: 7.5, color: muted, align: 'right' });
        }
        page.drawLine({ start: { x: L, y: B }, end: { x: R, y: B }, thickness: 0.7, color: rule });
        for (let i = 0; i <= 4; i++) {
          const at = data.from + (data.to - data.from) * i / 4;
          page.drawLine({ start: { x: px(at), y: B }, end: { x: px(at), y: B - 3 }, thickness: 0.6, color: rule });
          text(page, clock(at), px(at), B - 12, { size: 7.5, color: muted, align: i === 0 ? 'left' : i === 4 ? 'right' : 'center' });
        }
        for (const mark of [[data.official.start, 'Start'], [data.official.end, 'End']]) {
          if (!mark[0] || mark[0] <= data.from + 1000 || mark[0] >= data.to - 1000) continue;
          page.drawLine({ start: { x: px(mark[0]), y: B }, end: { x: px(mark[0]), y: T }, thickness: 0.6, color: rule, dashArray: [2, 2] });
          text(page, mark[1], px(mark[0]) + 2, T - 8, { size: 7, color: muted });
        }
        for (const key of data.keys) {
          let path = '', last = null;
          for (const p of data.series[key]) { path += `${last === null || p.at - last > 300000 ? 'M' : 'L'}${(px(p.at) - L).toFixed(2)},${(T - py(p.value)).toFixed(2)} `; last = p.at; }
          if (path) page.drawSvgPath(path, { x: L, y: T, borderColor: hex(COLORS[key]), borderWidth: 1.3 });
        }
        let lx = L;
        for (const key of data.keys) {
          page.drawRectangle({ x: lx, y: B - 27, width: 12, height: 2.5, color: hex(COLORS[key]) });
          text(page, NAMES[key], lx + 16, B - 29, { size: 8, color: muted }); lx += 22 + width(NAMES[key], 8) + 14;
        }
      }
      y = B - 44;
    }
    }

    // ---- Log pages
    const statement = `Readings were recorded by the temperature data logger above${serial ? ` (S/N ${serial})` : ''}. Each row shows the logger reading nearest the row time, within ${data.within >= 60000 ? `${Math.round(data.within / 60000)} minute${data.within >= 120000 ? 's' : ''}` : `${Math.round(data.within / 1000)} seconds`}. Values are shown as recorded: no averaging, corrections or adjustments. A dash means no reading in that window. Times are local${tz ? ` (${tz})` : ''}.`;
    const wrap = (value, size, f, max) => {
      const words = pdfText(value).split(' '), lines = []; let line = '';
      for (const word of words) { const next = line ? `${line} ${word}` : word; if (f.widthOfTextAtSize(next, size) > max && line) { lines.push(line); line = word; } else line = next; }
      if (line) lines.push(line);
      return lines;
    };
    const cols = [['Date', 70, 'left'], ['Time', 62, 'left'], ...data.keys.map((k) => [`${NAMES[k]} °F`, 70, 'right']), ['Remarks', 0, 'left']];
    const fixed = cols.reduce((s, c) => s + c[1], 0); cols[cols.length - 1][1] = Math.max(60, CW - fixed);
    const rowH = 13.2;
    const tableHeader = (p, top) => {
      p.drawRectangle({ x: M, y: top - 5, width: CW, height: 17, color: navy });
      let x = M;
      for (const [label, w, align] of cols) { text(p, label, align === 'right' ? x + w - 6 : x + 6, top, { size: 8, f: bold, color: rgb(1, 1, 1), align }); x += w; }
      return top - 17;
    };
    if (plain) {
      // The readings follow the calibration details on the first page.
      y = section(page, `Readings · every ${data.intervalMin} minute${data.intervalMin === 1 ? '' : 's'}`, y - 4) + 2;
      y = tableHeader(page, y);
    } else {
      page = doc.addPage([W, H]);
      y = letterhead(page, 'TEMPERATURE LOG');
      text(page, `Temperature log · every ${data.intervalMin} minute${data.intervalMin === 1 ? '' : 's'}`, M, y, { size: 12, f: bold });
      text(page, periodText, W - M, y, { size: 8.5, color: muted, align: 'right' });
      y = tableHeader(page, y - 22);
    }
    const withSeconds = data.rows.some((r) => new Date(r.at).getSeconds() !== 0);
    data.rows.forEach((row, i) => {
      if (y < M + 40) { page = doc.addPage([W, H]); y = letterhead(page, 'TEMPERATURE LOG'); y = tableHeader(page, y - 4); }
      if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: CW, height: rowH, color: band });
      let x = M;
      const cells = [day(row.at), clock(row.at, withSeconds), ...data.keys.map((k) => deg(row.values[k])), row.remarks];
      cells.forEach((value, c) => {
        const [, w, align] = cols[c];
        text(page, value, align === 'right' ? x + w - 6 : x + 6, y, { size: 8.5, f: c === cols.length - 1 && value ? bold : font, color: value === '—' ? muted : ink, align, max: w - 10 });
        x += w;
      });
      y -= rowH;
    });
    page.drawLine({ start: { x: M, y: y + rowH - 4 }, end: { x: W - M, y: y + rowH - 4 }, thickness: 0.6, color: rule });

    // Statement and sign-off, on a new page if they do not fit.
    const lines = wrap(statement, 8, font, CW);
    if (y - (lines.length * 11 + (plain ? 10 : 110)) < M + 20) { page = doc.addPage([W, H]); y = letterhead(page, 'TEMPERATURE LOG'); }
    y -= 12;
    lines.forEach((line) => { text(page, line, M, y, { size: 8, color: muted }); y -= 11; });
    y -= 30;
    function sign(x, label) {
      page.drawLine({ start: { x, y }, end: { x: x + 250, y }, thickness: 0.7, color: ink });
      page.drawLine({ start: { x: x + 274, y }, end: { x: x + 384, y }, thickness: 0.7, color: ink });
      text(page, label, x, y - 11, { size: 8, color: muted, max: 250 }); text(page, 'Date', x + 274, y - 11, { size: 8, color: muted });
    };
    if (!plain) { sign(M, 'Recorded by'); y -= 42; sign(M, "Reviewed by (owner's representative / inspector)"); }

    const logPages = doc.getPageCount();
    // ---- Calibration certificate
    if (opts.paperBytes && opts.paper) {
      const caption = `Calibration certificate · ${[logger?.manufacturer, logger?.name].filter(Boolean).join(' ') || 'Temperature data logger'}${serial ? ` · S/N ${serial}` : ''}`;
      let added = false;
      if (opts.paper.mime === 'application/pdf') {
        try {
          const source = await PDFDocument.load(opts.paperBytes, { ignoreEncryption: true });
          if (source.isEncrypted) throw new Error('protected');
          (await doc.copyPages(source, source.getPageIndices())).forEach((p) => doc.addPage(p));
          added = true;
        } catch (_) { added = false; }
      } else {
        const cleaned = await cleanImage(opts.paperBytes, opts.paper.mime);
        const image = cleaned.mime === 'image/png' ? await doc.embedPng(cleaned.bytes) : await doc.embedJpg(cleaned.bytes);
        const p = doc.addPage([W, H]);
        const top = letterhead(p, 'CALIBRATION CERTIFICATE');
        text(p, caption, M, top, { size: 10, f: bold, max: CW });
        const boxTop = top - 14, boxH = boxTop - (M + 18);
        const scale = Math.min(CW / image.width, boxH / image.height);
        const w = image.width * scale, h = image.height * scale;
        p.drawImage(image, { x: M + (CW - w) / 2, y: boxTop - h, width: w, height: h });
        p.drawRectangle({ x: M + (CW - w) / 2, y: boxTop - h, width: w, height: h, borderColor: rule, borderWidth: 0.6 });
        added = true;
      }
      if (!added) {
        const p = doc.addPage([W, H]);
        const top = letterhead(p, 'CALIBRATION CERTIFICATE');
        text(p, caption, M, top, { size: 10, f: bold, max: CW });
        text(p, `The certificate on file (${opts.paper.file_name || 'PDF'}) is a protected PDF and could not be combined. Attach it separately.`, M, top - 18, { size: 9, color: red, max: CW });
      }
    }

    // Footers: job and logger on the left, page numbers on the right.
    const pages = doc.getPages(), total = pages.length, made = new Date().toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' });
    pages.forEach((p, i) => {
      const { width: pw } = p.getSize();
      const left = i < logPages ? `Temperature log${job && !plain ? ` · Job ${job}` : ''}${serial ? ` · Logger S/N ${serial}` : ''} · Prepared ${made}` : `Attachment: calibration certificate${serial ? ` · S/N ${serial}` : ''}`;
      if (i < logPages) p.drawLine({ start: { x: M, y: M - 8 }, end: { x: pw - M, y: M - 8 }, thickness: 0.5, color: rule });
      text(p, left, M, i < logPages ? M - 20 : 14, { size: 7.5, color: muted, max: pw - M * 2 - 70 });
      text(p, `Page ${i + 1} of ${total}`, pw - M, i < logPages ? M - 20 : 14, { size: 7.5, color: muted, align: 'right' });
    });
    return doc.save();
  }

  // ---- History page dialog -------------------------------------------------------------------
  async function fetchPapers() {
    const response = await fetch(`${API}?action=list`, { headers: { Accept: 'application/json' } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Calibration papers are unavailable.');
    return { papers: new Map((result.papers || []).map((p) => [p.equipment_id, p])), items: result.equipment?.items || [] };
  }

  async function openDialog(record) {
    const dialog = document.getElementById('tempLogDialog');
    if (!dialog || !record) return;
    const test = record.test || {}, message = dialog.querySelector('.temp-log-message');
    const present = probesWithData(record);
    if (!present.length) throw new Error('This test has no readings from the temperature logger.');
    const enabled = Array.isArray(test.enabledProbes) ? test.enabledProbes : ['ambient', 'pipe', 'soil'];
    dialog.querySelector('.temp-log-probes').innerHTML = present.map((key) => `<label><input type="checkbox" value="${key}"${enabled.includes(key) ? ' checked' : ''}> ${NAMES[key]}</label>`).join('');
    const official = officialPeriod(test);
    const periodSelect = dialog.querySelector('.temp-log-period');
    periodSelect.value = official.start ? 'official' : 'all';
    periodSelect.querySelector('option[value="official"]').disabled = !official.start;
    // Layout: the last one used on this browser (Full the first time).
    const styleSelect = dialog.querySelector('.temp-log-style');
    try { styleSelect.value = root.localStorage.getItem(STYLE_KEY) === 'plain' ? 'plain' : 'full'; } catch (_) { styleSelect.value = 'full'; }
    const decimals = Number(test.temperatureDecimals);
    dialog.querySelector('.temp-log-decimals').value = String([1, 2, 3].includes(decimals) ? decimals : 1);
    const loggerSelect = dialog.querySelector('.temp-log-logger');
    loggerSelect.innerHTML = '<option value="">Loading equipment…</option>';
    message.textContent = '';
    dialog.querySelector('.temp-log-download').hidden = true;
    dialog.showModal();
    let papers = new Map(), items = [];
    try { ({ papers, items } = await fetchPapers()); } catch (error) { message.textContent = `Calibration papers could not be loaded: ${error.message}`; }
    // The equipment saved with this test, plus the current library (newer entries win).
    const byId = new Map();
    for (const item of [...(record.equipment || []), ...items]) if (item?.id) byId.set(item.id, item);
    const all = [...byId.values()];
    const loggers = all.filter((item) => item.type === 'temperature_logger');
    const others = all.filter((item) => item.type !== 'temperature_logger' && item.type !== 'pump' && papers.has(item.id));
    const label = (item) => `${[item.manufacturer, item.name].filter(Boolean).join(' ')}${item.serial ? ` · S/N ${item.serial}` : ''}${papers.has(item.id) ? '' : ' (no certificate on file)'}`;
    loggerSelect.innerHTML = ['<option value="">No logger / no certificate</option>',
      loggers.length ? `<optgroup label="Temperature data loggers">${loggers.map((i) => `<option value="${esc(i.id)}">${esc(label(i))}</option>`).join('')}</optgroup>` : '',
      others.length ? `<optgroup label="Other equipment with a certificate">${others.map((i) => `<option value="${esc(i.id)}">${esc(label(i))}</option>`).join('')}</optgroup>` : ''].join('');
    const chosen = (test.equipment || {}).temperature_logger;
    loggerSelect.value = loggers.some((i) => i.id === chosen) ? chosen : (loggers.find((i) => papers.has(i.id)) || loggers.find((i) => i.isDefault) || loggers[0])?.id || '';
    dialog.querySelector('.temp-log-help').hidden = loggers.length > 0;

    dialog.onsubmit = async (event) => {
      event.preventDefault();
      if (event.submitter?.value === 'cancel') { dialog.close(); return; }
      const probes = [...dialog.querySelectorAll('.temp-log-probes input:checked')].map((box) => box.value);
      if (!probes.length) { message.textContent = 'Tick at least one probe.'; return; }
      const win = root.open('', '_blank');
      const button = dialog.querySelector('[value="build"]');
      button.disabled = true; message.textContent = 'Building the PDF…';
      try {
        const logger = byId.get(loggerSelect.value) || null, paper = logger ? papers.get(logger.id) : null;
        let paperBytes = null;
        if (paper) {
          const response = await fetch(`${API}?action=file&equipment=${encodeURIComponent(logger.id)}`);
          if (!response.ok) throw new Error('The calibration certificate could not be downloaded. Try again.');
          paperBytes = new Uint8Array(await response.arrayBuffer());
        }
        let logoBytes = null;
        try { const r = await fetch('assets/grant-g-logo.png'); if (r.ok) logoBytes = new Uint8Array(await r.arrayBuffer()); } catch (_) {}
        try { root.localStorage.setItem(STYLE_KEY, styleSelect.value); } catch (_) {}
        const bytes = await build(record, { style: styleSelect.value, period: periodSelect.value, intervalMin: Number(dialog.querySelector('.temp-log-interval').value), probes,
          decimals: Number(dialog.querySelector('.temp-log-decimals').value), logger, paper, paperBytes, logoBytes });
        const name = `Temperature log${test.jobNumber ? ` - ${test.jobNumber}` : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = dialog.querySelector('.temp-log-download');
        link.href = url; link.download = name; link.hidden = false;
        if (win) win.location.href = url;
        message.textContent = `Ready${paperBytes ? ', with the calibration certificate attached' : logger ? '. No certificate is on file for that logger' : ''}. It opened in a new tab; or download it below.`;
      } catch (error) {
        if (win) win.close();
        message.textContent = error.message || String(error);
      } finally { button.disabled = false; }
    };
  }

  const api = { logData, build, openDialog, probesWithData, officialPeriod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydroTempLog = api;
})(typeof window !== 'undefined' ? window : globalThis);
