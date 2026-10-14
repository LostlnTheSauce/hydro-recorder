/* Stroke count on the Live test page. Start at the pressure after the hold
   with the counter at its starting reading, then type the cumulative counter
   at each checkpoint (every 10 psi by default) and press Enter: the box moves
   straight to the next checkpoint. The gauge crossing each checkpoint dings
   once. Entries are stored in the existing workflow stroke record (baseline +
   strokes), so Records, exports and backups are unchanged. */
(function (root) {
  'use strict';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
  const clock = (at) => new (root.HydroDemo?.enabled ? root.HydroDemo.ClockDate : Date)(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  class StrokeCount {
    constructor(gauge, helpers) {
      this.g = gauge;
      this.helpers = helpers;
      this.card = document.createElement('section');
      this.card.className = 'stroke-card';
      const page = gauge.root.querySelector('.page-pressure') || gauge.root;
      page.insertBefore(this.card, page.querySelector('.logbook-card'));
      this.card.addEventListener('click', (event) => {
        const button = event.target.closest('[data-stroke]');
        if (button) this.act(button.dataset.stroke);
      });
      this.card.addEventListener('input', (event) => { if (event.target.matches('[data-stroke-input="start"]')) event.target.dataset.edited = '1'; });
      this.card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        if (event.target.matches('[data-stroke-input="counter"]')) { event.preventDefault(); this.act('save'); }
        else if (event.target.closest('.stroke-setup')) { event.preventDefault(); this.act('start'); }
      });
      this.signature = '';
      this.render(true);
    }

    controller() { return this.g.workflowController; }
    state() { return this.controller().state(); }
    plan() {
      const s = this.state();
      if (!s.strokePlan) s.strokePlan = { step: 10, target: null, skipped: [] };
      if (!Array.isArray(s.strokePlan.skipped)) s.strokePlan.skipped = [];
      return s.strokePlan;
    }
    value(name) { return this.card.querySelector(`[data-stroke-input="${name}"]`)?.value ?? ''; }
    message(text) { const box = this.card.querySelector('.stroke-message'); if (box) { box.textContent = text; box.hidden = !text; } }

    // The checkpoint waiting for a counter reading, or null when the plan is done.
    next() {
      const s = this.state(), plan = this.plan();
      if (!s.baseline) return null;
      const last = Math.max(s.baseline.pressure, ...s.strokes.map((row) => row.target), ...plan.skipped);
      const next = Math.round((last + plan.step) * 100) / 100;
      return plan.target && next > plan.target + 1e-9 ? null : next;
    }

    // When the gauge first reached `pressure` after the previous entry.
    crossedAt(pressure) {
      const s = this.state();
      const after = (s.strokes.at(-1) || s.baseline)?.at || 0;
      return this.g.readings.find((reading) => reading.at >= after && reading.pressure >= pressure)?.at || null;
    }

    persist(note = '') {
      this.wantFocus = true;
      const controller = this.controller();
      controller.persist();
      controller.render(true);
      this.signature = '';
      this.render(true);
      this.message(note);
    }

    act(action) {
      if (this.g.jobTransition || !this.g.checkJobCurrent()) return;
      const s = this.state(), plan = this.plan();
      const now = (root.HydroDemo?.enabled ? root.HydroDemo.ClockDate : Date).now();
      try {
        if (action === 'start') {
          const start = num(this.value('start')), counter = num(this.value('start-counter')), step = num(this.value('step')) || 10;
          const target = num(this.value('target')), capacity = num(this.value('capacity'));
          if (start === null) throw new Error('Enter the starting pressure.');
          if (target !== null && target <= start) throw new Error('The target pressure must be above the starting pressure.');
          if (step <= 0) throw new Error('Enter how many psi between checkpoints.');
          root.HydroWorkflow.manualStroke(s, now, start, counter ?? 0, capacity);
          s.strokePlan = { step, target, skipped: [] };
          this.persist(`Stroke count started at ${start} psi, counter ${counter ?? 0}. Type the counter at ${start + step} psi and press Enter.`);
        } else if (action === 'save') {
          const next = this.next(), counter = num(this.value('counter'));
          if (next === null) return;
          if (counter === null || !Number.isInteger(counter)) throw new Error('Type the counter reading (a whole number).');
          root.HydroWorkflow.manualStroke(s, now, next, counter, s.baseline.capacity);
          this.card.querySelector('[data-stroke-input="counter"]').value = '';
          const row = s.strokes.at(-1);
          const crossed = this.crossedAt(next);
          if (crossed) row.crossingAt = crossed;
          this.persist(`${next} psi · counter ${counter} · ${row.strokes} strokes since the last point.`);
        } else if (action === 'skip') {
          const next = this.next();
          if (next === null) return;
          plan.skipped.push(next);
          this.persist(`${next} psi skipped; it stays blank.`);
        } else if (action === 'undo') {
          // Undo whichever came last: the highest checkpoint is the most recent.
          const lastSkip = plan.skipped.length ? Math.max(...plan.skipped) : -Infinity;
          const lastEntry = s.strokes.length ? s.strokes.at(-1).target : -Infinity;
          if (lastSkip > lastEntry) {
            plan.skipped.splice(plan.skipped.indexOf(lastSkip), 1);
            this.persist(`${lastSkip} psi is back. Type its counter reading.`);
          } else if (s.strokes.length) {
            const removed = s.strokes.pop();
            this.persist(`Removed ${removed.target} psi (counter ${removed.counter}). Type it again.`);
          } else if (s.baseline && root.confirm('Cancel this stroke count and its starting point?')) {
            s.baseline = null; s.strokePlan = null;
            this.persist('Stroke count cleared.');
          }
        }
      } catch (error) {
        this.message(error.message || String(error));
      }
    }

    render(force = false) {
      if (!this.g.active) return;
      const s = this.state(), plan = this.plan(), next = this.next();
      const latest = this.g.readings.at(-1);
      const reached = next !== null && latest && latest.pressure >= next;
      const signature = JSON.stringify([s.baseline?.at, s.strokes.length, plan.skipped.length, plan.target, next, reached]);
      if (next !== null && reached && this.dingedFor !== next) {
        this.dingedFor = next;
        if (this.signature) this.helpers?.ding?.();
      }
      if (!force && signature === this.signature) {
        // Before starting, keep the start pressure following the gauge until it is typed in.
        const start = this.card.querySelector('[data-stroke-input="start"]');
        if (start && latest && !start.dataset.edited && document.activeElement !== start) start.value = Math.round(latest.pressure);
        this.updateStatus(next, latest, reached);
        return;
      }
      this.signature = signature;
      // While a count is running, the panel moves to the top of the Live test page.
      this.card.classList.toggle('active', Boolean(s.baseline) && next !== null);
      const focused = document.activeElement?.closest?.('.stroke-card') === this.card ? document.activeElement.dataset.strokeInput : null;
      const typed = this.value('counter');
      if (!s.baseline) {
        const pump = this.g.selectedEquipmentForSheet?.().pump;
        const keep = (name, fallback) => (this.card.querySelector(`[data-stroke-input="${name}"]`) ? this.value(name) : fallback);
        this.card.innerHTML = `<header class="stroke-header"><h3>Stroke count</h3><p>After the hold: enter the pressure and counter you are starting from, then the counter at each checkpoint.</p></header>
          <div class="stroke-setup">
            <label>Start pressure<input data-stroke-input="start" type="number" step="any" inputmode="decimal" value="${esc(keep('start', latest ? Math.round(latest.pressure) : ''))}"><small>psi</small></label>
            <label>Start counter<input data-stroke-input="start-counter" type="number" min="0" step="1" inputmode="numeric" value="${esc(keep('start-counter', 0))}"></label>
            <label>Target pressure<input data-stroke-input="target" type="number" step="any" inputmode="decimal" value="${esc(keep('target', num(this.g.testState.design?.targetPressure) ?? ''))}"><small>psi</small></label>
            <label>Every<input data-stroke-input="step" type="number" min="1" step="any" inputmode="decimal" value="${esc(keep('step', 10))}"><small>psi</small></label>
            <label>Pump<input data-stroke-input="capacity" type="number" min="0" step="any" inputmode="decimal" value="${esc(keep('capacity', pump?.capacity ?? ''))}"><small>gal/stroke</small></label>
            <button type="button" class="primary" data-stroke="start">Start stroke count</button>
          </div><p class="stroke-message" role="status" hidden></p>`;
      } else {
        const rows = [...s.strokes].reverse();
        const total = s.strokes.at(-1);
        this.card.innerHTML = `<header class="stroke-header"><h3>Stroke count</h3><p>Started at ${esc(s.baseline.pressure)} psi, counter ${esc(s.baseline.counter)}${plan.target ? ` · target ${esc(plan.target)} psi` : ''} · every ${esc(plan.step)} psi</p></header>
          ${next === null ? `<div class="stroke-done">Stroke count complete${total ? ` · ${total.counter - s.baseline.counter} strokes · ${total.totalGallons.toFixed(2)} gal` : ''}.</div>`
            : `<div class="stroke-entry${reached ? ' reached' : ''}"><label>Counter at <b>${next} psi</b><input data-stroke-input="counter" type="number" min="0" step="1" inputmode="numeric" placeholder="Type, then Enter" autocomplete="off"></label><button type="button" class="primary" data-stroke="save">Save ⏎</button><span class="stroke-status"></span></div>`}
          <div class="stroke-actions"><button type="button" data-stroke="undo">${s.strokes.length || plan.skipped.length ? 'Undo last' : 'Cancel stroke count'}</button>${next === null ? '' : '<button type="button" data-stroke="skip">Skip this point</button>'}</div>
          <p class="stroke-message" role="status" hidden></p>
          <div class="stroke-table-wrap"><table class="stroke-table"><thead><tr><th>Pressure</th><th>Counter</th><th>Strokes</th><th>Gallons</th><th>Entered</th></tr></thead><tbody>
            ${rows.map((row) => `<tr><td>${esc(row.target)} psi</td><td>${esc(row.counter)}</td><td>${esc(row.strokes)}</td><td>${row.gallons.toFixed(2)}</td><td>${esc(clock(row.at))}</td></tr>`).join('')}
            <tr class="stroke-start"><td>${esc(s.baseline.pressure)} psi</td><td>${esc(s.baseline.counter)}</td><td>start</td><td></td><td>${esc(clock(s.baseline.at))}</td></tr>
          </tbody></table></div>`;
        const input = this.card.querySelector('[data-stroke-input="counter"]');
        if (input) {
          input.value = typed;
          // Keep typing flowing: refocus the counter box after a save or re-render.
          if (focused === 'counter' || this.wantFocus) { input.focus(); this.wantFocus = false; }
        }
        this.updateStatus(next, latest, reached);
      }
    }

    updateStatus(next, latest, reached) {
      const status = this.card.querySelector('.stroke-status');
      if (!status || next === null) return;
      const crossed = reached ? this.crossedAt(next) : null;
      status.className = `stroke-status ${reached ? 'stroke-reached' : 'stroke-waiting'}`;
      status.textContent = reached ? `Gauge reached ${next} psi${crossed ? ` at ${clock(crossed)}` : ''}`
        : latest ? `Gauge at ${latest.pressure.toFixed(1)} · ${(next - latest.pressure).toFixed(1)} psi to go` : '';
    }
  }

  function attach(gauges, helpers) {
    return gauges.map((gauge) => (gauge.strokeCount = new StrokeCount(gauge, helpers)));
  }

  root.HydroStrokeCount = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
