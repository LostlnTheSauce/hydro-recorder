// In-memory stand-in for the copied Google workbook, and the real Code.gs
// loaded against it, so Sheet tests run without Google.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

function appsScript(workbook, { exposeContext = false } = {}) {
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
  const call = (payload) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ ...payload, secret: 'secret' }) } }));
  return exposeContext ? { call, context } : call;
}

module.exports = { fakeWorkbook, appsScript };
