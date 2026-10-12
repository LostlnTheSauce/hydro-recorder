const HYDRO_TEMPLATE_ID = 'REDACTED';
const HYDRO_SECRET_PROPERTY = 'HYDRO_SYNC_SECRET';
const HYDRO_ALLOWED_PREFIX = 'HYDRO_SHEET_';
const HYDRO_LAYOUT_VERSION = 3;
// Log columns the site can switch off; those cells are left as the operator typed them.
const HYDRO_LOG_COLUMNS = { pressure: 1, ambient: 2, pipe: 3, ground: 4, comments: 5 };
// LOG data rows: 23-48 on the first page, 51-87 on the second (49 is blank, 50 repeats the header).
const HYDRO_LOG_ROWS = [
  ...Array.from({ length: 26 }, (_, index) => 23 + index),
  ...Array.from({ length: 37 }, (_, index) => 51 + index)
];

function setupHydroAutomation() {
  const secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(HYDRO_SECRET_PROPERTY, secret);
  console.log('Copy this secret into config.php as google_sheet_sync_secret:');
  console.log(secret);
}

function doGet() {
  return hydroJson_({ ok: true, message: 'Hydrotest Google Sheet bridge is running.' });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const payload = JSON.parse(event && event.postData ? event.postData.contents : '{}');
    const expected = PropertiesService.getScriptProperties().getProperty(HYDRO_SECRET_PROPERTY) || '';
    if (!expected || String(payload.secret || '') !== expected) throw new Error('Sheet synchronization was not authorized.');

    if (payload.action === 'create') return hydroJson_(hydroCreate_(payload));
    if (payload.action === 'sync') return hydroJson_(hydroSync_(payload));
    throw new Error('Unknown Sheet action.');
  } catch (error) {
    return hydroJson_({ ok: false, error: error && error.message ? error.message : String(error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function hydroCreate_(payload) {
  const title = hydroSafeTitle_(payload.title || 'Hydrotest paperwork');
  const template = DriveApp.getFileById(HYDRO_TEMPLATE_ID);
  const parents = template.getParents();
  const copy = parents.hasNext() ? template.makeCopy(title, parents.next()) : template.makeCopy(title);
  const spreadsheet = SpreadsheetApp.openById(copy.getId());
  spreadsheet.setSpreadsheetTimeZone('America/Chicago');
  hydroReset_(spreadsheet);
  PropertiesService.getScriptProperties().setProperty(HYDRO_ALLOWED_PREFIX + spreadsheet.getId(), new Date().toISOString());
  const result = hydroApply_(spreadsheet, payload.snapshot || {}, false);
  return { ok: true, spreadsheetId: spreadsheet.getId(), url: spreadsheet.getUrl(), title: spreadsheet.getName(), ...result };
}

function hydroSync_(payload) {
  const spreadsheetId = String(payload.spreadsheetId || '');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) throw new Error('The saved Google Sheet ID is invalid.');
  if (!PropertiesService.getScriptProperties().getProperty(HYDRO_ALLOWED_PREFIX + spreadsheetId)) {
    throw new Error('That Sheet was not created by this Hydrotest bridge.');
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const result = hydroApply_(spreadsheet, payload.snapshot || {}, Boolean(payload.finalized));
  return { ok: true, spreadsheetId, url: spreadsheet.getUrl(), title: spreadsheet.getName(), ...result };
}

function hydroReset_(spreadsheet) {
  const log = hydroSheet_(spreadsheet, 'LOG');
  const summary = hydroSheet_(spreadsheet, 'Summary');
  const strokes = hydroSheet_(spreadsheet, 'Test Stroke Count');
  log.getRangeList([
    'C7', 'G7', 'C8', 'G8', 'C9', 'G9',
    'D11', 'F11', 'I11', 'D12', 'F12', 'I12', 'D13', 'F13', 'I13',
    'D14', 'F14', 'I14', 'D15', 'F15', 'I15', 'D16', 'F16', 'I16',
    'D18', 'H18', 'B19', 'G19', 'B20', 'I20',
    'A23:F49', 'A51:F87'
  ]).clearContent();
  summary.getRangeList(['B8', 'B9', 'B10', 'A14:G19', 'C22', 'C23', 'C24']).clearContent();
  strokes.getRangeList(['C6', 'C7', 'C8', 'C9', 'K7', 'M10:M18']).clearContent();
}

function hydroApply_(spreadsheet, snapshot, finalized) {
  const log = hydroSheet_(spreadsheet, 'LOG');
  const summary = hydroSheet_(spreadsheet, 'Summary');
  const strokes = hydroSheet_(spreadsheet, 'Test Stroke Count');
  const job = snapshot.job || {};
  const design = snapshot.design || {};
  const equipment = snapshot.equipment || {};

  hydroSet_(log, 'C7', job.owner || 'Atmos Energy');
  hydroSet_(log, 'G7', hydroNumberOrText_(job.poAfe));
  hydroSet_(log, 'C8', job.contractor || 'Bobcat Contracting');
  hydroSet_(log, 'G8', job.location || '');
  hydroSet_(log, 'C9', job.jobNumber || '');
  hydroSet_(log, 'G9', hydroDate_(snapshot.testDateMs));

  hydroEquipment_(log, 11, equipment.deadweight);
  hydroEquipment_(log, 12, equipment.pressure_recorder);
  hydroEquipment_(log, 13, equipment.ambient_chart);
  hydroEquipment_(log, 14, equipment.pipe_chart);
  hydroEquipment_(log, 15, equipment.ground_chart);
  hydroEquipment_(log, 16, equipment.digital_gauge);

  hydroSet_(log, 'D18', hydroNumberOrBlank_(design.windowBottom));
  hydroSet_(log, 'H18', hydroNumberOrBlank_(design.windowTop));
  hydroSet_(log, 'B19', design.beginGps || '');
  hydroSet_(log, 'G19', hydroNumberOrBlank_(design.sectionLengthFt));
  hydroSet_(log, 'B20', design.endGps || '');
  const pump = equipment.pump || {};
  hydroSet_(log, 'I20', [pump.name || '', pump.capacity ? '- ' + pump.capacity : ''].filter(Boolean).join(' '));

  hydroSet_(summary, 'B8', hydroNumberOrBlank_(design.sectionLengthFt));
  hydroSet_(summary, 'B9', hydroInsideDiameter_(design.pipeSegments));
  hydroSet_(summary, 'B10', hydroNumberOrBlank_(design.estimatedFillGallons));
  hydroPipeline_(summary, design.pipeSegments);
  hydroSet_(summary, 'C22', design.testDurationHours ? `${design.testDurationHours} Hour Hydro Test` : '');
  hydroSet_(summary, 'C23', design.testMedium || '');
  hydroSet_(summary, 'C24', design.recorderGps || '');

  hydroSet_(strokes, 'C6', job.owner || 'Atmos Energy');
  hydroSet_(strokes, 'C7', job.contractor || 'Bobcat Contracting');
  hydroSet_(strokes, 'C8', job.ownerRep || '');
  hydroSet_(strokes, 'C9', job.service || 'Gas');
  hydroSet_(strokes, 'K7', design.lineName || design.projectName || '');
  hydroSet_(strokes, 'M13', hydroNumberOrBlank_(design.targetPressure));
  hydroSet_(strokes, 'M14', 10);
  hydroSet_(strokes, 'M16', hydroNumberOrBlank_(pump.capacity));

  const layout = hydroLayout_(snapshot);
  hydroWriteLog_(log, layout);
  hydroSummaryFormulas_(summary, layout.officialFirstRow, layout.officialLastRow);

  SpreadsheetApp.flush();
  return {
    updatedAt: new Date().toISOString(),
    finalized,
    layoutVersion: HYDRO_LAYOUT_VERSION,
    adjustedOffset: Number(snapshot.pressureOffset) || 0,
    officialRowsWritten: layout.officialCount,
    officialFirstRow: layout.officialFirstRow,
    officialLastRow: layout.officialLastRow,
    temperatureReadings: hydroTemperatureReadings_(log)
  };
}

// Decides which LOG row each entry goes on. Auto: pre-test entries from row 23,
// the official test right after them, post-test right after that. With a chosen
// start row, the official test begins on that row and the rows above it that the
// pre-test entries do not need are left exactly as the operator typed them.
function hydroLayout_(snapshot) {
  const pre = Array.isArray(snapshot.preTestRows) ? snapshot.preTestRows : [];
  const official = Array.isArray(snapshot.officialRows) ? snapshot.officialRows : [];
  const post = Array.isArray(snapshot.postTestRows) ? snapshot.postTestRows : [];
  const capacity = HYDRO_LOG_ROWS.length;
  const chosen = Number(snapshot.sheetStartRow) || 0;
  let startIndex = pre.length;
  if (chosen) {
    startIndex = HYDRO_LOG_ROWS.indexOf(chosen);
    if (startIndex < 0) throw new Error(`Row ${chosen} is not a log row. Pick a row from 23 to 48 or 51 to 87.`);
    if (pre.length > startIndex) {
      throw new Error(`The ${pre.length} pre-test entries need ${pre.length} rows above the official start, but row ${chosen} leaves room for ${startIndex}. Pick a later row or use Auto.`);
    }
  }
  const needed = startIndex + official.length + post.length;
  if (needed > capacity) {
    throw new Error(`This test needs ${needed} log rows, but the Sheet has ${capacity} (rows 23-48 and 51-87). Pick an earlier start row or use the Records CSV for the extra entries.`);
  }
  const entries = new Array(capacity).fill(null);
  const owned = new Array(capacity).fill(!chosen);
  pre.forEach((row, index) => { entries[index] = row; owned[index] = true; });
  [...official, ...post].forEach((row, index) => { entries[startIndex + index] = row; });
  for (let index = startIndex; index < capacity; index++) owned[index] = true;
  const skipped = (Array.isArray(snapshot.sheetSkipColumns) ? snapshot.sheetSkipColumns : [])
    .map((name) => HYDRO_LOG_COLUMNS[name]).filter((column) => column !== undefined);
  return {
    entries,
    owned,
    skipped,
    officialCount: official.length,
    officialFirstRow: official.length ? HYDRO_LOG_ROWS[startIndex] : 0,
    officialLastRow: official.length ? HYDRO_LOG_ROWS[startIndex + official.length - 1] : 0
  };
}

function hydroWriteLog_(log, layout) {
  const existing = [
    ...log.getRange(23, 1, 26, 6).getValues(),
    ...log.getRange(51, 1, 37, 6).getValues()
  ];
  const values = existing.map((row, index) => layout.owned[index]
    ? hydroMergeRow_(layout.entries[index], row, existing, layout.skipped)
    : row);
  // Write each run of rows the site owns; rows left to the operator are not touched.
  let index = 0;
  while (index < HYDRO_LOG_ROWS.length) {
    if (!layout.owned[index]) { index++; continue; }
    let end = index;
    while (end + 1 < HYDRO_LOG_ROWS.length && layout.owned[end + 1] && HYDRO_LOG_ROWS[end + 1] === HYDRO_LOG_ROWS[end] + 1) end++;
    log.getRange(HYDRO_LOG_ROWS[index], 1, end - index + 1, 6).setValues(values.slice(index, end + 1));
    index = end + 1;
  }
}

// C:E are operator-owned temperature cells. A site value wins; otherwise the
// temperature typed for the same time is kept, wherever that row has moved to.
function hydroMergeRow_(entry, current, existing, skipped = []) {
  const values = entry ? hydroLogRow_(entry) : ['', '', '', '', '', ''];
  const at = entry ? hydroTime_(values[0]) : NaN;
  const sameTime = Number.isFinite(at) ? existing.find((row) => Math.abs(hydroTime_(row[0]) - at) <= 30000) : null;
  const source = sameTime || (Number.isFinite(hydroTime_(current[0])) ? null : current);
  [2, 3, 4].forEach((column) => {
    if (values[column] === '') values[column] = source ? source[column] : '';
  });
  skipped.forEach((column) => { values[column] = current[column]; });
  return values;
}

function hydroTime_(value) {
  if (value instanceof Date) return value.getTime();
  const number = typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function hydroSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error(`The copied template is missing the ${name} tab.`);
  return sheet;
}

function hydroSet_(sheet, a1, value) {
  sheet.getRange(a1).setValue(hydroSafeCellValue_(value));
}

function hydroFormula_(sheet, a1, formula) {
  sheet.getRange(a1).setFormula(formula);
}

function hydroEquipment_(sheet, row, item) {
  const equipment = item || {};
  hydroSet_(sheet, `D${row}`, equipment.serial || '');
  hydroSet_(sheet, `F${row}`, equipment.manufacturer || '');
  hydroSet_(sheet, `I${row}`, hydroDateText_(equipment.calibrationDate));
}

function hydroPipeline_(summary, segments) {
  summary.getRange('A14:G19').clearContent();
  if (!Array.isArray(segments) || !segments.length) return;
  const grouped = {};
  segments.forEach(segment => {
    const key = [segment.outsideDiameterIn, segment.wallThicknessIn, segment.grade].join('|');
    if (!grouped[key]) grouped[key] = { ...segment, lengthFt: 0 };
    grouped[key].lengthFt += Number(segment.lengthFt) || 0;
  });
  const rows = Object.values(grouped).slice(0, 6).map(segment => [
    hydroSafeCellValue_(`${hydroTrimNumber_(segment.outsideDiameterIn)}"`),
    hydroSafeCellValue_(`${hydroTrimNumber_(segment.wallThicknessIn)}"`),
    hydroSafeCellValue_(String(segment.grade || '').toLowerCase()),
    hydroSafeCellValue_(`${hydroTrimNumber_(segment.lengthFt)}'`)
  ]);
  if (rows.length) summary.getRange(14, 1, rows.length, 4).setValues(rows);
}

function hydroInsideDiameter_(segments) {
  if (!Array.isArray(segments) || !segments.length) return '';
  const row = segments[0] || {};
  const inside = Number(row.outsideDiameterIn) - (2 * Number(row.wallThicknessIn));
  return Number.isFinite(inside) ? Number(inside.toFixed(1)) : '';
}

function hydroLogRow_(row) {
  return [
    hydroDate_(row.at),
    hydroWholeNumberOrBlank_(row.pressure),
    hydroWholeNumberOrBlank_(row.ambient),
    hydroWholeNumberOrBlank_(row.pipe),
    hydroWholeNumberOrBlank_(row.ground),
    hydroSafeCellValue_(String(row.comments || ''))
  ];
}

function hydroTemperatureReadings_(log) {
  const rows = [
    ...log.getRange(23, 1, 26, 5).getValues(),
    ...log.getRange(51, 1, 37, 5).getValues()
  ];
  return rows.map(row => {
    const at = row[0] instanceof Date ? row[0].getTime() : Number(row[0]);
    return {
      at,
      ambient: hydroNumberOrBlank_(row[2]),
      pipe: hydroNumberOrBlank_(row[3]),
      soil: hydroNumberOrBlank_(row[4])
    };
  }).filter(row => Number.isFinite(row.at) && row.at > 0);
}

function hydroSummaryFormulas_(summary, first, last) {
  if (!first || !last) return;
  hydroFormula_(summary, 'C26', `=IF(COUNT(LOG!B${first}:B${last})=0,"",MAX(LOG!B${first}:B${last}))`);
  hydroFormula_(summary, 'G26', `=IF(COUNT(LOG!B${first}:B${last})=0,"",MIN(LOG!B${first}:B${last}))`);
  hydroFormula_(summary, 'C33', '=C26');
  hydroFormula_(summary, 'D33', `=IF(COUNT(LOG!C${first}:C${last})=0,"",MAX(LOG!C${first}:C${last}))`);
  hydroFormula_(summary, 'E33', `=IF(COUNT(LOG!D${first}:D${last})=0,"",MAX(LOG!D${first}:D${last}))`);
  hydroFormula_(summary, 'F33', `=IF(COUNT(LOG!E${first}:E${last})=0,"",MAX(LOG!E${first}:E${last}))`);
  hydroFormula_(summary, 'C34', '=G26');
  hydroFormula_(summary, 'D34', `=IF(COUNT(LOG!C${first}:C${last})=0,"",MIN(LOG!C${first}:C${last}))`);
  hydroFormula_(summary, 'E34', `=IF(COUNT(LOG!D${first}:D${last})=0,"",MIN(LOG!D${first}:D${last}))`);
  hydroFormula_(summary, 'F34', `=IF(COUNT(LOG!E${first}:E${last})=0,"",MIN(LOG!E${first}:E${last}))`);
  hydroFormula_(summary, 'C38', `=LOG!A${first}`);
  hydroFormula_(summary, 'D38', '=LOG!G9');
  hydroFormula_(summary, 'E38', `=LOG!B${first}`);
  hydroFormula_(summary, 'C40', `=LOG!A${last}`);
  hydroFormula_(summary, 'D40', '=LOG!G9');
  hydroFormula_(summary, 'E40', `=LOG!B${last}`);
}

function hydroSafeCellValue_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function hydroNumberOrText_(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return '';
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : text;
}

function hydroNumberOrBlank_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : '';
}

function hydroWholeNumberOrBlank_(value) {
  const number = hydroNumberOrBlank_(value);
  return number === '' ? '' : Math.round(number);
}

function hydroDate_(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return new Date(number);
}

function hydroDateText_(value) {
  if (!value) return '';
  const parts = String(value).split('-').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0) : '';
}

function hydroTrimNumber_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Number(number.toFixed(3))) : '';
}

function hydroSafeTitle_(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Hydrotest paperwork';
}

function hydroJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
