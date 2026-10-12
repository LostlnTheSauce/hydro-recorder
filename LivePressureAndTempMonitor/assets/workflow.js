(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HydroWorkflow = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const MINUTE = 60000;
  const stages = {
    pretest: 'Pre-test temperatures', setup: 'Pressure setup', ramp: 'Initial pressure-up',
    hold75: '75% hold', finalRamp: 'Final pressure-up', fullHold: 'Full-pressure hold',
    official: 'Official test', endHold: 'End-of-test hold', depressurizing: 'Depressurizing', complete: 'Complete',
  };
  const steps = profile => profile === 'staged' ? [0, 25, 50, 75, 100] : profile === 'half' ? [0, 50, 75, 100] : [0, 75, 100];
  const number = value => value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  // A probe that is unplugged or faulty reports values like -300 °F. Anything outside
  // what a pipeline, the soil or the air can reach is treated as no reading.
  const TEMPERATURE_RANGE = [-60, 200];
  const plausibleTemperature = value => {
    const reading = number(value);
    return reading !== null && reading >= TEMPERATURE_RANGE[0] && reading <= TEMPERATURE_RANGE[1] ? reading : null;
  };
  const SHEET_COLUMNS = ['pressure', 'ambient', 'pipe', 'ground', 'comments'];
  function create(test = {}) {
    const events = test.events || [];
    const last = type => [...events].reverse().find(e => e.type === type);
    const start = last('official-start');
    const end = last('official-end');
    const ramps = events.filter(e => e.type === 'ramp');
    const ramp = ramps.at(-1);
    let stage = 'pretest', since = 0;
    if (end) { stage = 'endHold'; since = end.at; }
    else if (start) { stage = 'official'; since = start.at; }
    else if (ramp) {
      stage = /Full pressure/i.test(ramp.label) ? 'fullHold' : /75%/.test(ramp.label) ? 'hold75' : 'ramp'; since = ramp.at;
    }
    return { version: 1, stage, since, attempt: 1, startedAt: ramps[0]?.at || 0,
      officialStart: start?.at || 0, officialEnd: end?.at || 0,
      config: { hold75: 30, fullHold: 15, endHold: 15, duration: number(test.design?.testDurationHours) || 8 },
      rampIndex: ramps.length, strokes: [], baseline: null, nextPressure: null,
      observedAt: 0, highPressure: null, crossings: [], archives: [], chartChangedAt: 0, notices: {} };
  }
  function nextQuarter(at) {
    const date = new Date(at);
    if (date.getSeconds() || date.getMilliseconds() || date.getMinutes() % 15) {
      date.setMinutes(Math.floor(date.getMinutes() / 15) * 15 + 15, 0, 0);
    }
    return date.getTime();
  }
  function deadline(state) {
    if (state.stage === 'official') return state.officialStart + state.config.duration * 60 * MINUTE;
    if (state.stage === 'fullHold') return nextQuarter(state.since + state.config.fullHold * MINUTE);
    if (state.stage === 'hold75' || state.stage === 'endHold') return state.since + state.config[state.stage] * MINUTE;
    return null;
  }
  function nextStart(state, now) {
    if (now >= state.since + state.config.fullHold * MINUTE && new Date(now).getMinutes() % 15 === 0) return now;
    return nextQuarter(Math.max(now, state.since + state.config.fullHold * MINUTE));
  }
  function advance(state, profile, at, pressure) {
    if (!Number.isFinite(at) || at < state.since) throw new Error('Event time cannot be before the current stage began.');
    // Timers are reminders, not interlocks. The operator records what occurred.
    let type = 'workflow', label, recorded = pressure;
    switch (state.stage) {
      case 'pretest': state.stage = 'setup'; label = 'Pressure setup started'; break;
      case 'setup':
        state.stage = 'ramp'; state.rampIndex = 1; state.startedAt = at;
        type = 'ramp'; label = 'Begin pressurizing'; recorded = 0; break;
      case 'ramp': {
        const step = steps(profile)[state.rampIndex];
        if (![25, 50, 75].includes(step)) throw new Error('Check the selected pressure steps before continuing.');
        state.rampIndex++; type = 'ramp'; label = `${step}% pressure checkpoint${step === 75 ? ` / Begin ${state.config.hold75} min hold` : ''}`;
        if (step === 75) state.stage = 'hold75';
        break;
      }
      case 'hold75': state.stage = 'finalRamp'; label = '75% hold ended / Continue pressure-up'; break;
      case 'finalRamp': state.stage = 'fullHold'; type = 'ramp'; label = `Full pressure reached / Begin ${state.config.fullHold} min hold`; break;
      case 'fullHold': state.stage = 'official'; state.officialStart = at; type = 'official-start'; label = `Begin ${state.config.duration} hour test`; break;
      case 'official': state.stage = 'endHold'; state.officialEnd = at; type = 'official-end'; label = `End ${state.config.duration} hour test / Begin final hold`; break;
      case 'endHold': state.stage = 'depressurizing'; label = 'Begin depressurizing'; break;
      case 'depressurizing': state.stage = 'complete'; label = 'Depressurization complete'; break;
      default: throw new Error('This attempt is complete.');
    }
    state.since = at;
    return { at, type, label, pressure: recorded, attempt: state.attempt };
  }
  function setBaseline(state, at, pressure, counter, capacity) {
    if (state.stage !== 'finalRamp') throw new Error('Stroke counting is available during final pressure-up.');
    if ([pressure, counter, capacity].some(v => number(v) === null) || pressure < 0 || counter < 0 || !Number.isInteger(counter) || capacity <= 0) throw new Error('Enter the actual counter reading, starting pressure, and positive pump capacity.');
    if (state.baseline) throw new Error('The stroke baseline is already recorded.');
    state.baseline = { at, pressure, counter, capacity };
    state.nextPressure = pressure + 10;
    state.highPressure = pressure; state.observedAt = at;
  }
  function recordEvent(state, kind, at, pressure, detail = '') {
    if (!Number.isFinite(at)) throw new Error('Enter the actual event time.');
    let type = 'workflow', label;
    if (kind === 'start') {
      if (state.officialEnd && at >= state.officialEnd) throw new Error('Test start must be before its end.');
      state.officialStart = at; type = 'official-start'; label = 'Begin test';
      if (!state.officialEnd) { state.stage = 'official'; state.since = at; }
    } else if (kind === 'end') {
      if (!state.officialStart || at <= state.officialStart) throw new Error('Record the actual test start before its end.');
      state.officialEnd = at; state.stage = 'endHold'; state.since = at;
      type = 'official-end'; label = 'End test / Begin final hold';
    } else if (kind === 'hold-start' || kind === 'hold-end') {
      type = kind; label = `${detail.trim() || 'Operator hold'} ${kind === 'hold-start' ? 'started' : 'ended'}`;
    } else if (/^(0|25|50|75|100)$/.test(kind)) {
      type = 'ramp'; label = `${kind}% pressure checkpoint`;
      // Late entries add to the log without moving a running test backwards.
      if (!state.officialStart && at >= state.since) {
        state.stage = kind === '100' ? 'fullHold' : kind === '75' ? 'hold75' : 'ramp'; state.since = at;
        state.lastCheckpoint = Number(kind);
      }
    } else if (kind === 'depressurize' || kind === 'complete') {
      if (state.officialStart && !state.officialEnd) throw new Error('Enter the test end time first.');
      if (at < state.since) throw new Error('Finish time must follow the current stage.');
      state.stage = kind === 'complete' ? 'complete' : 'depressurizing'; state.since = at;
      label = kind === 'complete' ? 'Recording workflow complete' : 'Begin depressurizing';
    } else throw new Error('Choose an event.');
    return { at, type, label, pressure: number(pressure), attempt: state.attempt };
  }
  function observe(state, reading) {
    if (state.stage !== 'finalRamp' || !state.baseline || reading.at <= state.observedAt || number(reading.pressure) === null) return 0;
    state.observedAt = reading.at;
    let added = 0;
    while (reading.pressure >= state.nextPressure && added < 1000) {
      state.crossings.push({ target: state.nextPressure, at: reading.at, pressure: reading.pressure });
      state.nextPressure += 10; added++;
    }
    state.highPressure = Math.max(state.highPressure, reading.pressure);
    return added;
  }
  function saveStroke(state, target, counter, at, pressure) {
    const crossing = state.crossings.find(c => c.target === target);
    if (!crossing || state.strokes.some(s => s.target === target)) throw new Error('Choose an unrecorded checkpoint.');
    const previous = state.strokes.at(-1) || state.baseline;
    const pending = state.crossings.find(c => !state.strokes.some(s => s.target === c.target));
    if (pending.target !== target) throw new Error('Enter counter readings in checkpoint order.');
    if (number(counter) === null || !Number.isInteger(counter) || counter < previous.counter) throw new Error('The cumulative counter cannot decrease. Enter the actual reading, not an estimated count.');
    if (at < previous.at || at < state.baseline.at) throw new Error('Stroke times must be in recording order.');
    const strokes = counter - previous.counter;
    const row = { target, crossingAt: crossing.at, at, pressure, counter, strokes,
      gallons: strokes * state.baseline.capacity, totalGallons: (counter - state.baseline.counter) * state.baseline.capacity };
    state.strokes.push(row); return row;
  }
  function officialTimes(state, now) {
    if (!state.officialStart || now < state.officialStart) return [];
    const end = Math.min(now, state.officialEnd || now);
    const times = [];
    for (let at = state.officialStart; at <= end; at += 15 * MINUTE) times.push(at);
    if (state.officialEnd && end === state.officialEnd && times.at(-1) !== end) times.push(end);
    return times;
  }
  function validatePeriod(start, end, now) {
    if (![start, end].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Enter valid test times.');
    if (start > now || end > now) throw new Error('Enter actual test times, not future times.');
    if (end && (!start || end <= start)) throw new Error('Test end must be after its start.');
  }
  function manualStroke(state, at, pressure, counter, capacity) {
    if (!Number.isFinite(at) || number(pressure) === null || pressure < 0 || number(counter) === null || !Number.isInteger(counter) || counter < 0) throw new Error('Enter the actual pressure and nonnegative whole counter reading.');
    if (!state.baseline) {
      if (number(capacity) === null || capacity <= 0) throw new Error('Enter a positive pump capacity.');
      state.baseline = { at, pressure, counter, capacity };
      state.observedAt = at; state.nextPressure = pressure + 10; state.highPressure = pressure;
      return;
    }
    const previous = state.strokes.at(-1) || state.baseline;
    if (at < previous.at || counter < previous.counter) throw new Error('Enter cumulative stroke readings in time order; the counter cannot decrease.');
    if (state.strokes.some(r => r.target === pressure)) throw new Error('That pressure checkpoint already has a counter reading.');
    const strokes = counter - previous.counter;
    state.strokes.push({ target: pressure, at, crossingAt: at, pressure, counter, strokes,
      gallons: strokes * state.baseline.capacity, totalGallons: (counter - state.baseline.counter) * state.baseline.capacity });
  }
  function archive(state, test, at, reason) {
    if (!String(reason || '').trim()) throw new Error('Enter a reason for ending this attempt.');
    if (at < state.since) throw new Error('The attempt cannot end before the current stage began.');
    const archives = [...state.archives, { ...state, archives: undefined, endedAt: at, reason,
      events: JSON.parse(JSON.stringify(test.events || [])), officialStartText: test.officialStart,
      officialEndText: test.officialEnd, sheet: test.sheet ? { ...test.sheet } : null }];
    return { ...create(), config: { ...state.config }, attempt: state.attempt + 1, archives,
      stage: 'setup', since: at, chartChangedAt: state.chartChangedAt };
  }
  // The Sheet's LOG data rows: 23-48, then 51-87 after the page break. Must match Code.gs.
  const sheetLogRows = [...Array.from({ length: 26 }, (_, i) => 23 + i), ...Array.from({ length: 37 }, (_, i) => 51 + i)];
  function sheetCapacity(rows, startRow = 0) {
    const pre = (rows.preTestRows || []).length;
    const official = (rows.officialRows || []).length;
    const post = (rows.postTestRows || []).length;
    const chosen = Number(startRow) || 0;
    let startIndex = pre;
    if (chosen) {
      startIndex = sheetLogRows.indexOf(chosen);
      if (startIndex < 0) throw new Error(`Row ${chosen} is not a log row. Pick a row from 23 to 48 or 51 to 87.`);
      if (pre > startIndex) throw new Error(`The ${pre} pre-test entries need ${pre} rows above the official start, but row ${chosen} leaves room for ${startIndex}. Pick a later row or use Auto.`);
    }
    const needed = startIndex + official + post;
    if (needed > sheetLogRows.length) throw new Error(`This test needs ${needed} log rows, but the Sheet has ${sheetLogRows.length} (rows 23-48 and 51-87). No rows were merged or omitted. Pick an earlier start row or use the Records CSV for the extra entries.`);
    return {
      officialFirstRow: official ? sheetLogRows[startIndex] : 0,
      officialLastRow: official ? sheetLogRows[startIndex + official - 1] : 0,
    };
  }
  return { stages, steps, number, plausibleTemperature, TEMPERATURE_RANGE, SHEET_COLUMNS, create, nextQuarter, nextStart, deadline, advance, recordEvent, setBaseline, observe, saveStroke, officialTimes, archive, sheetCapacity, validatePeriod, manualStroke };
});
