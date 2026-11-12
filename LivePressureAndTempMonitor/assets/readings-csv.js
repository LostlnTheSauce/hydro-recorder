/* "All readings" CSV, one format for the Live recorder (Records) and Test history: every pressure
   reading (as recorded, offset included) with its date and time, and beside it each temperature
   probe's latest reading from the 2 minutes before. Probes with no readings are left out. */
(function (root) {
  'use strict';
  const KEYS = ['ambient', 'pipe', 'soil', 'aux'];
  const NAMES = { ambient: 'Ambient', pipe: 'Pipe', soil: 'Soil', aux: 'Auxiliary' };
  const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

  // names: probe key -> name (e.g. from the test's channels); defaults to Ambient, Pipe, Soil, Auxiliary.
  function table(pressureReadings, temperatureReadings, names = {}) {
    const readings = (pressureReadings || []).filter((r) => num(r?.at) !== null && num(r?.pressure) !== null).sort((a, b) => a.at - b.at);
    const temps = (temperatureReadings || []).filter((r) => num(r?.at) !== null).sort((a, b) => a.at - b.at);
    const keys = KEYS.filter((k) => temps.some((r) => num(r[k]) !== null));
    const latest = {};
    let j = 0;
    const rows = readings.map((r) => {
      const at = Number(r.at);
      for (; j < temps.length && temps[j].at <= at; j++) keys.forEach((k) => { if (num(temps[j][k]) !== null) latest[k] = { at: temps[j].at, value: Number(temps[j][k]) }; });
      const d = new Date(at);
      return [d.toLocaleDateString(), d.toLocaleTimeString(), Number(Number(r.pressure).toFixed(2)),
        ...keys.map((k) => (latest[k] && at - latest[k].at <= 120000 ? Number(latest[k].value.toFixed(3)) : ''))];
    });
    return { headers: ['Date', 'Time', 'Pressure PSI', ...keys.map((k) => `${names[k] || NAMES[k]} F`)], rows, keys,
      probeNames: keys.map((k) => names[k] || NAMES[k]), first: readings[0]?.at ?? null, last: readings.at(-1)?.at ?? null };
  }

  const text = (t) => [t.headers, ...t.rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  function download(fileName, t) {
    const url = URL.createObjectURL(new Blob([text(t)], { type: 'text/csv;charset=utf-8' }));
    const a = root.document.createElement('a'); a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fileName = (jobNumber, slot) => `${String(jobNumber || `Test-${slot || 'A'}`).replace(/[^a-z0-9_-]/gi, '_')}_all-readings.csv`;

  root.HydroReadingsCsv = { table, text, download, fileName };
})(window);
