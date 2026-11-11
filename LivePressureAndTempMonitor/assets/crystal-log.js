/* Crystal data log (History page): the pressure readings this site recorded from the Crystal XP2i,
   written as the Excel workbook Crystal's DataLoggerXP saves for a logged run (Report sheet with
   chart, Data sheet with the run details and one "Time / Reading" row per logging interval), so a
   customer's software that reads those files takes it as is. Pressures are the gauge's own readings,
   as the gauge would have logged them: never the recorder's offset. */
(function (root) {
  'use strict';
  const MAX_READINGS = 32000; // the XP2i's log memory, and the rows the Report chart covers
  const KEY = 'grantg-hydro-crystal-log';
  const xml = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));

  // The gauge reading behind a recorded pressure: the inverse of the recorder's offset and taper.
  function gaugePressure(recorded, offset, taper) {
    const value = Number(recorded), off = Number(offset) || 0, t = Number(taper) || 0;
    if (!Number.isFinite(value) || Math.abs(value) <= 0.5 || !off) return value;
    if (t > 0 && 1 + off / t > 0 && value < t + off) return value / (1 + off / t);
    return value - off;
  }

  function officialPeriod(test) {
    const events = Array.isArray(test.events) ? test.events : [];
    const startEvent = [...events].reverse().find((e) => e.type === 'official-start');
    const endEvent = [...events].reverse().find((e) => e.type === 'official-end');
    return {
      start: Number(startEvent?.at) || Number(test.workflow?.officialStart) || Date.parse(test.officialStart) || 0,
      end: Number(endEvent?.at) || Number(test.workflow?.officialEnd) || Date.parse(test.officialEnd) || 0,
    };
  }

  // Excel date (days since 1899-12-30) in the computer's local time, as DataLoggerXP writes it.
  const excelDate = (ms) => (ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000 + 25569;
  // A number written the way DataLoggerXP writes it: 15 significant digits when that reads back
  // exactly, otherwise 17 (45899.332361111112).
  const numberText = (value) => {
    const trim = (text) => (text.includes('.') && !/e/i.test(text) ? text.replace(/0+$/, '').replace(/\.$/, '') : text);
    const short = trim(value.toPrecision(15));
    return Number(short) === value ? short : trim(value.toPrecision(17));
  };

  /* The run: one reading every `intervalSec` seconds from the start, the recorded reading nearest
     each moment (the site reads the gauge every second). Moments with no reading nearby (the
     gauge was unplugged) are left out. */
  function runData(record, { period = 'official', intervalSec = 5, decimals = 1 } = {}) {
    const test = record.test || {};
    const readings = (record.readings || []).filter((r) => r && Number.isFinite(Number(r.at)) && num(r.pressure) !== null)
      .map((r) => ({ at: Number(r.at), pressure: Number(r.pressure), gauge: num(r.gauge) })).sort((a, b) => a.at - b.at);
    if (!readings.length) throw new Error('This test has no pressure readings.');
    const official = officialPeriod(test);
    let from = readings[0].at, to = readings.at(-1).at;
    if (period === 'official') {
      if (!official.start) throw new Error('This test has no official start time. Choose Entire recording.');
      from = official.start; to = official.end || to;
    }
    if (to <= from) throw new Error('There are no readings in that period.');
    const step = Math.max(1, Number(intervalSec) || 5) * 1000;
    const count = Math.floor((to - from) / step) + 1;
    if (count > MAX_READINGS) {
      const fits = [1, 2, 5, 10, 15, 30, 60].find((s) => Math.floor((to - from) / (s * 1000)) + 1 <= MAX_READINGS);
      throw new Error(`That is ${count.toLocaleString()} readings; the XP2i holds ${MAX_READINGS.toLocaleString()}. Choose every ${fits || 60} seconds or longer.`);
    }
    const within = Math.max(600, step / 2), places = [0, 1, 2, 3].includes(Number(decimals)) ? Number(decimals) : 1;
    const offset = Number(test.offset) || 0, taper = Math.max(0, Number(test.offsetTaperPsi) || 0);
    const rows = [];
    let i = 0, skipped = 0;
    for (let k = 0; k < count; k++) {
      const at = from + k * step;
      while (i < readings.length - 1 && Math.abs(readings[i + 1].at - at) <= Math.abs(readings[i].at - at)) i++;
      const reading = readings[i];
      if (Math.abs(reading.at - at) > within) { skipped++; continue; }
      // The gauge's own reading, saved with each reading; older recordings work it out from the offset.
      const value = reading.gauge !== null ? reading.gauge : gaugePressure(reading.pressure, offset, taper);
      rows.push({ seconds: k * step / 1000, value: Number(value.toFixed(places)) });
    }
    if (!rows.length) throw new Error('No readings were recorded in that period.');
    const lastSeconds = rows.at(-1).seconds;
    return { start: from, stop: from + lastSeconds * 1000, rows, skipped, intervalSec: step / 1000 };
  }

  // ---- Workbook --------------------------------------------------------------------------------
  function dataSheetRows(run, gauge) {
    const serial = String(gauge.serial || '').trim();
    const serialCell = /^\d+$/.test(serial) ? `<c r="B1" s="1"><v>${Number(serial)}</v></c>` : `<c r="B1" s="1" t="inlineStr"><is><t>${xml(serial)}</t></is></c>`;
    const head = [
      `<row r="1" spans="1:2"><c r="A1" s="1" t="s"><v>15</v></c>${serialCell}</row>`,
      '<row r="2" spans="1:2"><c r="A2" s="1" t="s"><v>0</v></c><c r="B2" s="1" t="s"><v>4</v></c></row>',
      '<row r="3" spans="1:2"><c r="A3" s="1" t="s"><v>14</v></c><c r="B3" s="1" t="s"><v>23</v></c></row>',
      '<row r="4" spans="1:4"><c r="A4" s="1" t="s"><v>16</v></c><c r="B4" s="1" t="s"><v>24</v></c><c r="C4" t="s"><v>22</v></c><c r="D4" t="s"><v>12</v></c></row>',
      '<row r="5" spans="1:2"><c r="A5" s="1" t="s"><v>17</v></c><c r="B5" s="1"><v>1</v></c></row>',
      '<row r="6" spans="1:2"><c r="A6" s="1" t="s"><v>18</v></c><c r="B6" s="1" t="s"><v>25</v></c></row>',
      `<row r="7" spans="1:2"><c r="A7" s="1" t="s"><v>19</v></c><c r="B7" s="1"><v>${run.intervalSec}</v></c></row>`,
      `<row r="8" spans="1:2"><c r="A8" s="1" t="s"><v>20</v></c><c r="B8" s="4"><v>${numberText(excelDate(run.start))}</v></c></row>`,
      `<row r="9" spans="1:2"><c r="A9" s="1" t="s"><v>21</v></c><c r="B9" s="4"><v>${numberText(excelDate(run.stop))}</v></c></row>`,
      '<row r="10" spans="1:5"><c r="A10" s="5" t="s"><v>28</v></c><c r="B10" s="5" t="s"><v>29</v></c><c r="C10" s="5" /><c r="D10" s="5" /><c r="E10" s="5" /></row>',
    ];
    const body = run.rows.map((row, index) => { const r = index + 11; return `<row r="${r}" spans="1:2"><c r="A${r}"><v>${row.seconds}</v></c><c r="B${r}"><v>${row.value}</v></c></row>`; });
    return { xml: head.join('') + body.join(''), lastRow: 10 + run.rows.length };
  }

  function workbookFiles(run, gauge) {
    const template = root.HydroCrystalTemplate;
    if (!template) throw new Error('The Crystal log template did not load. Reload the page.');
    return template.files.map((file) => {
      if (file.name === 'xl/worksheets/sheet2.xml') {
        const rows = dataSheetRows(run, gauge);
        return { name: file.name, text: file.head.replace('{{DIMENSION}}', `A1:E${rows.lastRow}`) + rows.xml + file.tail };
      }
      if (file.name === 'xl/sharedStrings.xml') {
        return { name: file.name, text: file.text.replace('{{MODEL}}', xml(gauge.model)).replace('{{UNITS}}', xml(gauge.units || 'PSI')).replace('{{FIRMWARE}}', xml(gauge.firmware)) };
      }
      return { name: file.name, text: file.text };
    });
  }

  // ---- Zip (the .xlsx container) -----------------------------------------------------------------
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function deflate(bytes) {
    if (typeof root.CompressionStream !== 'function') return null;
    try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new root.CompressionStream('deflate-raw'))).arrayBuffer()); } catch (_) { return null; }
  }
  async function zip(files, when = new Date()) {
    const encoder = new TextEncoder(), parts = [], central = [];
    const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
    const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), data = encoder.encode(file.text), crc = crc32(data);
      const packed = await deflate(data), method = packed ? 8 : 0, stored = packed || data;
      const local = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0, 2], [8, method, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, stored.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([at, v, size]) => (size === 4 ? local.setUint32(at, v, true) : local.setUint16(at, v, true)));
      const entry = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0, 2], [10, method, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, stored.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
        .forEach(([at, v, size]) => (size === 4 ? entry.setUint32(at, v, true) : entry.setUint16(at, v, true)));
      parts.push(new Uint8Array(local.buffer), name, stored);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + stored.length;
    }
    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4], [20, 0, 2]]
      .forEach(([at, v, size]) => (size === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)));
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }

  async function build(record, opts = {}) {
    const run = runData(record, opts);
    const bytes = await zip(workbookFiles(run, opts.gauge || {}));
    return { bytes, run };
  }

  // ---- History page dialog -------------------------------------------------------------------------
  function remembered() { try { return JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } }

  function openDialog(record) {
    const dialog = root.document.getElementById('crystalLogDialog');
    if (!dialog || !record) return;
    const test = record.test || {}, saved = remembered(), $ = (selector) => dialog.querySelector(selector);
    const inventory = Array.isArray(record.equipment) ? record.equipment : [];
    const gaugeItem = inventory.find((item) => item.id === (test.equipment || {}).digital_gauge);
    const serial = String(gaugeItem?.serial || saved.serial || '');
    $('.crystal-serial').value = serial;
    const perGauge = (saved.gauges || {})[serial.replace(/^0+/, '')] || {};
    $('.crystal-model').value = perGauge.model || saved.model || '';
    $('.crystal-firmware').value = perGauge.firmware || saved.firmware || '';
    $('.crystal-interval').value = String(saved.interval || 5);
    $('.crystal-decimals').value = String(saved.decimals ?? 1);
    const official = officialPeriod(test);
    $('.crystal-period').value = official.start ? 'official' : 'all';
    $('.crystal-period option[value="official"]').disabled = !official.start;
    $('.crystal-offset-note').textContent = 'Readings are the gauge\'s own, exactly as it reported them. The recorder\'s pressure offset is never included.';
    $('.crystal-message').textContent = '';
    $('.crystal-download').hidden = true;
    dialog.onsubmit = async (event) => {
      event.preventDefault();
      if (event.submitter?.value === 'cancel') { dialog.close(); return; }
      const gauge = { serial: $('.crystal-serial').value.trim(), model: $('.crystal-model').value.trim(), firmware: $('.crystal-firmware').value.trim(), units: 'PSI' };
      if (!gauge.serial || !gauge.model || !gauge.firmware) { $('.crystal-message').textContent = 'Enter the gauge serial number, model and firmware version.'; return; }
      const opts = { period: $('.crystal-period').value, intervalSec: Number($('.crystal-interval').value), decimals: Number($('.crystal-decimals').value), gauge };
      try {
        const next = remembered(); next.gauges = next.gauges || {};
        next.gauges[gauge.serial.replace(/^0+/, '')] = { model: gauge.model, firmware: gauge.firmware };
        Object.assign(next, { serial: gauge.serial, model: gauge.model, firmware: gauge.firmware, interval: opts.intervalSec, decimals: opts.decimals });
        root.localStorage.setItem(KEY, JSON.stringify(next));
      } catch (_) {}
      const button = $('[value="build"]');
      button.disabled = true; $('.crystal-message').textContent = 'Building the workbook…';
      try {
        const { bytes, run } = await build(record, opts);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = $('.crystal-download');
        link.href = url; link.download = 'CrystalGaugeLog.xlsx'; link.hidden = false; link.click();
        const when = (at) => new Date(at).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
        $('.crystal-message').textContent = `Saved CrystalGaugeLog.xlsx: ${run.rows.length.toLocaleString()} readings every ${run.intervalSec} s, ${when(run.start)} to ${when(run.stop)}.${run.skipped ? ` ${run.skipped.toLocaleString()} moments with no reading (gauge unplugged) are left out.` : ''}`;
      } catch (error) {
        $('.crystal-message').textContent = error.message || String(error);
      } finally { button.disabled = false; }
    };
    dialog.showModal();
  }

  const api = { runData, build, openDialog, gaugePressure, excelDate, numberText, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HydroCrystalLog = api;
})(typeof window !== 'undefined' ? window : globalThis);
