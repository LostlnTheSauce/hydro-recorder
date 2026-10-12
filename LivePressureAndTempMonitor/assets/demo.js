(function () {
  'use strict';
  const enabled = new URLSearchParams(window.location.search).get('demo') === '1';
  const values = new Map();
  const realDate = window.Date;
  const start = new realDate();
  start.setHours(4, 0, 0, 0);
  let offset = start.getTime() - realDate.now();
  const now = () => realDate.now() + offset;
  class ClockDate extends realDate {
    constructor(...args) { super(...(args.length ? args : [now()])); }
    static now() { return now(); }
  }
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };

  function attach(gauges) {
    if (!enabled) return;
    const app = document.getElementById('hostApp');
    app.classList.add('practice-mode');
    document.title = 'DEMO — Hydrotest practice';
    const banner = document.createElement('section');
    banner.className = 'demo-banner';
    banner.innerHTML = `<div><strong>DEMO · Practice only</strong><p>Real tests are untouched. No USB, field logger, remote publishing, Sheet sync or exports. Refreshing clears this practice run.</p></div><button type="button" class="demo-reset">Restart demo</button>`;
    app.querySelector('.app-header').after(banner);
    banner.querySelector('button').addEventListener('click', () => {
      if (window.confirm('Clear this practice run and start again? Your real tests will not change.')) window.location.reload();
    });
    app.querySelector('#remoteHeaderStatus').textContent = 'DEMO · not publishing';
    app.querySelector('.field-clock span').textContent = 'Demo time';
    app.querySelector('footer').textContent = 'DEMO · Simulated pressures only. Close this tab to return to your real host. Practice data is discarded on refresh or close.';

    // Hide hardware/import controls and disable all paperwork/export buttons.
    // API, serial and storage guards in host.js enforce isolation independently of UI.
    app.querySelectorAll('.connect-button,.backup-import-button').forEach(el => { el.hidden = true; });
    const blocked = '.paperwork-sync-panel button,.paperwork-sync-panel a,[data-export],.download-atmos-log,.temperature-device-connect,.temperature-device-disconnect';
    app.addEventListener('click', event => {
      if (event.target.closest(blocked)) {
        event.preventDefault(); event.stopImmediatePropagation();
        banner.querySelector('p').textContent = 'Practice only: exports, Google Sheets and real devices are disabled. Your real test stays untouched.';
      }
    }, true);
    app.querySelectorAll(blocked).forEach(el => { el.setAttribute('aria-disabled', 'true'); el.title = 'Unavailable in demo mode'; });

    const controls = gauges.map(g => {
      g.testState.displayName = `DEMO — Test ${g.slot === 'A' ? '1' : '2'}`;
      g.testState.jobNumber = 'DEMO-PRACTICE';
      g.testState.chartMax = '1500';
      g.restoreTestSetup();
      g.saveTestState();
      const panel = document.createElement('section');
      panel.className = 'demo-pressure-panel';
      panel.setAttribute('aria-label', `Demo pressure controls for Test ${g.slot === 'A' ? '1' : '2'}`);
      panel.innerHTML = `<div class="demo-pressure-heading"><strong>Simulated gauge pressure</strong><output class="demo-pressure-value">0 PSI</output></div>
        <label class="demo-slider-label">Pressure slider<input class="demo-pressure-slider" type="range" min="0" max="1500" step="0.1" value="0" aria-label="Simulated gauge pressure PSI"></label>
        <div class="workflow-fields"><label>Pressure (PSI)<input class="demo-pressure-number" type="number" min="0" max="1500" step="0.1" value="0"></label><label>Arrow-key step<select class="demo-pressure-step"><option value="0.1">0.1 PSI</option><option value="1" selected>1 PSI</option><option value="10">10 PSI</option><option value="25">25 PSI</option><option value="50">50 PSI</option></select></label><label>Slider / chart maximum (PSI)<input class="demo-pressure-max" type="number" min="100" max="100000" step="100" value="1500"></label></div>
        <p>Click the slider, then use ← / ↓ to decrease or → / ↑ to increase pressure. A simulated reading is recorded every second. Your configured offset is applied normally.</p>
        <div class="demo-time-actions"><label>Skip ahead<select class="demo-time-step"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="480">8 hours</option><option value="1440">24 hours</option><option value="2880">48 hours</option></select></label><button type="button" class="demo-skip-time">Advance demo time</button></div>
        <small>Skipping holds pressure steady and generates readings every 15 simulated seconds. Both tests share the demo clock. Stages never advance automatically.</small><p class="demo-status" role="status"></p>`;
      g.workflowController.card.before(panel);
      const c = { g, panel, pressure: 0 };
      const slider = panel.querySelector('.demo-pressure-slider');
      const input = panel.querySelector('.demo-pressure-number');
      const setPressure = value => {
        c.pressure = Math.max(0, Math.min(Number(slider.max), Math.round((Number(value) || 0) * 10) / 10));
        slider.value = input.value = String(c.pressure);
        panel.querySelector('output').textContent = `${c.pressure.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} PSI`;
        sampleAll();
      };
      slider.addEventListener('input', () => setPressure(slider.value));
      slider.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(e.key)) return;
        e.preventDefault();
        const direction = ['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1;
        setPressure(c.pressure + direction * Number(panel.querySelector('.demo-pressure-step').value));
      });
      input.addEventListener('change', () => setPressure(input.value));
      panel.querySelector('.demo-pressure-max').addEventListener('change', e => {
        if (!e.target.value || !e.target.reportValidity()) return;
        slider.max = input.max = e.target.value;
        g.root.querySelector('.chart-max').value = e.target.value;
        g.saveTestState(); setPressure(c.pressure);
      });
      panel.querySelector('.demo-skip-time').addEventListener('click', () => skip(now() + Number(panel.querySelector('.demo-time-step').value) * 60000, c));
      return c;
    });

    function reading(c, at) {
      return { at, pressure: c.g.recordedPressure(c.pressure), unit: 'PSI', source: 'demo' };
    }
    function sampleAll() {
      // Keep samples and stage actions ordered even during rapid key repeats.
      const latest = Math.max(0, ...controls.map(c => c.g.readings.at(-1)?.at || 0));
      if (now() <= latest) offset += latest + 1 - now();
      const at = now();
      controls.filter(c => c.g.active).forEach(c => {
        c.g.add(reading(c, at));
        c.g.setConnection('DEMO · simulated gauge', false);
        c.g.workflowController.render(true);
      });
    }
    function skip(target, control) {
      const from = now();
      if (!Number.isFinite(target) || target <= from || target - from > 48 * 3600000 + 1000) return;
      controls.filter(c => c.g.active).forEach(c => {
        // Batch the skipped interval, then render only once, not thousands of times.
        for (let at = from + 15000; at < target; at += 15000) c.g.readings.push(reading(c, at));
      });
      offset += target - now();
      sampleAll();
      control.panel.querySelector('.demo-status').textContent = `Demo time: ${new ClockDate().toLocaleString()}. Pressure held steady; add any checkpoint or note using its actual time.`;
    }
    sampleAll();
    setInterval(sampleAll, 1000);
  }
  window.HydroDemo = { enabled, storage, ClockDate, attach };
})();
