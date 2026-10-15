(function () {
  'use strict';
  const Date = window.HydroDemo?.enabled ? window.HydroDemo.ClockDate : window.Date;
  const W = window.HydroWorkflow;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stamp = at => at ? new Date(at).toLocaleString() : '—';
  const localInput = at => { const d = new Date(at); const pad = v => String(v).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const csv = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  function download(name, headers, rows) {
    const url = URL.createObjectURL(new Blob([[headers, ...rows].map(row => row.map(csv).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // Shows a message directly under the row of buttons the operator just used, so a
  // refusal low on the page is not hidden in a status box at the top.
  function feedbackNear(anchor, text) {
    const row = anchor?.closest('.finish-actions,.workflow-record-actions,.ramp-actions') || anchor?.parentElement;
    if (!row) return;
    let note = row.nextElementSibling;
    if (!note?.classList.contains('action-feedback')) {
      if (!text) return;
      note = document.createElement('p'); note.className = 'action-feedback'; note.setAttribute('role', 'status');
      row.after(note);
    }
    note.textContent = text; note.hidden = !text;
  }
  window.HydroFeedback = { near: feedbackNear };
  class Controller {
    constructor(gauge, helpers) {
      this.g = gauge; this.helpers = helpers; this.lastRecords = 0;
      this.root = gauge.root;
      this.card = document.createElement('section'); this.card.className = 'workflow-card';
      this.card.innerHTML = `
        <div class="workflow-heading"><div><span class="eyebrow">FIELD LOG</span><h3>What happened, and when?</h3></div></div>
        <p>Add checkpoints, holds or notes whenever you have a moment. Any order, any hold length. This log does not start or stop recording.</p>
        <div class="workflow-fields"><label class="workflow-check"><input type="checkbox" data-input="now" checked> Use current time</label><label>Actual event time<input type="datetime-local" step="1" data-input="at" disabled></label></div>
        <div class="workflow-fields"><label>What happened?<input type="text" maxlength="500" data-input="note" placeholder="Example: 50% hold, checked for leaks, held 5 min"></label><label>Pressure PSI (optional)<input type="number" step="any" data-input="event-pressure" placeholder="Use reading at that time"></label><label class="workflow-check workflow-share"><input type="checkbox" data-input="share"> Show to remote viewers</label><button type="button" class="primary" data-act="note">Save entry</button></div>
        <small>For a late entry, uncheck Use current time. Leave PSI empty to use the recorded reading at that time, if available.</small>
        <div class="recent-field-entries"></div>
        <div class="workflow-readouts"><div><span>Ambient</span><strong data-live-temp="ambient">—</strong></div><div><span>Pipe</span><strong data-live-temp="pipe">—</strong></div><div><span>Soil</span><strong data-live-temp="soil">—</strong></div><div><span>Temperature feed</span><strong data-wf="temp-health">—</strong></div></div>
        <div class="workflow-actions"><button type="button" data-act="temperatures">Temperature recording & history</button><button type="button" data-act="records">Test times & complete log</button></div>
        <details class="workflow-strokes"><summary>Stroke reading at an earlier time</summary><p>For readings written down and entered later: set the event time above, then the checkpoint pressure and the cumulative counter. For live counting, use the Stroke count panel.</p><div class="workflow-fields"><label>Pressure / checkpoint PSI<input type="number" step="any" min="0" data-input="stroke-pressure"></label><label>Cumulative counter reading<input data-input="counter" type="number" min="0" step="1" inputmode="numeric"></label><label>Gal / stroke<input data-input="capacity" type="number" min="0.000001" step="0.0001"></label><button type="button" data-act="stroke">Save counter reading</button></div><p data-wf="stroke-total"></p></details>
        <p class="workflow-message" role="status"></p>`;
      this.root.querySelector('.gauge-toolbar').after(this.card);
      const fresh = document.createElement('button'); fresh.type = 'button'; fresh.dataset.act = 'new-job'; fresh.textContent = 'Start new test';
      this.card.querySelector('.workflow-heading').append(fresh);
      this.card.before(this.root.querySelector('.gauge-actions'));
      this.records = document.createElement('section'); this.records.className = 'workflow-records';
      this.records.innerHTML = `<header><h3>Official 15-minute record</h3><p>Adjusted pressure rounded to whole PSI. Missing readings stay blank. Sheet updates remain manual.</p></header><div class="workflow-official-stats"></div><div class="workflow-record-actions"><button type="button" data-export="records">Download complete log CSV</button><button type="button" data-export="probe-report">Digital vs physical temps report (PDF)</button><button type="button" data-export="probes">Download digital vs physical temps CSV</button><button type="button" data-export="backup">Download backup</button></div><div class="event-table-wrap"><table><thead><tr><th>Date / time</th><th>PSI</th><th>Ambient °F</th><th>Pipe °F</th><th>Soil °F</th><th>Status / remarks</th></tr></thead><tbody class="workflow-log-body"></tbody></table></div><details><summary>Stroke-count record</summary><div class="event-table-wrap"><table><thead><tr><th>Actual time</th><th>Checkpoint PSI</th><th>Counter</th><th>Strokes</th><th>Gallons</th><th>Total gal</th></tr></thead><tbody class="workflow-stroke-body"></tbody></table></div></details>`;
      this.root.append(this.records);
      this.records.append(this.root.querySelector('.paperwork-sync-panel'));
      this.records.append(this.root.querySelector('.ramp-panel'));
      const period = document.createElement('section'); period.className = 'test-period';
      period.innerHTML = '<h3>Test times for paperwork</h3><p>Enter or correct these afterward. Leave the end blank until known. Saving times rebuilds the 15-minute record from existing readings; it never controls recording or writes to the Sheet.</p><div class="workflow-fields"><button type="button" data-act="period">Save test times</button></div><p class="period-message" role="status"></p>';
      const fields = period.querySelector('.workflow-fields');
      this.root.querySelectorAll('.test-start,.test-end').forEach(input => { input.step = '1'; fields.prepend(input.closest('label')); });
      // Put start before end, and keep the Save button last.
      fields.prepend(fields.querySelector('.test-start').closest('label'));
      this.records.prepend(period);
      const previous = document.createElement('details');
      previous.innerHTML = '<summary>Local backup copies</summary><p>These upload automatically while this page is open. Keep this laptop’s browser data until online saving is confirmed.</p><div class="previous-jobs"></div>';
      const historyLink = document.createElement('p'); historyLink.innerHTML = '<a href="history.php" target="_blank" rel="noopener">Open online test history & replay ↗</a>';
      this.records.prepend(historyLink);
      this.records.append(previous);
      previous.addEventListener('toggle', () => { if (previous.open) this.renderJobs(); });
      previous.addEventListener('click', async e => {
        const button = e.target.closest('[data-job-download]'); if (!button) return;
        try {
          if (window.HydroDemo?.enabled) throw new Error('Practice archives cannot be exported.');
          const archive = await window.HydroJobs.get(button.dataset.jobDownload);
          if (!archive) throw new Error('Archive not found on this laptop.');
          const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url;
          link.download = `Hydrotest_${archive.test.slot}_${archive.id}_backup.json`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { previous.querySelector('.previous-jobs').textContent = error.message; }
      });
      this.root.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) { this.useAnchor(b); this.action(b.dataset.act); } });
      this.q('[data-input="now"]').addEventListener('change', e => { this.q('[data-input="at"]').disabled = e.target.checked; });
      this.records.addEventListener('click', e => {
        const b = e.target.closest('[data-export]'); if (!b) return;
        this.useAnchor(b);
        try { this.export(b.dataset.export); } catch (error) { this.message(error.message); }
      });
      this.card.querySelectorAll('button').forEach(b => b.addEventListener('click', () => helpers.unlockAudio()));

      this.hydrate(); this.render(true);
    }
    q(selector) { return this.root.querySelector(selector); }
    state() { return this.g.testState.workflow || (this.g.testState.workflow = W.create(this.g.testState)); }
    hydrate() {
      this.stateRef = this.g.testState;
      const s = this.state();
      this.syncOfficialFields();
      this.q('[data-input="capacity"]').value = s.baseline?.capacity || this.g.selectedEquipmentForSheet().pump?.capacity || '';
    }
    time() {
      const at = this.q('[data-input="now"]').checked ? Date.now() : new Date(this.q('[data-input="at"]').value).getTime();
      if (!Number.isFinite(at) || at > Date.now() + 1000) throw new Error('Choose an actual event time, not a future time.');
      return at;
    }
    pressure(at) {
      const reading = this.g.nearestPressureReading(at);
      if (!reading || Math.abs(reading.at - at) > 30000) throw new Error('No gauge reading within 30 seconds of that event. Connect the gauge or choose the actual recorded time.');
      return reading.pressure;
    }
    // Buttons outside the Live test card (Setup, Records) have no status box of their
    // own nearby, so their messages also appear right under them.
    useAnchor(button) {
      const anchor = this.card.contains(button) || button.closest('.test-period') ? null : button;
      if (this.anchor && this.anchor !== anchor) feedbackNear(this.anchor, '');
      this.anchor = anchor;
    }
    message(text) {
      this.q('.workflow-message').textContent = text;
      const periodMessage = this.q('.period-message');
      if (periodMessage) periodMessage.textContent = text;
      if (this.anchor) feedbackNear(this.anchor, text);
    }
    event(event) {
      this.g.testState.events.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...event });
    }
    persist() { this.g.saveTestState(); this.g.renderTestEvents(); this.lastRecords = 0; }
    syncOfficialFields() {
      const s = this.state();
      this.g.testState.officialStart = s.officialStart ? localInput(s.officialStart) : '';
      this.g.testState.officialEnd = s.officialEnd ? localInput(s.officialEnd) : '';
      this.root.querySelector('.test-start').value = this.g.testState.officialStart;
      this.root.querySelector('.test-end').value = this.g.testState.officialEnd;
    }
    action(action) {
      if (action === 'new-job') { this.g.startNewJob(); return; }
      if (this.g.jobTransition || !this.g.checkJobCurrent()) return;
      let note = '';
      try {
        const s = this.state();
        if (action === 'temperatures' || action === 'records') {
          window.HydroWorkspace?.navigate(action === 'temperatures' ? 'temperature' : 'logs'); return;
        }
        if (action === 'period') {
          const parse = selector => this.q(selector).value ? new Date(this.q(selector).value).getTime() : 0;
          const start = parse('.test-start');
          let end = parse('.test-end');
          // An end time still ahead is the planned end, not a recorded one: save the
          // start and leave the end for later instead of rejecting both.
          if (end > Date.now() && start && start <= Date.now()) {
            end = s.officialEnd || 0;
            note = 'The end time is still ahead, so only the start was saved. Save the end time once the test ends.';
          }
          W.validatePeriod(start, end, Date.now());
          const previous = { start: s.officialStart, end: s.officialEnd };
          if ((previous.start && previous.start !== start || previous.end && previous.end !== end) &&
              !confirm('Change the saved test times? Existing readings are preserved and the correction will be noted.')) return;
          // Validate the complete pair before mutating either value. No stage or wait rules.
          s.officialStart = start; s.officialEnd = end;
          s.stage = end ? 'endHold' : start ? 'official' : 'pretest';
          for (const [key, type, label] of [['start', 'official-start', 'Begin test'], ['end', 'official-end', 'End test']]) {
            const value = key === 'start' ? start : end;
            if (previous[key] === value) continue;
            // Keep old entries as an audit trail, not competing effective boundaries.
            this.g.testState.events.filter(e => e.type === type).forEach(e => { e.type = 'time-correction'; e.label += ' (superseded)'; });
            if (value) {
              const reading = this.g.nearestPressureReading(value);
              this.event({ at: value, type, label, enteredAt: Date.now(), correctsTime: previous[key] || null,
                pressure: reading && Math.abs(reading.at - value) <= 30000 ? reading.pressure : null });
            } else this.event({ at: Date.now(), type: 'time-correction', label: 'Cleared test ' + key + ' time', correctsTime: previous[key], pressure: null });
          }
          this.syncOfficialFields();
        } else if (action === 'note') {
          const at = this.time(), label = this.q('[data-input="note"]').value.trim();
          if (!label) throw new Error('Enter what happened.');
          const value = this.q('[data-input="event-pressure"]').value;
          if (!this.q('[data-input="event-pressure"]').reportValidity()) return;
          const reading = this.g.nearestPressureReading(at);
          const pressure = value !== '' ? W.number(value) : reading && Math.abs(reading.at - at) <= 30000 ? reading.pressure : null;
          const shared = this.q('[data-input="share"]').checked;
          this.event({ at, type: 'note', label, pressure, enteredAt: Date.now(), attempt: s.attempt,
            pressureSource: value !== '' ? 'manual' : pressure === null ? 'missing' : 'gauge', ...(shared ? { shared: true } : {}) });
          this.q('[data-input="note"]').value = ''; this.q('[data-input="event-pressure"]').value = '';
          this.q('[data-input="share"]').checked = false;
        } else if (action === 'stroke') {
          const at = this.time(), counter = W.number(this.q('[data-input="counter"]').value);
          const entered = this.q('[data-input="stroke-pressure"]').value;
          const pressure = entered !== '' ? W.number(entered) : this.pressure(at);
          W.manualStroke(s, at, pressure, counter, W.number(this.q('[data-input="capacity"]').value));
          this.q('[data-input="counter"]').value = ''; this.q('[data-input="stroke-pressure"]').value = '';
        }
        this.persist(); this.g.draw(); this.render(true); this.message(note || (window.HydroDemo?.enabled ? 'Recorded in this practice tab only.' : 'Saved locally. Online upload is automatic.'));
      } catch (error) { this.message(error.message || String(error)); }
    }
    officialRows(at = Date.now()) {
      return W.officialTimes(this.state(), at).map(time => {
        const row = this.g.sheetLogRow(time, null, '');
        const missing = [row.pressure === '' ? 'pressure' : '', ...['ambient', 'pipe', 'ground'].filter(k => row[k] === '')].filter(Boolean);
        row.status = missing.length ? `Missing: ${missing.join(', ')}` : 'Recorded';
        return row;
      });
    }
    render(force = false) {
      if (this.stateRef !== this.g.testState) this.hydrate();
      const s = this.state(), now = Date.now();
      const text = (key, value) => { this.q(`[data-wf="${key}"]`).textContent = value; };
      if (this.q('[data-input="now"]').checked) this.q('[data-input="at"]').value = localInput(now);
      const latest = this.g.temperatureReadings.at(-1);
      for (const key of ['ambient', 'pipe', 'soil']) this.q(`[data-live-temp="${key}"]`).textContent = W.number(latest?.[key]) === null ? '—' : `${Number(latest[key]).toFixed(this.g.temperatureRecordingOptions().wholeDegrees ? 0 : 1)} °F`;
      const temperatureFreshMs = Math.max(30000, this.g.temperatureRecordingOptions().sampleIntervalSeconds * 2000 + 5000);
      text('temp-health', latest ? `${now - latest.at < temperatureFreshMs ? 'Current' : 'Last reading'} · ${new Date(latest.at).toLocaleTimeString()}` : 'No readings yet');
      this.q('[data-input="capacity"]').disabled = Boolean(s.baseline);
      text('stroke-total', s.baseline ? `Baseline: ${s.baseline.counter} at ${s.baseline.pressure} PSI · Pump: ${s.baseline.capacity} gal/stroke · Entered volume: ${(s.strokes.at(-1)?.totalGallons || 0).toFixed(4)} gal` : 'No starting counter entered.');
      if (force || now - this.lastRecords >= 15000) { this.renderRecords(); this.lastRecords = now; }
    }
    renderRecords() {
      const s = this.state(), rows = this.officialRows();
      const recent = [...this.g.testState.events].sort((a,b) => b.at-a.at).slice(0,5);
      this.q('.recent-field-entries').innerHTML = recent.length ? '<h4>Recent entries</h4>' + recent.map(e => `<p><small>${esc(stamp(e.at))}</small> · ${esc(e.label)}${W.number(e.pressure) === null ? '' : ' · ' + Math.round(e.pressure) + ' PSI'}</p>`).join('') : '<p>No entries yet. You can add them later.</p>';
      this.records.querySelector('.workflow-log-body').innerHTML = rows.length ? rows.map(r => `<tr><td>${esc(stamp(r.at))}</td>${['pressure', 'ambient', 'pipe', 'ground'].map(k => `<td>${r[k] === '' ? '—' : esc(r[k])}</td>`).join('')}<td>${esc([r.status, r.comments].filter(Boolean).join(' · '))}</td></tr>`).join('') : '<tr><td colspan="6">Enter the actual test start above to build the 15-minute record from saved readings.</td></tr>';
      const through = s.officialEnd || Date.now();
      const stats = [];
      for (const [key, label, readings] of [['pressure', 'Pressure PSI', this.g.readings], ['ambient', 'Ambient °F', this.g.temperatureReadings], ['pipe', 'Pipe °F', this.g.temperatureReadings], ['soil', 'Soil °F', this.g.temperatureReadings]]) {
        let min = Infinity, max = -Infinity;
        if (s.officialStart) for (const r of readings) if (r.at >= s.officialStart && r.at <= through && W.number(r[key]) !== null) { min = Math.min(min, r[key]); max = Math.max(max, r[key]); }
        stats.push(`<div><span>${label} · official min / max</span><strong>${min === Infinity ? '—' : `${min.toFixed(key === 'pressure' ? 0 : 1)} / ${max.toFixed(key === 'pressure' ? 0 : 1)}`}</strong></div>`);
      }
      this.records.querySelector('.workflow-official-stats').innerHTML = stats.join('');
      this.records.querySelector('.workflow-stroke-body').innerHTML = s.strokes.map(r => `<tr><td>${esc(stamp(r.at))}</td><td>${r.target}</td><td>${r.counter}</td><td>${r.strokes}</td><td>${r.gallons.toFixed(4)}</td><td>${r.totalGallons.toFixed(4)}</td></tr>`).join('') || '<tr><td colspan="6">No checkpoint counts entered.</td></tr>';
    }
    async renderJobs() {
      const box = this.records.querySelector('.previous-jobs');
      try {
        const jobs = await window.HydroJobs.list(this.g.slot, window.HydroDemo?.enabled);
        box.innerHTML = jobs.length ? jobs.map(j => `<article><strong>${esc(j.label)}</strong><p>Archived ${esc(stamp(j.archivedAt))} · ${j.pressures.toLocaleString()} pressure readings · ${j.temperatures.toLocaleString()} temperature readings</p><button type="button" data-job-download="${esc(j.id)}">Download archived backup</button></article>`).join('') : '<p>No previous tests archived yet.</p>';
      } catch (error) { box.textContent = `Archives unavailable: ${error.message}. No current test data was cleared.`; }
    }
    export(kind) {
      if (window.HydroDemo?.enabled) return this.message('Demo records are for practice only; exports are disabled.');
      const s = this.state(), name = (this.g.testState.jobNumber || `Test-${this.g.slot}`).replace(/[^a-z0-9_-]/gi, '_');
      if (kind === 'backup') return this.g.downloadTestBackup();
      if (kind === 'probes' || kind === 'probe-report') {
        // Every Sheet log row with the electronic probes' own readings beside the temperatures
        // in the Sheet (as of the last sync) or typed on the site, for comparing them.
        const live = this.g.temperatureReadings.filter(r => r.source === 'live');
        const typed = this.g.temperatureReadings.filter(r => r.source === 'sheet' || r.source === 'manual');
        const sheetRows = this.g.sheetRows();
        const keys = ['ambient', 'pipe', 'soil'];
        // The probe's nearest reading within 5 minutes: temperatures change slowly, and a slow or
        // overheated field laptop can deliver readings minutes apart.
        const PROBE_WINDOW = 5 * 60000;
        const nearestProbe = (at) => { const reading = window.TemperatureChartRenderer.nearest(live, at); return reading && Math.abs(Number(reading.at) - at) <= PROBE_WINDOW ? reading : null; };
        const rows = [...sheetRows.preTestRows, ...sheetRows.officialRows, ...sheetRows.postTestRows].map(r => {
          const probe = nearestProbe(r.at);
          const sheet = typed.find(t => Math.abs(Number(t.at) - r.at) <= 30000);
          return { at: r.at, pressure: r.pressure, comments: r.comments, probeAt: probe ? Number(probe.at) : null, ...Object.fromEntries(keys.map(key => [key, { probe: W.number(probe?.[key]), chart: W.number(sheet?.[key]) }])) };
        });
        if (kind === 'probes') {
          const value = (v, digits) => v === null ? '' : v.toFixed(digits);
          return download(`${name}_digital-vs-physical-temps.csv`,
            ['Date / time', 'Pressure PSI', 'Ambient digital F', 'Ambient physical F', 'Pipe digital F', 'Pipe physical F', 'Soil digital F', 'Soil physical F', 'Remarks'],
            rows.map(r => [stamp(r.at), r.pressure, ...keys.flatMap(key => [value(r[key].probe, 1), value(r[key].chart, 0)]), r.comments]));
        }
        if (!rows.length) return this.message('There are no log rows to compare yet. Save the official test start first.');
        // Printable report: the probes' readings across the log period (thinned for drawing), the
        // chart values at each row, and a summary per probe.
        const from = rows[0].at - 10 * 60000, to = rows.at(-1).at + 10 * 60000;
        const inRange = live.filter(r => r.at >= from && r.at <= to);
        const stride = Math.max(1, Math.ceil(inRange.length / 900));
        const equipment = this.g.selectedEquipmentForSheet();
        const serials = { ambient: equipment.ambient_chart?.serial, pipe: equipment.pipe_chart?.serial, soil: equipment.ground_chart?.serial };
        const t = this.g.testState, d = t.design || {};
        const period = [t.officialStart, t.officialEnd].filter(Boolean).map(v => new Date(v).toLocaleString([], { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })).join(' to ');
        try {
          window.HydroTempReport.open({
            generatedAt: Date.now(),
            job: { jobNumber: t.jobNumber, poAfe: t.poAfe, line: d.lineName || d.projectName, location: t.location, owner: t.owner || 'Atmos Energy', contractor: t.contractor || 'Bobcat Contracting', ownerRep: t.ownerRep, period },
            channels: this.g.temperatureChannels().filter(c => keys.includes(c.key)).map(c => ({ key: c.key, name: c.name, chartSerial: serials[c.key] })),
            series: Object.fromEntries(keys.map(key => [key, inRange.filter((r, i) => i % stride === 0 && W.number(r[key]) !== null).map(r => ({ at: r.at, value: Number(r[key]) }))])),
            rows,
            probeCount: live.length,
            probeSpan: live.length ? [live[0].at, live.at(-1).at] : null,
            loggerNote: 'MadgeTech field logger; nearest reading within 5 minutes',
          });
          return this.message(live.length ? `Report opened in a new tab with ${live.length.toLocaleString()} probe readings. Choose Save as PDF in the print dialog.`
            : 'Report opened, but no electronic probe readings are loaded on this page yet. Open Temperatures, wait for the probe readings to load, then try again.');
        } catch (error) { return this.message(error.message || String(error)); }
      }
      const events = this.g.testState.events;
      const times = W.officialTimes(s, Date.now());
      const entries = [...events.map(e => ({ ...this.g.sheetLogRow(e.at, e.pressure, e.label), kind: e.type })), ...times.map(at => ({ ...this.g.sheetLogRow(at, null, ''), kind: '15-minute reading' }))].sort((a, b) => a.at - b.at);
      download(`${name}_complete-log.csv`, ['Date / time', 'Pressure PSI', 'Ambient F', 'Pipe F', 'Soil F', 'Entry', 'Remarks'], entries.map(r => [stamp(r.at), r.pressure, r.ambient, r.pipe, r.ground, r.kind, r.comments]));
    }
  }
  window.HydroWorkflowUI = {
    attach(gauges, helpers) {
      const controllers = gauges.map(g => (g.workflowController = new Controller(g, helpers)));
      setInterval(() => controllers.forEach(c => { try { c.render(); } catch (e) { c.message(`Logbook display: ${e.message}`); } }), 1000);
      return controllers;
    },
  };
})();
