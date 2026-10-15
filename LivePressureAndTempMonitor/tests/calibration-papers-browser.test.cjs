// Calibration papers: add a PDF or photo to equipment in the library (stored on the website),
// view, replace and remove it, then build one printable PDF for the inspectors with a cover
// sheet and the papers of the equipment ticked for the test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const { PDFDocument } = require('../assets/pdf-lib.min.js');
const root = path.resolve(__dirname, '..');

async function main() {
  const papers = new Map();
  const kind = (b) => (b.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) ? 'image/png' : null);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/calibration-api.php') {
      const action = url.searchParams.get('action');
      if (req.method === 'GET' && action === 'list') return json(200, { ok: true, maxBytes: 8000000, papers: [...papers.values()].map(({ data, ...p }) => p) });
      if (req.method === 'GET' && action === 'file') { const p = papers.get(url.searchParams.get('equipment')); if (!p) return json(404, { error: 'none' }); res.writeHead(200, { 'content-type': p.mime }); return res.end(p.data); }
      const chunks = []; req.on('data', (c) => chunks.push(c));
      return req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (action === 'upload') {
          const mime = kind(body);
          if (!mime) return json(400, { error: 'Upload the calibration paper as a PDF, JPEG or PNG.' });
          const paper = { equipment_id: req.headers['x-equipment-id'], file_name: decodeURIComponent(req.headers['x-file-name']), mime, size: body.length, uploaded_at: Date.now(), data: body };
          papers.set(paper.equipment_id, paper);
          const { data, ...out } = paper; return json(200, { ok: true, paper: out });
        }
        if (action === 'delete') { const id = JSON.parse(body.toString()).equipment; return json(200, { ok: true, deleted: papers.delete(id) }); }
        json(400, { error: 'unknown' });
      });
    }
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
    await page.locator('[data-dashboard-tab="setup"]').click();
    await page.locator('#equipmentLibrary summary').click();
    const row = (id) => page.locator(`#equipmentTableBody tr:has([data-cal-equipment="${id}"])`);
    await row('deadweight-5496').locator('[data-cal-action="upload"]').waitFor();

    // A two-page PDF certificate for the deadweight.
    const cert = await PDFDocument.create(); cert.addPage([612, 792]); cert.addPage([612, 792]);
    const certBytes = Buffer.from(await cert.save());
    const choose = async (id, file) => { const [chooser] = await Promise.all([page.waitForEvent('filechooser'), row(id).locator('[data-cal-action="upload"]').click()]); await chooser.setFiles(file); };
    await choose('deadweight-5496', { name: 'DW 5496 cert.pdf', mimeType: 'application/pdf', buffer: certBytes });
    await row('deadweight-5496').locator('a', { hasText: 'View paper' }).waitFor();
    assert.equal(papers.get('deadweight-5496').data.equals(certBytes), true, 'PDF stored unchanged');
    assert.equal(papers.get('deadweight-5496').file_name, 'DW 5496 cert.pdf');
    assert.match(await row('deadweight-5496').locator('a').getAttribute('href'), /calibration-api\.php\?action=file&equipment=deadweight-5496/);

    // A landscape phone photo for the pressure recorder (shrunk to a JPEG when large).
    await page.setViewportSize({ width: 1440, height: 1000 });
    const photo = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1400, height: 900 } });
    await choose('pressure-recorder-13045', { name: 'recorder.png', mimeType: 'image/png', buffer: photo });
    await row('pressure-recorder-13045').locator('a', { hasText: 'View paper' }).waitFor();
    assert.match(papers.get('pressure-recorder-13045').mime, /^image\/(png|jpeg)$/);

    // Anything else is refused with the server's reason; the row keeps "Add paper".
    await choose('digital-gauge-021863', { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') });
    await page.waitForFunction(() => true); await page.waitForTimeout(300);
    assert.match(dialogs.at(-1), /PDF, JPEG or PNG/);
    assert.equal(papers.has('digital-gauge-021863'), false);
    assert.equal(await row('digital-gauge-021863').locator('[data-cal-action="upload"]').innerText(), 'Add paper');

    // Replace and remove.
    await choose('deadweight-5492', { name: 'old.pdf', mimeType: 'application/pdf', buffer: certBytes });
    await row('deadweight-5492').locator('[data-cal-action="remove"]').waitFor();
    await row('deadweight-5492').locator('[data-cal-action="remove"]').click();
    await row('deadweight-5492').locator('[data-cal-action="upload"]', { hasText: 'Add paper' }).waitFor();
    assert.match(dialogs.at(-1), /Remove the calibration paper for Deadweight S\/N 5492\?/);
    assert.equal(papers.has('deadweight-5492'), false);

    assert.equal(await page.locator('#equipmentTableBody tr').count(), 5, 'paper buttons never remove equipment');
    // Print set: the test's selected equipment starts ticked (the pump does not).
    await page.evaluate(() => { const g = window.testGauges[0]; g.testState.jobNumber = 'ATM 4501'; });
    assert.equal(await page.locator('.calibration-print, [data-gauge] #calibrationPrint').count(), 0, 'no per-test button in Setup');
    await page.locator('#equipmentLibrary #calibrationPrint').click();
    assert.equal(await page.locator('#calibrationSet .cal-set-test').isHidden(), true, 'one running test: no test choice');
    const dialog = page.locator('#calibrationSet');
    await dialog.waitFor();
    const ticked = await dialog.locator('.cal-set-list input:checked').evaluateAll((list) => list.map((i) => i.value));
    assert.deepEqual(ticked.sort(), ['deadweight-5496', 'digital-gauge-021863', 'pressure-recorder-13045'].sort());
    assert.match(await dialog.locator('.cal-set-item:has([value="digital-gauge-021863"]) small').innerText(), /No paper/);
    const [tab] = await Promise.all([context.waitForEvent('page'), dialog.locator('[value="build"]').click()]);
    await dialog.locator('.cal-set-download:not([hidden])').waitFor();
    assert.equal(await dialog.locator('.cal-set-download').getAttribute('download'), 'Calibration papers - ATM 4501.pdf');
    assert.match(await dialog.locator('.cal-set-message').innerText(), /Ready: 3 items/);
    await tab.close();
    const built = await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('#calibrationSet .cal-set-download').href)).arrayBuffer();
      return Array.from(new Uint8Array(blob));
    });
    const doc = await PDFDocument.load(Uint8Array.from(built));
    const sizes = doc.getPages().map((p) => { const { width, height } = p.getSize(); return width > height ? 'landscape' : 'portrait'; });
    assert.deepEqual(sizes, ['portrait', 'portrait', 'portrait', 'landscape'], 'cover, the 2-page deadweight PDF, then the recorder photo');
    assert.equal(doc.getTitle(), 'Calibration papers - ATM 4501');
    await dialog.locator('[data-close]').click();
    assert.equal(await dialog.isVisible(), false);
    // With two tests running, the dialog asks which; its equipment is ticked.
    await page.evaluate(() => { const [a, b] = window.testGauges; b.testState.jobNumber = 'ATM 4502'; b.testState.equipment = { deadweight: 'deadweight-5492' };
      window.HydroCalibration.openSet([{ name: 'Test 1', gauge: a }, { name: 'Test 2', gauge: b }]); });
    assert.equal(await dialog.locator('.cal-set-test').isVisible(), true);
    assert.deepEqual(await dialog.locator('.cal-set-test option').allInnerTexts(), ['Test 1 · ATM 4501', 'Test 2 · ATM 4502']);
    await dialog.locator('.cal-set-test select').selectOption('1');
    assert.deepEqual(await dialog.locator('.cal-set-list input:checked').evaluateAll((list) => list.map((i) => i.value)), ['deadweight-5492']);
    await dialog.locator('[data-close]').click();
    assert.deepEqual(errors, []);
    console.log('Calibration papers: PDF and photo added to equipment, view link, bad file refused, replace/remove, print set with test equipment ticked, cover + papers in one PDF passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
