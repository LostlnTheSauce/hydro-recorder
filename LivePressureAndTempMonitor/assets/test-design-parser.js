(function (global) {
  'use strict';

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function numberText(value) {
    return clean(value).replaceAll(',', '');
  }

  function firstMatch(text, patterns, group = 1) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[group] !== undefined) return clean(match[group]);
    }
    return '';
  }

  function gradeFromSmys(value) {
    const smys = Number(numberText(value));
    return Number.isFinite(smys) && smys > 0 ? `X${Math.round(smys / 1000)}` : '';
  }

  function trimNumber(value) {
    const number = Number(numberText(value));
    return Number.isFinite(number) ? String(Number(number.toFixed(3))) : '';
  }

  function parseProjectRow(text) {
    const row = clean(text).replace(/\s*\/\s*/g, '/');
    const match = row.match(/^(.+?)\s+(\d+(?:\.\d+)+(?:\/\d+(?:\.\d+)*)?)\s+(.+?)\s+([\d,]+(?:\.\d+)?)$/i);
    return match ? {
      projectName: clean(match[1]),
      projectNumber: clean(match[2]),
      lineName: clean(match[3]),
      desiredMaop: numberText(match[4]),
    } : null;
  }

  function projectValues(text) {
    const lines = String(text ?? '').split(/\r?\n/).map(clean).filter(Boolean);
    const headerIndex = lines.findIndex((line) => /Project Name/i.test(line)
      && /Project Number/i.test(line) && /Line Name/i.test(line) && /Desired MAOP/i.test(line));
    if (headerIndex >= 0 && lines[headerIndex + 1]) {
      const parsed = parseProjectRow(lines[headerIndex + 1]);
      if (parsed) return parsed;
    }
    const normalized = clean(text);
    const block = normalized.match(/Project Name\s+Project Number\s+Line Name\s+Desired MAOP\s*\(psig\)\s+(.+?)\s+Project Location/i);
    return block ? parseProjectRow(block[1]) : null;
  }

  function combinePipeSegments(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = [trimNumber(row.outsideDiameterIn), trimNumber(row.wallThicknessIn), String(row.grade || '').toUpperCase()].join('|');
      if (!groups.has(key)) groups.set(key, { ...row, lengthFt: '0', sourceCount: 0, sourceStations: [] });
      const group = groups.get(key);
      group.lengthFt = trimNumber(Number(group.lengthFt) + (Number(numberText(row.lengthFt)) || 0));
      group.sourceCount += 1;
      group.sourceStations.push(`${row.startStation}-${row.endStation}`);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      startStation: group.sourceCount > 1 ? 'Various' : group.startStation,
      endStation: group.sourceCount > 1 ? `${group.sourceCount} sections` : group.endStation,
    }));
  }

  function parsePipeSegments(text) {
    const rows = [];
    const station = '\\d+\\+\\d+(?:\\.\\d+)?';
    const rowPattern = new RegExp(`(${station})\\s+(${station})\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d.]+)\\s+([\\d,]+)\\s+([\\d.]+)\\s+(\\d+)\\s+([\\d,]+)\\s+(\\d+)`, 'g');
    let match;
    while ((match = rowPattern.exec(text)) !== null) {
      const smysPsi = numberText(match[5]);
      rows.push({
        startStation: match[1],
        endStation: match[2],
        lengthFt: numberText(match[3]),
        outsideDiameterIn: numberText(match[4]),
        smysPsi,
        grade: gradeFromSmys(smysPsi),
        wallThicknessIn: numberText(match[6]),
        dotClass: numberText(match[7]),
        yieldPressurePsig: numberText(match[8]),
        reassessmentYears: numberText(match[9]),
      });
    }
    const unique = rows.filter((row, index, all) => all.findIndex((candidate) => candidate.startStation === row.startStation && candidate.endStation === row.endStation && candidate.lengthFt === row.lengthFt) === index);
    return combinePipeSegments(unique);
  }

  function requirementRow(text, label) {
    const lines = String(text ?? '').split(/\r?\n/).map(clean).filter(Boolean);
    const line = lines.find((candidate) => new RegExp(`^${label}\\s`, 'i').test(candidate));
    if (!line) return null;
    const station = '\\d+\\+\\d+(?:\\.\\d+)?';
    const match = line.match(new RegExp(`^${label}\\s+${station}\\s+[\\d,.]+(?:\\s+(-?\\d{1,3}\\.\\d+)\\s+(-\\d{1,3}\\.\\d+))?\\s+([\\d,]+)\\s+([\\d,]+)\\s+\\S+\\s+\\S+\\s+\\S+\\s+\\S+\\s+([\\d,]+)$`, 'i'));
    return match ? {
      latitude: match[1] || '',
      longitude: match[2] || '',
      windowBottom: numberText(match[3]),
      windowTop: numberText(match[4]),
      targetPressure: numberText(match[5]),
    } : null;
  }

  function parse(text) {
    const normalized = clean(text);
    const project = projectValues(text);
    const locationBlock = normalized.match(/Project Location\s+County, State\s+Current Class Location\s+Desired Test Class Location\s+(From Sta\.?\s*\d+\+\d+\s+To Sta\.?\s*\d+\+\d+)\s+([A-Za-z .'-]+,\s*[A-Za-z .'-]+)\s+\d+\s+\d+/i);
    const beginning = requirementRow(text, 'Beginning');
    const ending = requirementRow(text, 'End');
    const recorder = requirementRow(text, 'Recorder');
    const gpsFor = (label) => {
      const row = label === 'Beginning' ? beginning : label === 'End' ? ending : recorder;
      return row?.latitude && row?.longitude ? `${row.latitude}, ${row.longitude}` : '';
    };
    const pipeSegments = parsePipeSegments(normalized);

    const result = {
      projectName: project ? project.projectName : firstMatch(normalized, [/Project Name\s*[:#]\s*([^\n]{2,80})/i]),
      projectNumber: project ? project.projectNumber : firstMatch(normalized, [/(?:Project Number|PO\s*\/\s*AFE|AFE)\s*[:#]\s*([A-Z0-9./-]+)/i]),
      lineName: project ? project.lineName : firstMatch(normalized, [/Line Name\s*[:#]\s*([A-Z0-9./-]+)/i]),
      desiredMaop: project ? project.desiredMaop : numberText(firstMatch(normalized, [/Desired MAOP\s*\(psig\)\s*[:#]\s*([\d,]+)/i])),
      projectLocation: locationBlock ? clean(locationBlock[1]) : firstMatch(normalized, [/(From Sta\.?\s*\d+\+\d+\s+To Sta\.?\s*\d+\+\d+)/i]),
      countyState: locationBlock ? clean(locationBlock[2]) : '',
      beginGps: gpsFor('Beginning'),
      endGps: gpsFor('End'),
      recorderGps: gpsFor('Recorder'),
      windowBottom: recorder?.windowBottom || '',
      windowTop: recorder?.windowTop || '',
      targetPressure: recorder?.targetPressure || '',
      testDurationHours: numberText(firstMatch(normalized, [/Test Duration\s*\(hrs\)\s*([\d.]+)/i, /Test Duration\s*[:#]?\s*([\d.]+)\s*(?:hours?|hrs?)/i])),
      estimatedFillGallons: numberText(firstMatch(normalized, [/Estimated Fill\s*\(gal\)\s*([\d,]+(?:\.\d+)?)/i, /Estimated (?:Water )?Fill\s*[:#]?\s*([\d,]+(?:\.\d+)?)\s*(?:gal|gallons)/i])),
      sectionLengthFt: numberText(firstMatch(normalized, [/Section Length\s*\(ft\)\s*([\d,]+(?:\.\d+)?)/i, /(?:Section|Pipeline) Length\s*[:#]?\s*([\d,]+(?:\.\d+)?)\s*(?:ft|feet)/i])),
      testMedium: firstMatch(normalized, [/Test Medium\s+([A-Za-z]+)/i]),
      pipeSegments,
    };

    const warnings = [];
    if (!result.projectNumber) warnings.push('PO / AFE was not found');
    if (!result.windowBottom || !result.windowTop) warnings.push('recorder test window was not found');
    if (!result.testDurationHours) warnings.push('test duration was not found');
    if (!result.estimatedFillGallons) warnings.push('estimated fill was not found');
    if (!pipeSegments.length) warnings.push('limiting pipe rows were not found');
    if (pipeSegments.length > 6) warnings.push(`${pipeSegments.length} combined pipe groups were found, but the current Summary tab has 6 pipeline rows`);
    return { data: result, warnings };
  }

  const api = { parse, gradeFromSmys, combinePipeSegments };
  global.AtmosTestDesignParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
