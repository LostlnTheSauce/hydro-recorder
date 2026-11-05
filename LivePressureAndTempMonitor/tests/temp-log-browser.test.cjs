// Temperature log PDF (History): logger readings as an official-looking log with the logger's
// calibration certificate attached. Checks the rows (nearest reading, unplugged probe ignored,
// gaps as dashes), the dialog (logger preselected, probes, periods), the PDF pages, and that a
// photographed certificate's black bands are cropped off.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');
const outDir = process.env.TEMP_LOG_OUT || path.join(root, '..', 'tmp', 'temp-log');
const certificate = process.env.TEMP_LOG_CERT ? fs.readFileSync(process.env.TEMP_LOG_CERT) : null;

const START = Date.UTC(2026, 10, 4, 15, 0), END = START + 4 * 3600000;
function record() {
  const temperatureReadings = [];
  for (let at = START - 2 * 3600000; at <= END + 1800000; at += 10000) {
    const h = (at - START) / 3600000;
    if (h > 1.5 && h < 1.6) continue; // a 6-minute drop-out
    temperatureReadings.push({ at, source: 'live', sourceId: 'src1', ambient: 61 + 6 * Math.sin(h / 3) + 0.004321, pipe: 57.2 + h * 0.05, soil: 55.25, aux: h > 2 && h < 2.05 ? -330 : 88 });
  }
  return { id: 'job-temp-log-0001', test: { slot: 'A', jobNumber: 'ATM 4502', location: 'Hwy 77 crossing', owner: 'Atmos Energy', contractor: 'Bobcat Contracting', ownerRep: 'J. Inspector',
    poAfe: 'AFE-1189', enabledProbes: ['ambient', 'pipe', 'soil'], temperatureDecimals: 2, design: { testMedium: 'Water', lineName: 'L-2210' },
    events: [{ at: START, type: 'official-start', label: 'Official test started' }, { at: END, type: 'official-end', label: 'Official test ended' }], equipment: {} },
    readings: [{ at: START, pressure: 1740 }], temperatureReadings, equipment: [] };
}
const logger = { id: 'logger-t88206', type: 'temperature_logger', name: 'RTDTempX4', manufacturer: 'MadgeTech', serial: 'T88206', range: '4-channel RTD', calibrationDate: '2026-08-28', intervalMonths: 6, capacity: '', isDefault: true };

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/history.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('history.php')); }
    if (url.pathname === '/history-api.php') { res.setHeader('content-type', 'application/json'); return res.end('{"jobs":[]}'); }
    if (url.pathname === '/calibration-api.php') {
      res.setHeader('content-type', 'application/json');
      if (url.searchParams.get('action') === 'list') return res.end(JSON.stringify({ ok: true, papers: [{ equipment_id: logger.id, file_name: 'cert.jpg', mime: 'image/jpeg' }], equipment: { updatedAt: 1, items: [logger, { id: 'dw', type: 'deadweight', name: 'Deadweight', serial: '5496' }] } }));
      if (url.searchParams.get('action') === 'file') { res.setHeader('content-type', 'image/jpeg'); return res.end(global.certBytes); }
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/history.php`);
    // A certificate "photo": white page with black bands above and below (like a phone screenshot).
    global.certBytes = certificate || Buffer.from(await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 1800; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 900, 1800); x.fillStyle = '#fff'; x.fillRect(0, 400, 900, 1150);
      x.fillStyle = '#123'; x.font = '40px sans-serif'; x.fillText('CERTIFICATE OF CALIBRATION', 120, 500);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }));
    const rec = record();
    // Rows: 15-minute official log, nearest readings, unplugged Auxiliary ignored, gap shows as a dash.
    const data = await page.evaluate((r) => HydroTempLog.logData(r, { period: 'official', intervalMin: 15, probes: ['ambient', 'pipe', 'soil', 'aux'] }), rec);
    assert.equal(data.rows.length, 17, '4 hours every 15 minutes, start and end included');
    assert.equal(data.rows[0].remarks, 'Begin test'); assert.equal(data.rows.at(-1).remarks, 'End test');
    assert.equal(data.rows[0].values.soil, 55.25);
    assert.ok(Math.abs(data.rows[0].values.ambient - 61.004321) < 1e-9, 'raw reading kept, not rounded');
    assert.ok(data.stats.find((s) => s.key === 'aux').low > 0, 'an unplugged-probe -330 °F is not a temperature');
    const oneMin = await page.evaluate((r) => HydroTempLog.logData(r, { period: 'official', intervalMin: 1, probes: ['pipe'] }), rec);
    const gapRow = oneMin.rows.find((row) => Math.abs(row.at - (START + 1.55 * 3600000)) < 30000);
    assert.equal(gapRow.values.pipe, null, 'no reading in the drop-out: dash, not a guess');
    const whole = await page.evaluate((r) => HydroTempLog.logData(r, { period: 'all', intervalMin: 60 }), rec);
    assert.ok(whole.from < START && whole.to > END, 'entire recording covers before and after the test');

    // Dialog: logger with its certificate preselected, the test's probes ticked, its decimals.
    await page.evaluate((r) => { window.rec = r; HydroTempLog.openDialog(r); }, rec);
    await page.waitForFunction(() => document.querySelector('.temp-log-logger option[value="logger-t88206"]'));
    assert.equal(await page.locator('.temp-log-logger').inputValue(), 'logger-t88206');
    assert.equal(await page.locator('.temp-log-decimals').inputValue(), '2');
    assert.deepEqual(await page.locator('.temp-log-probes input:checked').evaluateAll((b) => b.map((x) => x.value)), ['ambient', 'pipe', 'soil']);
    assert.equal(await page.locator('.temp-log-probes input[value="aux"]').isChecked(), false, 'Auxiliary present but off for this test');
    await page.evaluate(() => { window.open = () => null; });
    await page.locator('#tempLogDialog [value="build"]').click();
    await page.waitForFunction(() => !document.querySelector('.temp-log-download').hidden, null, { timeout: 30000 });
    assert.match(await page.locator('.temp-log-message').innerText(), /certificate attached/);
    assert.equal(await page.locator('.temp-log-download').getAttribute('download'), 'Temperature log - ATM 4502.pdf');
    const pdf = Buffer.from(await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector('.temp-log-download').href)).arrayBuffer())]));
    fs.mkdirSync(outDir, { recursive: true });
    const pdfPath = path.join(outDir, 'temperature-log.pdf');
    fs.writeFileSync(pdfPath, pdf);
    const text = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
    for (const expected of ['Hydrostatic Test Temperature Log', 'ATM 4502', 'MadgeTech RTDTempX4', 'T88206', '08/28/2026', '02/28/2027', 'Begin test', 'End test', '61.00', '55.25', 'Reviewed by', 'Calibration certificate']) assert.ok(text.includes(expected), `PDF has ${expected}`);
    assert.ok(!/Auxiliary °F/.test(text), 'unticked probe left out');
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdfPath]).toString())[1]);
    assert.ok(text.includes(`Page ${pages} of ${pages}`), 'numbered pages');
    // The certificate page image has no black band: its top rows are white.
    execFileSync('pdftoppm', ['-png', '-r', '60', '-f', String(pages), '-l', String(pages), pdfPath, path.join(outDir, 'cert')]);
    const certPng = fs.readdirSync(outDir).find((f) => /^cert.*\.png$/.test(f));
    const darkTop = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 90) dark++;
      return dark / (d.length / 4);
    }, fs.readFileSync(path.join(outDir, certPng)).toString('base64'));
    if (!certificate) assert.ok(darkTop < 0.05, `black bands cropped off the certificate photo (dark share ${darkTop.toFixed(3)})`);
    // Plain layout: just the logger data and calibration, pipe only, two decimals.
    await page.locator('.temp-log-style').selectOption('plain');
    await page.locator('.temp-log-probes input[value="ambient"]').uncheck();
    await page.locator('.temp-log-probes input[value="soil"]').uncheck();
    await page.evaluate(() => { document.querySelector('.temp-log-download').hidden = true; });
    await page.locator('#tempLogDialog [value="build"]').click();
    await page.waitForFunction(() => !document.querySelector('.temp-log-download').hidden, null, { timeout: 30000 });
    const plainPdf = Buffer.from(await page.evaluate(async () => [...new Uint8Array(await (await fetch(document.querySelector('.temp-log-download').href)).arrayBuffer())]));
    const plainPath = path.join(outDir, 'temperature-log-plain.pdf');
    fs.writeFileSync(plainPath, plainPdf);
    const plainText = execFileSync('pdftotext', ['-layout', plainPath, '-']).toString();
    for (const expected of ['Temperature Log', 'MadgeTech RTDTempX4', 'T88206', '08/28/2026', '02/28/2027', 'Pipe °F', '57.20', 'Begin test', 'Calibration certificate']) assert.ok(plainText.includes(expected), `plain PDF has ${expected}`);
    for (const absent of ['Grant G Solutions', 'Hydrostatic Test', 'ATM 4502', 'Bobcat', 'Reviewed by', 'SUMMARY', 'Ambient °F']) assert.ok(!plainText.includes(absent), `plain PDF leaves out ${absent}`);
    const plainPages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [plainPath]).toString())[1]);
    assert.equal(plainPages, 2, 'one page of data, one certificate page');
    assert.equal(await page.evaluate(() => localStorage.getItem('grantg-hydro-temp-log-style')), 'plain', 'layout remembered');
    assert.deepEqual(errors, []);
    console.log(`Temperature log PDF (plain layout: data and calibration only, ${plainPages} pages) and`, `Temperature log PDF: 15-minute official log with raw nearest readings, gaps as dashes, unplugged probe ignored, dialog defaults, ${pages} numbered pages with sign-off and the cropped calibration certificate passed.`);
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
