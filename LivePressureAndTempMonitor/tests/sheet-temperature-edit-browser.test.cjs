// A temperature the operator corrects in the Google Sheet must survive the next
// Sync to Sheet. Runs the real Apps Script (Code.gs) against an in-memory workbook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

function fakeWorkbook() {
  const tabs = {};
  const column = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const parse = (a1) => { const m = /^([A-Z]+)(\d+)$/.exec(a1); return [Number(m[2]), column(m[1])]; };
  const sheet = (name) => {
    const cells = new Map();
    const key = (r, c) => `${r},${c}`;
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cells.has(key(r + i, c + j)) ? cells.get(key(r + i, c + j)) : '')),
      setValues: (values) => values.forEach((row, i) => row.forEach((v, j) => cells.set(key(r + i, c + j), v))),
      setValue: (v) => cells.set(key(r, c), v),
      setFormula: (f) => cells.set(key(r, c), f),
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) cells.delete(key(r + i, c + j)); },
    });
    const a1Range = (a1) => {
      const [from, to = from] = a1.split(':');
      const [r1, c1] = parse(from); const [r2, c2] = parse(to);
      return range(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    };
    return {
      name,
      getRange: (a, c, nr, nc) => typeof a === 'string' ? a1Range(a) : range(a, c, nr, nc),
      getRangeList: (list) => ({ clearContent: () => list.forEach((a1) => a1Range(a1).clearContent()) }),
      cell: (a1) => a1Range(a1).getValues()[0][0],
    };
  };
  ['LOG', 'Summary', 'Test Stroke Count'].forEach((name) => { tabs[name] = sheet(name); });
  return {
    tabs,
    getSheetByName: (name) => tabs[name] || null,
    getId: () => 'S'.repeat(30), getUrl: () => 'https://docs.google.com/spreadsheets/d/fake', getName: () => 'Fake hydro sheet',
    setSpreadsheetTimeZone() {},
  };
}

function appsScript(workbook) {
  const props = new Map();
  const context = {
    console, JSON, Date, Number, String, Math, Array, Object, Boolean,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) || null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFileById: () => ({ getParents: () => ({ hasNext: () => false }), makeCopy: () => ({ getId: () => workbook.getId() }) }) },
    SpreadsheetApp: { openById: () => workbook, flush() {} },
    Utilities: { getUuid: () => 'x' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => text }) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'google-apps-script', 'Code.gs'), 'utf8'), context);
  props.set('HYDRO_SYNC_SECRET', 'secret');
  return (payload) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ ...payload, secret: 'secret' }) } }));
}

async function main() {
  const workbook = fakeWorkbook();
  const bridge = appsScript(workbook);
  const log = workbook.tabs.LOG;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    if (url.pathname === '/api.php' && req.method === 'POST' && /^sheet_(create|sync)$/.test(url.searchParams.get('action') || '')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        const action = url.searchParams.get('action');
        const result = action === 'sheet_create'
          ? bridge({ action: 'create', title: payload.title, snapshot: payload.snapshot })
          : bridge({ action: 'sync', spreadsheetId: payload.spreadsheet_id, snapshot: payload.snapshot });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result));
      });
      return;
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${base}/host.php`);
    await page.waitForFunction(() => window.testGauges && window.testGauges[0]);

    // Official test started 20 minutes ago: rows at start and start + 15 min.
    const start = await page.evaluate(() => {
      const g = window.testGauges[0];
      const at = Date.now() - 20 * 60 * 1000;
      g.testState.officialStart = new Date(at).toISOString();
      g.testState.events = [...(g.testState.events || []), { type: 'official-start', at, label: 'Official test start' }];
      return at;
    });
    await page.evaluate(() => window.testGauges[0].createGoogleSheet());
    await page.waitForFunction(() => window.testGauges[0].testState.sheet?.spreadsheetId);
    const row = 27;
    assert.equal(Number(log.cell(`A${row}`)), start, 'first official row is the start time');

    // Operator types 60 °F ambient in the Sheet, then syncs: the site picks it up.
    log.getRange(`C${row}`).setValue(60);
    const sync = async () => {
      const before = await page.evaluate(() => window.testGauges[0].testState.sheet.lastSyncedAt);
      await page.evaluate(() => window.testGauges[0].syncGoogleSheet());
      await page.waitForFunction((b) => window.testGauges[0].testState.sheet.lastSyncedAt !== b && !window.testGauges[0].sheetSyncInFlight, before);
    };
    await sync();
    const siteAmbient = () => page.evaluate((at) => window.testGauges[0].temperatureReadings.find((e) => e.source === 'sheet' && e.at === at)?.ambient, start);
    assert.equal(await siteAmbient(), 60);

    // Operator corrects it to 62 in the Sheet. The next sync must keep 62.
    log.getRange(`C${row}`).setValue(62);
    await sync();
    assert.equal(log.cell(`C${row}`), 62, 'Sheet edit survives Sync to Sheet');
    assert.equal(await siteAmbient(), 62, 'site picks up the corrected value');

    // Operator clears it in the Sheet. The next sync keeps it cleared.
    log.getRange(`C${row}`).setValue('');
    await sync();
    assert.equal(log.cell(`C${row}`), '', 'Sheet deletion survives Sync to Sheet');
    assert.equal(await siteAmbient(), undefined, 'site drops the cleared value');

    // A replacement Sheet still carries the temperatures already pulled from the old one.
    log.getRange(`D${row}`).setValue(71);
    await sync();
    await page.evaluate(() => window.testGauges[0].createGoogleSheet());
    await page.waitForFunction(() => !window.testGauges[0].sheetSyncInFlight && /Created/.test(document.querySelector('.sheet-sync-message').textContent));
    assert.equal(log.cell(`D${row}`), 71, 'replacement Sheet keeps Sheet temperatures');

    assert.deepEqual(errors, []);
    console.log('Google Sheet temperature edits: correction, deletion and replacement Sheet passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
