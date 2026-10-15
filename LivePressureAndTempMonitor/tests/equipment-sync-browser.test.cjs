// Sharing the equipment library must never lose equipment. A browser that has not shared yet
// keeps its own list and adds the website's; a library already replaced by the first version
// of sharing gets its equipment back from the copies kept with saved tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

const STARTERS = [
  { id: 'deadweight-5496', type: 'deadweight', name: 'Deadweight', serial: '5496', manufacturer: 'Refinery', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: true },
  { id: 'deadweight-5492', type: 'deadweight', name: 'Deadweight', serial: '5492', manufacturer: 'Refinery', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: false },
  { id: 'pressure-recorder-13045', type: 'pressure_recorder', name: 'Pressure recorder', serial: '13045', manufacturer: 'Tech-Cal', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: true },
  { id: 'digital-gauge-021863', type: 'digital_gauge', name: 'Crystal digital gauge', serial: '021863', manufacturer: 'AMETEK', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: true },
  { id: 'pump-pdq', type: 'pump', name: 'PDQ Pump', serial: '', manufacturer: '', range: '', calibrationDate: '', intervalMonths: 6, capacity: '0.0043', isDefault: true },
];
const MINE = [
  ...STARTERS.map((s) => (s.id === 'deadweight-5496' ? { ...s, calibrationDate: '2026-05-07' } : s)),
  { id: 'b30e1fc4-763e-4c99-bd32-5138a91a082e', type: 'deadweight', name: 'T1 Deadweights', serial: '5496', manufacturer: 'REFINERY', range: '0-5000', calibrationDate: '2026-05-07', intervalMonths: 6, capacity: '', isDefault: false },
  { id: '87ac6db7-c2b7-41d3-bb26-92b3b3fae11b', type: 'pump', name: 'Triplex', serial: '', manufacturer: '', range: '', calibrationDate: '', intervalMonths: 6, capacity: '0.0068', isDefault: false },
];

async function main() {
  let shared = { updatedAt: 0, items: [] };
  const history = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/calibration-api.php') {
      const action = url.searchParams.get('action');
      if (req.method === 'GET') return json(200, { ok: true, maxBytes: 8000000, equipment: shared, papers: [] });
      const chunks = []; req.on('data', (c) => chunks.push(c));
      return req.on('end', () => {
        if (action !== 'equipment') return json(400, { error: 'unknown' });
        const p = JSON.parse(Buffer.concat(chunks).toString());
        if (p.savedAt > shared.updatedAt) shared = { updatedAt: p.savedAt, items: p.items };
        json(200, { ok: true, ...shared });
      });
    }
    if (url.pathname === '/history-api.php') {
      const action = url.searchParams.get('action');
      if (action === 'list') return json(200, { ok: true, jobs: history.map((h) => ({ id: h.id, label: h.id, updated_at: h.updatedAt, deleted_at: 0 })) });
      const job = history.find((h) => h.id === url.searchParams.get('id'));
      return job ? json(200, { ok: true, metadata: job.metadata, manifest: {}, updatedAt: job.updatedAt }) : json(404, { error: 'Test not found.' });
    }
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const open = async (seed) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)); } }, seed);
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/host.php`);
    return { context, page };
  };
  const local = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('grantg-hydro-equipment-v1') || '[]'));
  const names = (items) => items.map((i) => `${i.name}|${i.serial}|${i.calibrationDate}`).sort();
  try {
    // What went wrong: another browser shared the starter list first...
    shared = { updatedAt: Date.now() - 60000, items: STARTERS };
    // ...then the field laptop, with its own list and never shared, loads. It must keep everything.
    const laptop = await open({ 'grantg-hydro-equipment-v1': JSON.stringify(MINE), 'grantg-hydro-equipment-recovered-v1': '1' });
    await laptop.page.waitForFunction(() => Number(localStorage.getItem('grantg-hydro-equipment-saved-at')) > 0);
    assert.deepEqual(names(await local(laptop.page)), names(MINE), 'the laptop keeps its own list');
    for (let i = 0; i < 50 && shared.items.length < MINE.length; i++) await laptop.page.waitForTimeout(100);
    assert.deepEqual(names(shared.items), names(MINE), 'and shares all of it');
    assert.equal(await laptop.page.locator('#equipmentTableBody tr').count(), 7);
    await laptop.context.close();

    // A library already replaced by starters (the bug): its equipment comes back from saved tests.
    shared = { updatedAt: 1000, items: STARTERS };
    history.push({ id: 'old-test-0000000001', updatedAt: 500, metadata: { equipment: MINE.slice(0, 6) } });
    history.push({ id: 'atm-4501-000000001', updatedAt: 900, metadata: { equipment: MINE } });
    history.push({ id: 'current-test-00001', updatedAt: 1200, metadata: { equipment: STARTERS } });
    const damaged = await open({ 'grantg-hydro-equipment-v1': JSON.stringify(STARTERS), 'grantg-hydro-equipment-saved-at': '1000' });
    await damaged.page.locator('[data-dashboard-tab="setup"]').click();
    await damaged.page.locator('#equipmentLibrary summary').click();
    await damaged.page.waitForFunction(() => /Restored/.test(document.getElementById('restoreEquipmentStatus').textContent), null, { timeout: 10000 });
    assert.match(await damaged.page.locator('#restoreEquipmentStatus').innerText(), /Restored 3 pieces of equipment from saved tests/);
    assert.deepEqual(names(await local(damaged.page)), names(MINE), 'two added back, the edited starter deadweight restored');
    for (let i = 0; i < 50 && shared.items.length < MINE.length; i++) await damaged.page.waitForTimeout(100);
    assert.deepEqual(names(shared.items), names(MINE), 'the restored list is shared');
    const previous = await damaged.page.evaluate(() => JSON.parse(localStorage.getItem('grantg-hydro-equipment-previous')));
    assert.equal(previous.items.length, 5, 'the list before restoring is kept');
    // Pressing it again changes nothing.
    await damaged.page.locator('#restoreEquipment').click();
    await damaged.page.waitForFunction(() => /Nothing missing/.test(document.getElementById('restoreEquipmentStatus').textContent));
    // Runs once by itself; a reload does not repeat it.
    assert.ok(await damaged.page.evaluate(() => localStorage.getItem('grantg-hydro-equipment-recovered-v1')));
    await damaged.context.close();

    // A newer list from another device still replaces a browser that has already shared.
    const stamp = Date.now();
    shared = { updatedAt: stamp + 5000, items: MINE.filter((i) => i.name !== 'Triplex') };
    const phone = await open({ 'grantg-hydro-equipment-v1': JSON.stringify(MINE), 'grantg-hydro-equipment-saved-at': String(stamp), 'grantg-hydro-equipment-recovered-v1': '1' });
    await phone.page.waitForFunction(() => !JSON.parse(localStorage.getItem('grantg-hydro-equipment-v1')).some((i) => i.name === 'Triplex'));
    assert.equal((await phone.page.evaluate(() => JSON.parse(localStorage.getItem('grantg-hydro-equipment-previous')))).items.length, 7, 'backup kept');
    await phone.context.close();
    assert.deepEqual(errors, []);
    console.log('Equipment sync: never-shared browser keeps its list and adds the website\'s, starter-replaced library restored from saved tests (once, kept backup), newer list from another device still applies passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
