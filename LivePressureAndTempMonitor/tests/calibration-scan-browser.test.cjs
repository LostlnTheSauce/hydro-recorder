// Scanning calibration papers on a phone: the recording computer shares its equipment
// library with the website (newest save wins); the phone page lists that equipment, takes a
// picture of each page (turn, remove, scan look) and saves the pages as one PDF.
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
  let shared = { updatedAt: 0, items: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/calibration-api.php') {
      const action = url.searchParams.get('action');
      if (req.method === 'GET' && action === 'list') return json(200, { ok: true, maxBytes: 8000000, equipment: shared, papers: [...papers.values()].map(({ data, ...p }) => p) });
      if (req.method === 'GET' && action === 'file') { const p = papers.get(url.searchParams.get('equipment')); res.writeHead(p ? 200 : 404, { 'content-type': p ? p.mime : 'text/plain' }); return res.end(p ? p.data : ''); }
      const chunks = []; req.on('data', (c) => chunks.push(c));
      return req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (action === 'equipment') {
          const p = JSON.parse(body.toString());
          if (p.savedAt > shared.updatedAt) shared = { updatedAt: p.savedAt, items: p.items };
          return json(200, { ok: true, ...shared });
        }
        if (action === 'upload') {
          const mime = body.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : null;
          if (!mime) return json(400, { error: 'Upload the calibration paper as a PDF, JPEG or PNG.' });
          const paper = { equipment_id: req.headers['x-equipment-id'], file_name: decodeURIComponent(req.headers['x-file-name']), mime, size: body.length, uploaded_at: Date.now(), data: body };
          papers.set(paper.equipment_id, paper);
          const { data, ...out } = paper; return json(200, { ok: true, paper: out });
        }
        json(400, { error: 'unknown' });
      });
    }
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    if (url.pathname === '/calibration.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('calibration.php')); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const errors = [];
    // The laptop shares its library on first load, and again after each change.
    const laptop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const host = await laptop.newPage(); host.on('pageerror', (e) => errors.push(e.message));
    await host.goto(`${base}/host.php`);
    await host.waitForFunction(() => document.getElementById('calibrationScanLink').href.endsWith('/calibration.php'));
    for (let i = 0; i < 50 && !shared.items.length; i++) await host.waitForTimeout(100);
    assert.equal(shared.items.length, 5, 'starter library shared');
    const firstShare = shared.updatedAt;
    await host.locator('[data-dashboard-tab="setup"]').click();
    await host.locator('#equipmentLibrary summary').click();
    await host.locator('#equipmentType').selectOption('deadweight');
    await host.locator('#equipmentName').fill('T1 Deadweights'); await host.locator('#equipmentSerial').fill('5500');
    await host.locator('#equipmentCalibration').fill('2026-05-07');
    await host.locator('#saveEquipment').click();
    for (let i = 0; i < 50 && shared.items.length < 6; i++) await host.waitForTimeout(100);
    assert.equal(shared.items.length, 6); assert.ok(shared.updatedAt > firstShare);
    const t1 = shared.items.find((i) => i.serial === '5500');
    const qr = await host.locator('#calibrationScanQr').evaluate((c) => c.width > 50);
    assert.equal(qr, true, 'QR code drawn for the phone page');

    // A fresh browser adds the shared library to its own, and nothing is lost on the website.
    const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const host2 = await other.newPage(); host2.on('pageerror', (e) => errors.push(e.message));
    await host2.goto(`${base}/host.php`);
    await host2.waitForFunction(() => JSON.parse(localStorage.getItem('grantg-hydro-equipment-v1') || '[]').some((i) => i.serial === '5500'));
    await host2.waitForTimeout(500);
    assert.equal(shared.items.length, 6, 'the shared list still has every item');
    await other.close();

    // The phone page.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await phone.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/calibration.php`);
    await page.locator('.cal-card').first().waitFor();
    assert.equal(await page.locator('.cal-card').count(), 6);
    assert.match(await page.locator('#calStatus').innerText(), /5 pieces of equipment still need a paper/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fits the phone');
    const card = page.locator(`.cal-card:has([data-scan="${t1.id}"])`);
    assert.match(await card.innerText(), /T1 Deadweights S\/N 5500[\s\S]*No paper yet · Due 11\/7\/2026/);

    // Pictures: a portrait page, a sideways one (turned), and one taken by mistake (removed).
    const shot = (w, h) => host.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
    const portrait = await shot(800, 1000), sideways = await shot(1000, 700), extra = await shot(600, 600);
    await card.locator('[data-scan]').click();
    const scanner = page.locator('#calScanner');
    await scanner.waitFor();
    assert.equal(await page.locator('#calScanTitle').innerText(), 'T1 Deadweights');
    assert.equal(await page.locator('#calSave').isDisabled(), true);
    await page.locator('#calCamera').setInputFiles({ name: 'p1.png', mimeType: 'image/png', buffer: portrait });
    await page.waitForFunction(() => document.querySelectorAll('.cal-page-thumb').length === 1);
    assert.equal(await page.locator('#calTakeLabel').innerText(), 'Take picture of page 2');
    await page.locator('#calLibrary').setInputFiles([{ name: 'p2.png', mimeType: 'image/png', buffer: sideways }, { name: 'p3.png', mimeType: 'image/png', buffer: extra }]);
    await page.waitForFunction(() => document.querySelectorAll('.cal-page-thumb').length === 3);
    await page.locator('[data-drop="2"]').click();
    await page.locator('[data-turn="1"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.cal-page-thumb').length === 2 && [...document.querySelectorAll('.cal-page-thumb img')].every((i) => i.src.startsWith('data:image/jpeg')));
    assert.equal(await page.locator('#calSave').innerText(), 'Save 2 pages');
    await page.locator('#calSave').click();
    await scanner.waitFor({ state: 'hidden' });
    const paper = papers.get(t1.id);
    assert.equal(paper.mime, 'application/pdf'); assert.equal(paper.file_name, 'T1 Deadweights 5500 calibration.pdf');
    const pdf = await PDFDocument.load(paper.data);
    assert.deepEqual(pdf.getPages().map((p) => (p.getWidth() > p.getHeight() ? 'landscape' : 'portrait')), ['portrait', 'portrait'], 'two pages, the sideways one turned upright');
    assert.ok(paper.size < 3000000, `compact PDF (${paper.size} bytes)`);
    await card.locator('a', { hasText: 'View paper' }).waitFor();
    assert.equal(await card.locator('[data-scan]').innerText(), 'Rescan');
    assert.match(await page.locator('#calStatus').innerText(), /Saved 2 pages for T1 Deadweights/);

    // A PDF already on the phone can be uploaded instead.
    const pump = shared.items.find((i) => i.type === 'pump');
    const doc = await PDFDocument.create(); doc.addPage();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(`[data-file="${pump.id}"]`).click()]);
    await chooser.setFiles({ name: 'pump.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
    await page.locator(`.cal-card:has([data-file="${pump.id}"]) a`, { hasText: 'View paper' }).waitFor();
    assert.equal(papers.get(pump.id).file_name, 'pump.pdf');
    assert.deepEqual(errors, []);
    console.log('Calibration scan: laptop shares its library (merged, nothing lost), QR to the phone page, phone lists equipment, multi-page scan with turn/remove saved as one PDF, PDF upload passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
