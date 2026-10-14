(function () {
  'use strict';

  const app = document.getElementById('hostApp');
  if (!app) return;
  if (!window.HydroJobs) {
    app.textContent = 'Update incomplete: upload assets/jobs.js, then refresh. Saved tests have not been changed.';
    return;
  }
  // Practice uses a tab-local store and clock; real browser storage/time are untouched.
  const demo = window.HydroDemo;
  if (new URLSearchParams(window.location.search).get('demo') === '1' && !demo?.enabled) {
    app.textContent = 'Demo could not load. Upload assets/demo.js with this update, then refresh. No test data was opened or changed.';
    return;
  }
  const localStorage = demo?.enabled ? demo.storage : window.localStorage;
  const Date = demo?.enabled ? demo.ClockDate : window.Date;
  const AUX_HEAT_ALERT_F = 135; // Auxiliary probe placed under the field laptop.
  const apiUrl = app.dataset.api;
  const csrf = app.dataset.csrf;
  const encoder = new TextEncoder();
  let hostNotes = [];
  const equipmentStorageKey = 'grantg-hydro-equipment-v1';
  const testStoragePrefix = 'grantg-hydro-test-v1-';

  const equipmentTypeLabels = {
    deadweight: 'Deadweight',
    digital_gauge: 'Digital gauge',
    pressure_recorder: 'Pressure recorder',
    ambient_chart: 'Ambient temperature chart',
    pipe_chart: 'Pipe temperature chart',
    ground_chart: 'Ground temperature chart',
    pump: 'Pump',
  };

  const starterEquipment = [
    { id: 'deadweight-5496', type: 'deadweight', name: 'Deadweight', serial: '5496', manufacturer: 'Refinery', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: true },
    { id: 'deadweight-5492', type: 'deadweight', name: 'Deadweight', serial: '5492', manufacturer: 'Refinery', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: false },
    { id: 'pressure-recorder-13045', type: 'pressure_recorder', name: 'Pressure recorder', serial: '13045', manufacturer: 'Tech-Cal', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: true },
    { id: 'digital-gauge-021863', type: 'digital_gauge', name: 'Crystal digital gauge', serial: '021863', manufacturer: 'AMETEK', range: '', calibrationDate: '', intervalMonths: 6, capacity: '', isDefault: true },
    { id: 'pump-pdq', type: 'pump', name: 'PDQ Pump', serial: '', manufacturer: '', range: '', calibrationDate: '', intervalMonths: 6, capacity: '0.0043', isDefault: true },
  ];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  // Summary page Pipeline Data columns, and the PDF's limiting-pipe rows combined the same way
  // the Sheet script combines them (matching OD, wall and grade; footage totaled).
  const PIPELINE_COLUMNS = ['od', 'wt', 'grade', 'length', 'buried', 'exposed', 'remarks'];
  function pipelineFromSegments(segments) {
    const grouped = new Map();
    (Array.isArray(segments) ? segments : []).forEach((segment) => {
      const key = [segment.outsideDiameterIn, segment.wallThicknessIn, segment.grade].join('|');
      const row = grouped.get(key) || { od: String(segment.outsideDiameterIn ?? ''), wt: String(segment.wallThicknessIn ?? ''), grade: String(segment.grade ?? ''), length: 0 };
      row.length += Number(segment.lengthFt) || 0;
      grouped.set(key, row);
    });
    return [...grouped.values()].slice(0, 6).map((row) => ({ ...row, length: row.length ? String(row.length) : '' }));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function loadEquipment() {
    try {
      const saved = JSON.parse(localStorage.getItem(equipmentStorageKey) || 'null');
      if (Array.isArray(saved)) return saved;
    } catch (_) {}
    return clone(starterEquipment);
  }

  let equipmentInventory = loadEquipment();

  function defaultTestState(slot) {
    return {
      jobNumber: '', poAfe: '', location: '', owner: 'Atmos Energy', contractor: 'Bobcat Contracting', ownerRep: '',
      displayName: testNameForSlot(slot), offset: 0, rampProfile: 'normal', equipment: {}, events: [], officialStart: '', officialEnd: '',
      chartMax: '1000', traceThickness: '1.0', windowBottom: '', windowTop: '', design: null, sheet: null, sheetStartRow: '', sheetColumns: { comments: false }, manualTemperatures: [], slot,
    };
  }

  function loadTestState(slot) {
    const fallback = defaultTestState(slot);
    try {
      const saved = JSON.parse(localStorage.getItem(`${testStoragePrefix}${slot}`) || 'null');
      if (saved && typeof saved === 'object') return {
        ...fallback,
        ...saved,
        equipment: { ...fallback.equipment, ...(saved.equipment || {}) },
        events: Array.isArray(saved.events) ? saved.events : [],
        manualTemperatures: Array.isArray(saved.manualTemperatures) ? saved.manualTemperatures.slice(-5000) : [],
        // Remarks start switched off only for new tests; a test saved before that keeps every column on.
        sheetColumns: 'sheetColumns' in saved ? saved.sheetColumns : null,
      };
    } catch (_) {}
    return fallback;
  }

  function dateTimeInputValue(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // A failed laptop save is never silent: the operator sees it, and the missed
  // readings are written again from memory once storage works.
  const localSaveHealth = (() => {
    let failingSince = 0;
    let missed = 0;
    const show = (text, tone) => {
      const banner = document.getElementById('localSaveAlert');
      if (!banner) return;
      banner.textContent = text;
      banner.className = `save-alert ${tone || ''}`;
      banner.hidden = !text;
    };
    return {
      onRecover: null,
      failed(error) {
        if (!failingSince) { failingSince = Date.now(); staleDing(); }
        missed += 1;
        show(`Laptop backup is failing since ${new Date(failingSince).toLocaleTimeString()} (${missed} reading${missed === 1 ? '' : 's'} not saved to this laptop${error?.name ? `: ${error.name}` : ''}). Recording continues on screen and online. Check free disk space and download a full backup from Records.`, 'error');
      },
      ok() {
        if (!failingSince) return;
        const since = failingSince;
        failingSince = 0;
        missed = 0;
        show(`Laptop backup recovered at ${new Date().toLocaleTimeString()}. Readings from ${new Date(since).toLocaleTimeString()} on were saved again from memory.`, 'warn');
        this.onRecover?.(since);
      },
    };
  })();

  function makeReadingStore() {
    if (demo?.enabled) return null;
    if (!('indexedDB' in window)) return null;
    navigator.storage?.persist?.().catch(() => {});
    let databasePromise = null;
    const open = () => {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('grantg-hydrotest-recordings', 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('readings')) {
            const store = database.createObjectStore('readings', { keyPath: 'id' });
            store.createIndex('slot_at', ['slot', 'at'], { unique: false });
          }
        };
        request.onsuccess = () => {
          request.result.onclose = () => { databasePromise = null; };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
      });
      // Retry opening on the next reading instead of failing forever.
      databasePromise.catch(() => { databasePromise = null; });
      return databasePromise;
    };
    return {
      async add(slot, reading) {
        try {
          const database = await open();
          const transaction = database.transaction('readings', 'readwrite');
          transaction.objectStore('readings').put({ ...reading, id: `${slot}:${reading.at}`, slot });
          transaction.oncomplete = () => localSaveHealth.ok();
          transaction.onabort = () => localSaveHealth.failed(transaction.error);
        } catch (error) {
          databasePromise = null;
          localSaveHealth.failed(error);
        }
      },
      async load(slot, strict = false) {
        try {
          const database = await open();
          const transaction = database.transaction('readings', 'readonly');
          const request = transaction.objectStore('readings').index('slot_at').getAll(IDBKeyRange.bound([slot, 0], [slot, Number.MAX_SAFE_INTEGER]));
          return await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve((request.result || []).map(({ id, slot: ignored, ...reading }) => reading).slice(-500000));
            request.onerror = () => strict ? reject(request.error) : resolve([]);
          });
        } catch (error) { if (strict) throw error; return []; }
      },
      async clear(slot) {
        try {
          const database = await open();
          const transaction = database.transaction('readings', 'readwrite');
          const index = transaction.objectStore('readings').index('slot_at');
          const request = index.openKeyCursor(IDBKeyRange.bound([slot, 0], [slot, Number.MAX_SAFE_INTEGER]));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            transaction.objectStore('readings').delete(cursor.primaryKey);
            cursor.continue();
          };
        } catch (_) {}
      },
    };
  }

  const readingStore = makeReadingStore();
  let audioContext = null;

  // Chrome slows timers in a minimized window to about once a minute; a
  // worker's timer is not slowed, so the gauge is still asked every second.
  const gaugeTicker = (() => {
    const listeners = new Set();
    let source = null;
    const tick = () => listeners.forEach((listener) => { try { listener(); } catch (_) {} });
    return {
      add(listener) {
        listeners.add(listener);
        if (source) return;
        try {
          const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000);'], { type: 'text/javascript' }));
          const worker = new Worker(url);
          URL.revokeObjectURL(url);
          worker.onmessage = tick;
          source = () => worker.terminate();
        } catch (_) {
          const timer = setInterval(tick, 1000);
          source = () => clearInterval(timer);
        }
      },
      remove(listener) {
        listeners.delete(listener);
        if (!listeners.size && source) { source(); source = null; }
      },
    };
  })();

  // Keep the trailer laptop's screen (and with it the page) awake while a gauge is connected.
  const screenAwake = (() => {
    let lock = null;
    const wanted = () => gauges.some((gauge) => gauge.port || gauge.reconnectWanted);
    async function update() {
      if (!('wakeLock' in navigator) || demo?.enabled) return;
      if (wanted() && !lock && document.visibilityState === 'visible') {
        try {
          lock = await navigator.wakeLock.request('screen');
          lock.addEventListener('release', () => { lock = null; });
        } catch (_) {}
      } else if (!wanted() && lock) {
        const held = lock;
        lock = null;
        held.release().catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', update);
    return { update };
  })();

  const gaugePortKey = (slot) => `grantg-gauge-port-${slot}`;
  function rememberGaugePort(slot, info) {
    try { localStorage.setItem(gaugePortKey(slot), JSON.stringify(info || {})); } catch (_) {}
  }
  function forgetGaugePort(slot) {
    try { localStorage.removeItem(gaugePortKey(slot)); } catch (_) {}
  }
  function savedGaugePort(slot) {
    try { return JSON.parse(localStorage.getItem(gaugePortKey(slot)) || 'null'); } catch (_) { return null; }
  }
  const sameGaugeModel = (a, b) => (a?.usbVendorId ?? null) === (b?.usbVendorId ?? null) && (a?.usbProductId ?? null) === (b?.usbProductId ?? null);

  // Reopen a gauge only when the choice is unambiguous; with two identical
  // gauges waiting, the operator picks so tests never swap.
  async function findGaugePort(gauge) {
    if (!('serial' in navigator)) return null;
    const wanted = gauge.portInfo || savedGaugePort(gauge.slot);
    if (!wanted) return null;
    const ports = await navigator.serial.getPorts().catch(() => []);
    const busy = new Set(gauges.map((other) => other.port).filter(Boolean));
    const matches = ports.filter((port) => !busy.has(port) && sameGaugeModel(port.getInfo?.(), wanted));
    const competing = gauges.some((other) => other !== gauge && !other.port && (other.reconnectWanted || savedGaugePort(other.slot))
      && other.active && sameGaugeModel(other.portInfo || savedGaugePort(other.slot), wanted));
    if (matches.length === 1 && !competing) return matches[0];
    if (matches.length && gauge.reconnectWanted) {
      gauge.cancelReconnect();
      gauge.setConnection('Gauge disconnected • press Connect gauge and pick it', false);
      gauge.showError('More than one matching gauge is plugged in, so it was not reconnected automatically. Press Connect gauge and choose the right one.');
      screenAwake.update();
    }
    return null;
  }

  function staleDing() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.35);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.38);
    } catch (_) {}
  }

  function testNameForSlot(slot) {
    return slot === 'A' ? 'Test 1' : 'Test 2';
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  class GaugeHost {
    constructor(root) {
      this.root = root;
      this.slot = root.dataset.gauge;
      this.traceColor = root.dataset.color;
      this.port = null;
      this.reader = null;
      this.queryTimer = null;
      this.keepReading = false;
      this.buffer = '';
      this.readings = [];
      this.temperatureReadings = [];
      this.peak = null;
      this.low = null;
      this.decoder = new TextDecoder();
      this.connectedAt = 0;
      this.staleAlerted = false;
      this.portInfo = null;
      this.reconnectWanted = false;
      this.reconnectTimer = null;
      this.unitWarning = '';
      this.queryTick = () => this.query().catch((error) => this.showError(error.message));
      this.active = !root.classList.contains('inactive-test');
      this.pendingDesign = null;
      this.sheetSyncInFlight = false;
      this.testState = loadTestState(this.slot);
      this.temperatureReadings = this.normalizeManualTemperatures(this.testState.manualTemperatures);
      this.testState.manualTemperatures = this.temperatureReadings;
      this.canvas = root.querySelector('.pressure-chart');
      this.temperaturePanel = root.querySelector('[data-temperature-panel]');
      this.operations = root.querySelector('[data-test-operations]');
      this.restoreTestSetup();
      this.bind();
      this.draw();
      this.readingsReady = this.restoreStoredReadings();
    }

    bind() {
      this.root.querySelector('.connect-button').addEventListener('click', () => this.connected() || this.reconnectWanted ? this.disconnect() : this.connect());
      const pen = this.root.querySelector('.pen-size');
      pen.addEventListener('input', () => {
        pen.nextElementSibling.textContent = Number(pen.value).toFixed(1);
        this.draw();
      });
      const windowThickness = this.root.querySelector('.window-thickness');
      windowThickness.addEventListener('input', () => {
        windowThickness.nextElementSibling.textContent = windowThickness.value;
        this.draw();
      });
      this.root.querySelectorAll('.settings-grid input,.gauge-name').forEach((input) => input.addEventListener('change', () => {
        this.draw();
        this.updateWarning();
      }));
      this.bindTestSetup();
      this.root.querySelectorAll('.temp-name').forEach((input) => input.addEventListener('input', () => this.drawTemperature()));
      window.TemperatureChartRenderer.bindPanel(this.temperaturePanel, () => this.drawTemperature());
      this.root.querySelector('.rate-target')?.addEventListener('input', (event) => {
        const value = Number(event.target.value);
        this.testState.rateTarget = event.target.value !== '' && Number.isFinite(value) && value > 0 ? value : null;
        this.saveTestState();
        this.updateRate();
      });
      this.root.querySelector('.temp-smoothing')?.addEventListener('change', (event) => {
        this.testState.temperatureSmoothing = Number(event.target.value) || 0;
        this.saveTestState();
      });
      this.bindManualTemperatures();
    }

    connected() { return Boolean(this.port); }

    // The saved offset, not the box: while a new offset is still being typed, readings keep the old
    // one and are shifted with the rest of the series when it is entered (no double offset, no blip).
    pressureOffset() {
      return Number(this.testState.offset) || 0;
    }

    recordedPressure(rawPressure, offset = this.pressureOffset()) {
      const raw = Number(rawPressure);
      if (!Number.isFinite(raw)) return null;
      // Near zero the gauge reading is shown as is: the offset is not applied, but nothing is rounded away.
      return Math.abs(raw) <= .5 ? raw : raw + Number(offset || 0);
    }

    settings() {
      const shareTemperatures = document.getElementById('viewerShowTemperatures')?.checked === true;
      const temperatureOptions = this.temperatureRecordingOptions();
      return {
        name: this.root.querySelector('.gauge-name').value.trim() || testNameForSlot(this.slot),
        jobId: this.testState.jobId || '',
        jobStartedAt: Number(this.testState.jobStartedAt) || 0,
        temperatureSourceIds: this.testState.temperatureSourceIds,
        active: this.active,
        chartMax: Math.max(1, Number(this.root.querySelector('.chart-max').value) || 1000),
        traceColor: this.traceColor,
        traceThickness: Math.max(.1, Math.min(5, Number(this.root.querySelector('.pen-size').value) || 1)),
        windowThickness: Number(this.root.querySelector('.window-thickness').value) || 1,
        windowBottom: this.root.querySelector('.window-bottom').value.trim(),
        windowTop: this.root.querySelector('.window-top').value.trim(),
        warningMargin: Math.max(1, Number(this.root.querySelector('.warning-margin').value) || 10),
        pressureOffset: this.pressureOffset(),
        testStart: this.testState.officialStart,
        testEnd: this.testState.officialEnd,
        showWindow: this.root.querySelector('.show-window').checked,
        temperature: {
          channels: this.temperatureChannels(),
          enabledProbes: this.testState.enabledProbes || ['ambient', 'pipe', 'soil', 'aux'],
          readings: shareTemperatures ? this.testState.manualTemperatures.slice(-2000) : [],
          preview: true,
          viewerVisible: shareTemperatures,
          wholeDegrees: temperatureOptions.wholeDegrees,
          sampleIntervalSeconds: temperatureOptions.sampleIntervalSeconds,
          smoothingSeconds: this.smoothingSeconds(),
        },
      };
    }

    temperatureRecordingOptions() {
      return {
        wholeDegrees: this.root.querySelector('.temperature-whole-degrees')?.checked === true,
        sampleIntervalSeconds: Math.max(2, Math.min(60,
          Number(this.root.querySelector('.temperature-sample-interval')?.value) || 2)),
      };
    }

    temperatureChannels() {
      const defaults = window.TemperatureChartRenderer.DEFAULT_CHANNELS;
      return defaults.map((channel) => {
        const input = this.root.querySelector(`[data-temp-name="${channel.key}"]`);
        return { ...channel, name: input?.value.trim() || channel.name };
      });
    }

    // Temperature smoothing for this test: 2-minute average unless the host changes it.
    smoothingSeconds() {
      const value = this.testState.temperatureSmoothing;
      return value === undefined || value === null ? 120 : [0, 20, 60, 120, 300].includes(Number(value)) ? Number(value) : 120;
    }

    restoreTestSetup() {
      const rateInput = this.root.querySelector('.rate-target');
      if (rateInput && document.activeElement !== rateInput) rateInput.value = this.rateTarget() ?? '';
      const smoothing = this.root.querySelector('.temp-smoothing');
      if (smoothing) smoothing.value = String(this.smoothingSeconds());
      if (!this.root.querySelector('.enabled-probes')) {
        const probes = document.createElement('fieldset'); probes.className = 'enabled-probes';
        probes.innerHTML = '<legend>Probes used for this test</legend><p>Unchecked probes are hidden from viewers. Original logger readings are still retained.</p>';
        for (const [key, name] of [['ambient','Ambient'],['pipe','Pipe'],['soil','Soil'],['aux','Auxiliary']]) {
          const label = document.createElement('label'); label.className = 'temp-toggle';
          const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.enabledProbe = key;
          label.append(input, document.createTextNode(name)); probes.append(label);
          input.addEventListener('change', () => {
            this.testState.enabledProbes = [...probes.querySelectorAll('input[data-enabled-probe]:checked')].map(el => el.dataset.enabledProbe);
            this.saveTestState(); publish();
          });
        }
        // Auxiliary often sits under the field laptop to watch its heat; switch off when it's used for something else.
        const heat = document.createElement('label'); heat.className = 'temp-toggle aux-heat-alert';
        const heatInput = document.createElement('input'); heatInput.type = 'checkbox'; heatInput.className = 'aux-heat-alert-toggle';
        heat.append(heatInput, document.createTextNode(`Alert when Auxiliary reaches ${AUX_HEAT_ALERT_F} °F (laptop heat)`)); probes.append(heat);
        heatInput.addEventListener('change', () => { this.testState.auxHeatAlert = heatInput.checked; this.saveTestState(); });
        this.temperaturePanel.querySelector('.temperature-controls').before(probes);
      }
      this.root.querySelector('.aux-heat-alert-toggle').checked = this.testState.auxHeatAlert !== false;
      this.root.querySelectorAll('[data-enabled-probe]').forEach(input => {
        input.checked = (this.testState.enabledProbes || ['ambient','pipe','soil','aux']).includes(input.dataset.enabledProbe);
      });
      const fieldMap = {
        '.job-number': 'jobNumber', '.po-afe': 'poAfe', '.job-location': 'location', '.asset-owner': 'owner',
        '.contractor': 'contractor', '.owner-rep': 'ownerRep', '.pressure-offset': 'offset', '.ramp-profile': 'rampProfile',
        '.test-start': 'officialStart', '.test-end': 'officialEnd', '.gauge-name': 'displayName', '.chart-max': 'chartMax', '.pen-size': 'traceThickness',
        '.window-bottom': 'windowBottom', '.window-top': 'windowTop',
      };
      Object.entries(fieldMap).forEach(([selector, key]) => {
        const input = this.root.querySelector(selector);
        if (input && this.testState[key] !== undefined) input.value = String(this.testState[key] ?? '');
      });
      const liveChartMax = this.root.querySelector('.live-chart-max');
      if (liveChartMax) liveChartMax.value = String(this.testState.chartMax || '1000');
      const pen = this.root.querySelector('.pen-size');
      if (pen) pen.nextElementSibling.textContent = Number(pen.value).toFixed(1);
      if (this.testState.design) {
        this.pendingDesign = clone(this.testState.design);
        this.renderDesignReview(this.pendingDesign, { applied: true });
      }
      this.renderSheetStatus();
      this.renderTestEvents();
      this.renderManualTemperatures();
    }

    normalizeManualTemperatures(entries) {
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((entry) => Number.isFinite(Number(entry?.at)))
        .map((entry) => {
          const normalized = { at: Number(entry.at), source: entry.source === 'sheet' ? 'sheet' : 'manual' };
          ['ambient', 'pipe', 'soil'].forEach((key) => {
            if (entry[key] !== '' && entry[key] !== null && entry[key] !== undefined && Number.isFinite(Number(entry[key]))) normalized[key] = Number(entry[key]);
          });
          return normalized;
        })
        .filter((entry) => ['ambient', 'pipe', 'soil'].some((key) => Number.isFinite(Number(entry[key]))))
        .sort((a, b) => a.at - b.at)
        .slice(-5000);
    }

    bindManualTemperatures() {
      const time = this.root.querySelector('.manual-temperature-time');
      if (time && !time.value) time.value = dateTimeInputValue(new Date());
      this.root.querySelector('.save-manual-temperature')?.addEventListener('click', () => this.saveManualTemperature());
      this.root.querySelector('.manual-temperature-history tbody')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-manual-temperature-at]');
        if (!button) return;
        const at = Number(button.dataset.manualTemperatureAt);
        const reading = this.temperatureReadings.find((entry) => Number(entry.at) === at && entry.source === 'manual');
        if (!reading || !window.confirm(`Remove the temperature reading from ${new Date(at).toLocaleString()}?`)) return;
        this.temperatureReadings = this.temperatureReadings.filter((entry) => !(Number(entry.at) === at && entry.source === 'manual'));
        this.testState.manualTemperatures = this.normalizeManualTemperatures(this.temperatureReadings.filter((entry) => entry.source === 'manual' || entry.source === 'sheet'));
        this.saveTestState();
        this.renderManualTemperatures('Reading removed.');
        this.drawTemperature();
      });
    }

    saveManualTemperature() {
      const time = this.root.querySelector('.manual-temperature-time');
      const at = time?.value ? new Date(time.value).getTime() : NaN;
      if (!Number.isFinite(at)) {
        this.renderManualTemperatures('Choose a valid date and time.', true);
        return;
      }
      const fields = {
        ambient: this.root.querySelector('.manual-temperature-ambient'),
        pipe: this.root.querySelector('.manual-temperature-pipe'),
        soil: this.root.querySelector('.manual-temperature-ground'),
      };
      const existing = this.temperatureReadings.find((entry) => Number(entry.at) === at && entry.source === 'manual');
      const reading = existing ? { ...existing, at, source: 'manual' } : { at, source: 'manual' };
      let enteredCount = 0;
      Object.entries(fields).forEach(([key, input]) => {
        const text = input?.value.trim() || '';
        if (text !== '' && Number.isFinite(Number(text))) {
          reading[key] = Number(text);
          enteredCount += 1;
        }
      });
      if (!enteredCount) {
        this.renderManualTemperatures('Enter at least one temperature.', true);
        return;
      }
      const replaced = Boolean(existing);
      this.temperatureReadings = this.temperatureReadings.filter((entry) => !(Number(entry.at) === at && entry.source === 'manual'));
      this.temperatureReadings.push(reading);
      this.temperatureReadings.sort((a, b) => Number(a.at) - Number(b.at));
      this.testState.manualTemperatures = this.normalizeManualTemperatures(this.temperatureReadings.filter((entry) => entry.source === 'manual' || entry.source === 'sheet'));
      this.saveTestState();
      Object.values(fields).forEach((input) => { if (input) input.value = ''; });
      if (time) time.value = dateTimeInputValue(new Date());
      this.renderManualTemperatures(replaced ? 'Reading at that time was updated.' : 'Temperature reading saved.');
      this.drawTemperature();
    }

    renderManualTemperatures(message = '', error = false) {
      const body = this.root.querySelector('.manual-temperature-history tbody');
      const status = this.root.querySelector('.manual-temperature-status');
      if (!body || !status) return;
      const entries = this.temperatureReadings.filter((entry) => entry.source === 'manual' || entry.source === 'sheet').sort((a, b) => Number(b.at) - Number(a.at));
      const temperatureCell = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} °F` : '—';
      body.innerHTML = entries.length ? entries.slice(0, 12).map((entry) => `<tr><td>${escapeHtml(new Date(entry.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td>${temperatureCell(entry.ambient)}</td><td>${temperatureCell(entry.pipe)}</td><td>${temperatureCell(entry.soil)}</td><td>${entry.source === 'sheet' ? '<span class="temperature-source">Google Sheet</span>' : `<button class="ghost manual-temperature-delete" type="button" data-manual-temperature-at="${entry.at}" aria-label="Remove this temperature reading">Remove</button>`}</td></tr>`).join('') : '<tr><td colspan="5" class="event-empty">Manual and Google Sheet readings will appear here.</td></tr>';
      const sheetCount = entries.filter((entry) => entry.source === 'sheet').length;
      const siteCount = entries.length - sheetCount;
      status.textContent = message || (entries.length ? `${siteCount} site and ${sheetCount} Google Sheet temperature reading${entries.length === 1 ? '' : 's'} available. The latest 12 are shown.` : 'No manual temperature readings saved for this test.');
      status.classList.toggle('error', error);
    }

    bindTestSetup() {
      const simpleFields = {
        '.job-number': 'jobNumber', '.po-afe': 'poAfe', '.job-location': 'location', '.asset-owner': 'owner',
        '.contractor': 'contractor', '.owner-rep': 'ownerRep', '.ramp-profile': 'rampProfile',
        '.gauge-name': 'displayName', '.chart-max': 'chartMax', '.pen-size': 'traceThickness',
        '.window-bottom': 'windowBottom', '.window-top': 'windowTop',
      };
      Object.entries(simpleFields).forEach(([selector, key]) => {
        const input = this.root.querySelector(selector);
        if (!input) return;
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
          this.testState[key] = input.value;
          if (key === 'chartMax') {
            const liveChartMax = this.root.querySelector('.live-chart-max');
            if (liveChartMax) liveChartMax.value = input.value;
            this.draw();
            this.updateWarning();
          }
          this.saveTestState();
          if (key === 'rampProfile') this.renderTestEvents();
        });
      });
      const liveChartMax = this.root.querySelector('.live-chart-max');
      liveChartMax?.addEventListener('input', () => {
        const value = Number(liveChartMax.value);
        if (!Number.isFinite(value) || value <= 0) return;
        const chartMax = this.root.querySelector('.chart-max');
        chartMax.value = liveChartMax.value;
        this.testState.chartMax = liveChartMax.value;
        this.saveTestState();
        this.draw();
        this.updateWarning();
      });
      this.bindDesignImporter();
      this.bindGoogleSheet();
      this.root.querySelectorAll('.equipment-select').forEach((select) => select.addEventListener('change', () => {
        this.testState.equipment[select.dataset.equipmentRole] = select.value;
        this.saveTestState();
        this.renderCalibrationSummary();
      }));
      const offset = this.root.querySelector('.pressure-offset');
      offset.addEventListener('change', () => {
        const next = Number(offset.value) || 0;
        const previous = Number(this.testState.offset) || 0;
        const activeTest = this.officialTestIsActive();
        if (activeTest && next !== previous && !window.confirm(`The official test is active. Change the pressure offset from ${previous} psi to ${next} psi?`)) {
          offset.value = String(previous);
          return;
        }
        this.testState.offset = next;
        if (next !== previous) this.reapplyPressureOffset(previous, next);
        if (activeTest && next !== previous) this.addTestEvent('configuration', `Pressure offset changed from ${previous} psi to ${next} psi`, this.latestPressure());
        this.saveTestState();
      });
      this.root.querySelector('.download-atmos-log').addEventListener('click', (event) => this.downloadAtmosLog(event.currentTarget));
      this.root.querySelector('.restore-test-backup').addEventListener('change', (event) => this.restoreTestBackup(event.target.files[0], event.target));

    }

    bindDesignImporter() {
      const fileInput = this.root.querySelector('.test-design-file');
      const applyButton = this.root.querySelector('.apply-test-design');
      const closeButton = this.root.querySelector('.close-test-design-review');
      const reopenButton = this.root.querySelector('.review-saved-design');
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        await this.importTestDesign(file);
        fileInput.value = '';
      });
      applyButton.addEventListener('click', () => this.applyReviewedDesign());
      closeButton.addEventListener('click', () => this.root.querySelector('.test-design-review').classList.add('hidden'));
      // Also for typing the design in by hand (e.g. a scanned PDF the site cannot read).
      reopenButton.addEventListener('click', () => {
        if (!this.pendingDesign && !this.testState.design) this.renderDesignReview({ pipeSegments: [] }, { manual: true });
        this.root.querySelector('.test-design-review').classList.remove('hidden');
      });
    }

    async importTestDesign(file) {
      if (this.jobTransition) return;
      this.importingDesign = true;
      const status = this.root.querySelector('.test-design-status');
      const review = this.root.querySelector('.test-design-review');
      status.className = 'test-design-status working';
      status.textContent = `Reading ${file.name}…`;
      review.classList.add('hidden');
      try {
        if (!window.AtmosTestDesignImporter) throw new Error('The PDF importer is unavailable. Refresh the page and try again.');
        const result = await window.AtmosTestDesignImporter.extract(file);
        this.pendingDesign = result.data;
        this.renderDesignReview(result.data, { warnings: result.warnings, pageCount: result.pageCount });
      } catch (error) {
        status.className = 'test-design-status error';
        status.textContent = `Could not read that PDF: ${error?.message || 'unknown error'}`;
      } finally { this.importingDesign = false; }
    }

    renderDesignReview(design, options = {}) {
      if (!design) return;
      const review = this.root.querySelector('.test-design-review');
      const status = this.root.querySelector('.test-design-status');
      review.querySelectorAll('[data-design-field]').forEach((input) => {
        input.value = design[input.dataset.designField] ?? '';
      });
      const body = review.querySelector('.design-pipe-table tbody');
      const rows = Array.isArray(design.pipeSegments) ? design.pipeSegments : [];
      body.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.startStation)}</td><td>${escapeHtml(row.endStation)}</td><td>${escapeHtml(row.lengthFt)} ft</td><td>${escapeHtml(row.outsideDiameterIn)} in</td><td>${escapeHtml(Number(row.smysPsi).toLocaleString())} psi / <b>${escapeHtml(row.grade)}</b></td><td>${escapeHtml(row.wallThicknessIn)} in</td><td>${escapeHtml(row.dotClass)}</td><td>${escapeHtml(Number(row.yieldPressurePsig).toLocaleString())} psi</td><td>${escapeHtml(row.reassessmentYears)} yr</td></tr>`).join('') : '<tr><td colspan="9" class="event-empty">No limiting-pipe rows were found. Check the PDF before applying.</td></tr>';
      // Pipeline Data (Summary page): typed rows, or the PDF's limiting pipe combined by OD, wall and grade.
      const pipeline = Array.isArray(design.pipelineRows) ? design.pipelineRows : pipelineFromSegments(rows);
      review.querySelector('.design-pipeline-table tbody').innerHTML = Array.from({ length: 6 }, (_, index) => `<tr>${PIPELINE_COLUMNS.map((column) =>
        `<td><input data-pipeline-row="${index}" data-pipeline-col="${column}" value="${escapeHtml(pipeline[index]?.[column] ?? '')}" ${column === 'grade' || column === 'remarks' ? 'autocomplete="off"' : 'inputmode="decimal"'} aria-label="Pipeline row ${index + 1} ${column}"></td>`).join('')}</tr>`).join('');
      review.classList.remove('hidden');
      this.root.querySelector('.review-saved-design').classList.remove('hidden');
      const warnings = options.warnings || [];
      if (options.manual) {
        status.className = 'test-design-status ready';
        status.textContent = 'Type the values from the test design, including the Pipeline data rows, then press Apply reviewed values.';
      } else if (options.applied) {
        status.className = 'test-design-status applied';
        status.textContent = `Applied ${design.sourceFileName || 'saved test design'} to this test. You can reopen the review here at any time.`;
      } else if (warnings.length) {
        status.className = 'test-design-status warning';
        status.textContent = `Read ${options.pageCount || ''} page${options.pageCount === 1 ? '' : 's'}. Review carefully: ${warnings.join('; ')}.`;
      } else {
        status.className = 'test-design-status ready';
        status.textContent = `Read ${options.pageCount || ''} page${options.pageCount === 1 ? '' : 's'} and found the expected Atmos fields. Review them before applying.`;
      }
    }

    reviewedDesign() {
      const base = clone(this.pendingDesign || this.testState.design || {});
      this.root.querySelectorAll('[data-design-field]').forEach((input) => {
        base[input.dataset.designField] = input.value.trim();
      });
      base.pipeSegments = Array.isArray(base.pipeSegments) ? base.pipeSegments : [];
      const pipeline = [];
      this.root.querySelectorAll('[data-pipeline-col]').forEach((input) => {
        const row = pipeline[input.dataset.pipelineRow] || (pipeline[input.dataset.pipelineRow] = {});
        row[input.dataset.pipelineCol] = input.value.trim();
      });
      base.pipelineRows = pipeline.filter((row) => row && Object.values(row).some(Boolean));
      return base;
    }

    applyReviewedDesign() {
      const design = this.reviewedDesign();
      this.pendingDesign = design;
      this.testState.design = clone(design);
      const assignments = [
        ['.po-afe', 'poAfe', design.projectNumber],
        ['.job-location', 'location', [design.projectLocation, design.countyState].filter(Boolean).join(' • ')],
        ['.window-bottom', 'windowBottom', design.windowBottom],
        ['.window-top', 'windowTop', design.windowTop],
      ];
      assignments.forEach(([selector, key, value]) => {
        if (value === '' || value === undefined || value === null) return;
        this.root.querySelector(selector).value = value;
        this.testState[key] = String(value);
      });
      const top = Number(design.windowTop);
      const chartMaxInput = this.root.querySelector('.chart-max');
      if (Number.isFinite(top) && top > Number(chartMaxInput.value)) {
        const chartMax = String(Math.ceil(top / 500) * 500);
        chartMaxInput.value = chartMax;
        this.root.querySelector('.live-chart-max').value = chartMax;
        this.testState.chartMax = chartMax;
      }
      this.saveTestState();
      this.draw();
      this.updateWarning();
      this.renderDesignReview(design, { applied: true });
    }

    bindGoogleSheet() {
      this.root.querySelector('.create-google-sheet').addEventListener('click', () => this.createGoogleSheet());
      this.root.querySelector('.open-google-sheet').addEventListener('click', () => {
        if (this.testState.sheet?.url) window.open(this.testState.sheet.url, '_blank', 'noopener');
      });
      this.root.querySelector('.sync-google-sheet').addEventListener('click', () => this.syncGoogleSheet());
      this.root.querySelectorAll('[data-sheet-column]').forEach((box) => box.addEventListener('change', () => {
        this.testState.sheetColumns = Object.fromEntries([...this.root.querySelectorAll('[data-sheet-column]')].map((input) => [input.dataset.sheetColumn, input.checked]));
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        const off = this.sheetColumnsOff();
        this.renderSheetStatus(off.length ? `Sync to Sheet will leave the ${off.join(', ')} column${off.length === 1 ? '' : 's'} as they are in the Sheet.` : 'Sync to Sheet will fill every column.');
      }));
      // Pre-test entries typed into the Sheet by hand can be left alone: the official test then
      // starts on the chosen LOG row and nothing above it is written.
      this.root.querySelector('.sheet-pretest-toggle').addEventListener('change', (event) => {
        this.testState.sheetPreTest = event.target.checked;
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        try {
          const layout = window.HydroWorkflow.sheetCapacity(this.sheetRowsToSync(), this.testState.sheetStartRow);
          this.renderSheetStatus(event.target.checked ? this.sheetRowsMessage(layout, 'will go on') : `Pre-test entries will not be synced. ${this.sheetRowsMessage(layout, 'will go on')}`);
        } catch (error) { this.renderSheetStatus(error.message, 'error'); }
      });
      this.root.querySelector('.sheet-design-toggle').addEventListener('change', (event) => {
        this.testState.sheetDesign = event.target.checked;
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        this.renderSheetStatus(event.target.checked ? 'Sync to Sheet will fill the test design values the site has (blank ones never erase the Sheet).' : 'Sync to Sheet will leave the test design values in the Sheet as they are.');
      });
      this.root.querySelector('.sheet-strokes-toggle').addEventListener('change', (event) => {
        this.testState.sheetStrokes = event.target.checked;
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        this.renderSheetStatus(event.target.checked ? 'Sync to Sheet will fill the Test Stroke Count tab from the stroke count.' : 'Sync to Sheet will leave the Test Stroke Count tab as it is.');
      });
      this.root.querySelector('.sheet-start-row-input').addEventListener('change', (event) => {
        const row = Math.round(Number(event.target.value));
        this.testState.sheetStartRow = event.target.value === '' || !Number.isFinite(row) ? '' : row;
        event.target.value = this.testState.sheetStartRow;
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        try {
          const layout = window.HydroWorkflow.sheetCapacity(this.sheetRowsToSync(), this.testState.sheetStartRow);
          this.renderSheetStatus(this.sheetRowsMessage(layout, 'will go on'));
        } catch (error) {
          this.renderSheetStatus(error.message, 'error');
        }
      });
    }

    sheetRowsMessage(layout, verb) {
      const chosen = this.testState.sheetStartRow;
      if (!layout.officialFirstRow) return chosen ? `The official test will start on LOG row ${chosen}. Rows above it that the site doesn't fill are left as you typed them.` : 'The official test will follow the pre-test entries in the LOG.';
      const rows = `LOG rows ${layout.officialFirstRow}–${layout.officialLastRow}`;
      return `The official test ${verb} ${rows}${chosen ? '. Rows above it that the site doesn\'t fill are left as you typed them.' : ', right after the pre-test entries.'}`;
    }

    renderSheetStatus(message = '', state = '') {
      const sheet = this.testState.sheet;
      const panel = this.root.querySelector('.paperwork-sync-panel');
      const status = this.root.querySelector('.sheet-sync-status');
      const create = this.root.querySelector('.create-google-sheet');
      const open = this.root.querySelector('.open-google-sheet');
      const sync = this.root.querySelector('.sync-google-sheet');
      const copy = this.root.querySelector('.sheet-sync-message');
      const startRow = this.root.querySelector('.sheet-start-row-input');
      if (document.activeElement !== startRow) startRow.value = this.testState.sheetStartRow || '';
      this.root.querySelector('.sheet-pretest-toggle').checked = this.testState.sheetPreTest !== false;
      this.root.querySelector('.sheet-strokes-toggle').checked = this.testState.sheetStrokes !== false;
      this.root.querySelector('.sheet-design-toggle').checked = this.testState.sheetDesign !== false;
      this.root.querySelectorAll('[data-sheet-column]').forEach((box) => { box.checked = this.testState.sheetColumns?.[box.dataset.sheetColumn] !== false; });
      const exists = Boolean(sheet?.spreadsheetId && sheet?.url);
      open.disabled = !exists;
      sync.disabled = !exists || this.sheetSyncInFlight;
      create.disabled = this.sheetSyncInFlight;
      create.textContent = exists ? 'Create replacement Sheet' : 'Create Google Sheet';
      panel.classList.toggle('sync-error', state === 'error');
      panel.classList.toggle('sync-complete', state === 'complete');
      if (state === 'working') {
        status.className = 'pill sheet-sync-status';
        status.textContent = 'Syncing…';
      } else if (state === 'error') {
        status.className = 'pill stale sheet-sync-status';
        status.textContent = 'Sync needs attention';
      } else if (exists) {
        status.className = 'pill amber sheet-sync-status';
        status.textContent = sheet.lastSyncedAt ? `Manual only · last sync ${new Date(sheet.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Manual only';
      } else {
        status.className = 'pill amber sheet-sync-status';
        status.textContent = 'Sheet not created';
      }
      copy.textContent = message || (exists
        ? 'Manual-only: no Sheet updates occur until you press Sync to Sheet. Gauge recording continues locally.'
        : 'Creating a Sheet fills a new copy once. After that, updates happen only when you press Sync to Sheet.');
    }

    sheetTitle() {
      const design = this.testState.design || {};
      const date = new Date(this.testState.officialStart ? new Date(this.testState.officialStart) : Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-');
      const names = [this.testState.jobNumber, design.lineName, this.settings().name].filter(Boolean);
      return `${[...new Set(names)].slice(0, 2).join(' - ') || testNameForSlot(this.slot)} - ${date} Hydrotest`;
    }

    selectedEquipmentForSheet() {
      const selected = {};
      Object.entries(this.testState.equipment || {}).forEach(([role, id]) => {
        const item = equipmentInventory.find((entry) => entry.id === id);
        if (!item) return;
        selected[role] = {
          name: item.name || '', serial: item.serial || '', manufacturer: item.manufacturer || '',
          calibrationDate: item.calibrationDate || '', capacity: item.capacity || '',
        };
      });
      return selected;
    }

    sheetLogRow(at, preferredPressure, comment = '', options = {}) {
      const timestamp = Number(at);
      const nearest = this.nearestPressureReading(timestamp);
      const hasPreferredPressure = preferredPressure !== null && preferredPressure !== undefined && preferredPressure !== '' && Number.isFinite(Number(preferredPressure));
      let pressure = hasPreferredPressure ? Number(preferredPressure) : NaN;
      const remarks = [comment];
      if (!Number.isFinite(pressure)) {
        if (nearest && Math.abs(Number(nearest.at) - timestamp) <= 30000) pressure = Number(nearest.pressure);
        else {
          pressure = null;
          remarks.push('Gauge reading unavailable for this time');
        }
      }
      // On a sync, temperatures that came from the Sheet are not sent back: the
      // Sheet already holds them, and resending would undo an operator's edit.
      const temperatureSource = options.skipSheetTemperatures ? this.temperatureReadings.filter((entry) => entry.source !== 'sheet') : undefined;
      const temperature = this.nearestTemperatureReading(timestamp, undefined, temperatureSource) || {};
      hostNotes
        .filter((note) => note.slot === this.slot && Math.abs(Number(note.at) - timestamp) <= 7.5 * 60 * 1000)
        .forEach((note) => remarks.push(note.text));
      (this.testState.events || [])
        .filter((event) => ['configuration', 'note'].includes(event.type) && Math.abs(Number(event.at) - timestamp) < 7.5 * 60 * 1000)
        .forEach((event) => remarks.push(event.label));
      // Temperatures go to the Sheet as whole degrees.
      const degrees = (value) => {
        const reading = window.HydroWorkflow.number(value);
        return reading === null ? '' : Math.round(reading);
      };
      return {
        at: timestamp,
        pressure: Number.isFinite(pressure) ? Math.round(pressure) : '',
        ambient: degrees(temperature.ambient),
        pipe: degrees(temperature.pipe),
        ground: degrees(temperature.soil),
        comments: [...new Set(remarks.filter(Boolean))].join(' / '),
      };
    }

    sheetRows(options = {}) {
      const events = this.testState.events || [];
      const startEvent = [...events].reverse().find((event) => event.type === 'official-start');
      const start = startEvent ? Number(startEvent.at) : this.testState.officialStart ? new Date(this.testState.officialStart).getTime() : 0;
      const endEvent = [...events].reverse().find((event) => event.type === 'official-end');
      let pre = events.filter((event) => ['ramp','note'].includes(event.type) && (!start || Number(event.at) < start)).sort((a,b) => a.at-b.at).map((event) => {
        const label = /^Begin pressurizing/i.test(event.label) ? 'Pressure is at 0 psi / Begin pressurizing' : event.label;
        return this.sheetLogRow(event.at, event.pressure, label, options);
      });

      const official = [];
      if (start && Date.now() >= start) {
        const times = window.HydroWorkflow.officialTimes({ officialStart: start, officialEnd: endEvent?.at || 0 }, Date.now());
        times.forEach((at, index, all) => {
          const comments = [];
          if (index === 0) comments.push('Begin test');
          if (endEvent && index === all.length - 1) comments.push('End test');
          official.push(this.sheetLogRow(at, null, comments.join(' / '), options));
        });
      }

      const post = endEvent ? hostNotes
        .filter((note) => note.slot === this.slot && Number(note.at) > Number(endEvent.at) + 7.5 * 60 * 1000)
        .sort((a, b) => Number(a.at) - Number(b.at))
        .map((note) => this.sheetLogRow(note.at, null, note.text, options)) : [];
      if (endEvent) events.filter(event => event.at > endEvent.at && ['workflow', 'note'].includes(event.type))
        .forEach(event => post.push(this.sheetLogRow(event.at, event.pressure, event.label, options)));
      post.sort((a, b) => a.at - b.at);
      return { preTestRows: pre, officialRows: official, postTestRows: post };
    }

    sheetColumnsOff() {
      const columns = this.testState.sheetColumns || {};
      return window.HydroWorkflow.SHEET_COLUMNS.filter((column) => columns[column] === false);
    }

    // The rows Sync to Sheet writes: without pre-test entries when they are switched off. That
    // needs a chosen start row, or the official test would start on row 23 over the typed entries.
    sheetRowsToSync(options = {}) {
      const rows = this.sheetRows(options);
      if (this.testState.sheetPreTest === false) {
        if (!Number(this.testState.sheetStartRow)) throw new Error('Pre-test entries are switched off: enter the LOG row the official test starts on, so the rows you typed above it are left alone.');
        rows.preTestRows = [];
      }
      return rows;
    }

    // The stroke count for the Test Stroke Count tab: the starting pressure and counter, then the
    // counter at each checkpoint. Null (tab left alone) when switched off or not started.
    sheetStrokes() {
      const workflow = this.testState.workflow;
      if (this.testState.sheetStrokes === false || !workflow?.baseline) return null;
      return {
        start: { pressure: workflow.baseline.pressure, counter: workflow.baseline.counter },
        entries: (workflow.strokes || []).map((row) => ({ pressure: row.target, counter: row.counter })),
        capacity: Number(workflow.baseline.capacity) || 0,
        step: Number(workflow.strokePlan?.step) || 10,
      };
    }

    sheetSnapshot(options = {}) {
      const rows = this.sheetRowsToSync(options);
      // Columns switched off are sent blank, and the Sheet script leaves those cells as they are.
      const off = this.sheetColumnsOff();
      if (off.length) Object.values(rows).forEach((list) => list.forEach((row) => off.forEach((column) => { row[column] = ''; })));
      window.HydroWorkflow.sheetCapacity(rows, this.testState.sheetStartRow);
      const testDateMs = this.testState.officialStart
        ? new Date(this.testState.officialStart).getTime()
        : Number(this.testState.sheet?.createdAt) || Date.now();
      return {
        slot: this.slot,
        job: {
          jobNumber: this.testState.jobNumber || '', poAfe: this.testState.poAfe || '', location: this.testState.location || '',
          owner: this.testState.owner || 'Atmos Energy', contractor: this.testState.contractor || 'Bobcat Contracting',
          ownerRep: this.testState.ownerRep || '', service: 'Gas',
        },
        design: clone(this.testState.design || {}),
        equipment: this.selectedEquipmentForSheet(),
        pressureOffset: this.pressureOffset(),
        sheetStartRow: Number(this.testState.sheetStartRow) || 0,
        sheetSkipColumns: this.sheetColumnsOff(),
        strokes: this.sheetStrokes(),
        syncDesign: this.testState.sheetDesign !== false,
        testDateMs,
        ...rows,
      };
    }

    importSheetTemperatures(rows) {
      if (!Array.isArray(rows)) return 0;
      const sheetTimes = new Set(rows.filter((row) => Number.isFinite(Number(row?.at)) && Number(row.at) > 0).map((row) => Number(row.at)));
      const preserved = this.temperatureReadings.filter((entry) => entry.source === 'live' || (entry.source !== 'sheet' && !sheetTimes.has(Number(entry.at))));
      const imported = rows
        .filter((row) => Number.isFinite(Number(row?.at)) && Number(row.at) > 0)
        .map((row) => {
          const entry = { at: Number(row.at), source: 'sheet' };
          if (row.ambient !== '' && Number.isFinite(Number(row.ambient))) entry.ambient = Number(row.ambient);
          if (row.pipe !== '' && Number.isFinite(Number(row.pipe))) entry.pipe = Number(row.pipe);
          if (row.soil !== '' && Number.isFinite(Number(row.soil))) entry.soil = Number(row.soil);
          return entry;
        })
        .filter((entry) => Number.isFinite(entry.ambient) || Number.isFinite(entry.pipe) || Number.isFinite(entry.soil));
      this.temperatureReadings = [...preserved, ...imported].sort((a, b) => Number(a.at) - Number(b.at));
      this.testState.manualTemperatures = this.normalizeManualTemperatures(this.temperatureReadings.filter((entry) => entry.source === 'manual' || entry.source === 'sheet'));
      this.renderManualTemperatures();
      this.drawTemperature();
      return imported.length;
    }

    async createGoogleSheet() {
      if (demo?.enabled) return this.renderSheetStatus('Demo mode cannot create or sync Google Sheets.', 'error');
      if (this.sheetSyncInFlight) return;
      if (this.testState.sheet?.spreadsheetId && !window.confirm('Create a new replacement Sheet for this test? The current Sheet will remain in Google Drive.')) return;
      const opened = window.open('about:blank', '_blank');
      this.sheetSyncInFlight = true;
      this.renderSheetStatus('Copying the master workbook and filling the current test setup…', 'working');
      try {
        const createdAt = Date.now();
        const snapshot = this.sheetSnapshot();
        snapshot.testDateMs = this.testState.officialStart ? new Date(this.testState.officialStart).getTime() : createdAt;
        const result = await api('sheet_create', { title: this.sheetTitle(), snapshot }, true);
        const importedTemperatures = this.importSheetTemperatures(result.temperatureReadings);
        this.testState.sheet = {
          spreadsheetId: result.spreadsheetId, url: result.url, title: result.title,
          createdAt, lastSyncedAt: result.updatedAt || new Date().toISOString(), finalized: false, scriptVersion: Number(result.layoutVersion) || 1,
        };
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        if (!(result.layoutVersion >= 3)) this.renderSheetStatus(`Created ${result.title}, but the Google Sheet script is out of date. Paste the new Code.gs into Apps Script and deploy a new version (see SETUP.md).`, 'error');
        else this.renderSheetStatus(`Created ${result.title}. Future Sheet updates are manual-only; press Sync to Sheet when ready.${importedTemperatures ? ` Imported ${importedTemperatures} temperature row${importedTemperatures === 1 ? '' : 's'}.` : ''}`, 'complete');
        if (opened) opened.location.href = result.url;
      } catch (error) {
        if (opened) opened.close();
        this.renderSheetStatus(error?.message || 'Google Sheet creation failed.', 'error');
      } finally {
        this.sheetSyncInFlight = false;
        this.renderSheetStatus(this.root.querySelector('.sheet-sync-message').textContent, this.root.querySelector('.paperwork-sync-panel').classList.contains('sync-error') ? 'error' : '');
      }
    }

    async syncGoogleSheet() {
      if (demo?.enabled) return this.renderSheetStatus('Demo mode cannot create or sync Google Sheets.', 'error');
      if (!this.testState.sheet?.spreadsheetId || this.sheetSyncInFlight) return;
      try { this.sheetRowsToSync(); } catch (error) { return this.renderSheetStatus(error.message, 'error'); }
      const startRow = Number(this.testState.sheetStartRow) || 0;
      const where = startRow ? (this.testState.sheetPreTest === false ? `from LOG row ${startRow} down (rows above it are left as they are)` : `from LOG row ${startRow} down (rows above it are only used for pre-test entries)`) : 'from LOG row 23 down';
      const off = this.sheetColumnsOff();
      const kept = off.length ? ` Columns switched off (${off.join(', ')}) are left as they are.` : '';
      if (!window.confirm(`Sync to Google Sheet now? This will rewrite times, pressures and comments ${where}.${kept} Temperatures typed in columns C–E stay with their time unless the site has a reading. Continue?`)) return;
      // An older Sheet script would blank a switched-off pressure or remarks column.
      if (off.some((column) => column === 'pressure' || column === 'comments') && !(Number(this.testState.sheet.scriptVersion) >= 3)
        && !window.confirm('Switching off the pressure or remarks column needs the updated Google Sheet script (Code.gs). If it has not been deployed yet, press Cancel, or that column will be cleared. Continue?')) return;
      this.sheetSyncInFlight = true;
      this.renderSheetStatus('Writing the current test values to Google Sheet…', 'working');
      try {
        const snapshot = this.sheetSnapshot({ skipSheetTemperatures: true });
        const result = await api('sheet_sync', {
          spreadsheet_id: this.testState.sheet.spreadsheetId,
          finalized: false,
          snapshot,
        }, true);
        const importedTemperatures = this.importSheetTemperatures(result.temperatureReadings);
        this.testState.sheet = {
          ...this.testState.sheet, url: result.url || this.testState.sheet.url, title: result.title || this.testState.sheet.title,
          lastSyncedAt: result.updatedAt || new Date().toISOString(), finalized: false, scriptVersion: Number(result.layoutVersion) || 1,
        };
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        if (!(result.layoutVersion >= 3)) {
          this.renderSheetStatus('Synced, but the Google Sheet script is out of date, so the start row and column switches may have been ignored. Paste the new Code.gs into Apps Script and deploy a new version (see SETUP.md).', 'error');
          return;
        }
        const rows = result.officialFirstRow ? ` on ${result.officialFirstRow === result.officialLastRow ? `LOG row ${result.officialFirstRow}` : `LOG rows ${result.officialFirstRow}–${result.officialLastRow}`}` : '';
        const noStart = !result.officialRowsWritten && !this.sheetRows().officialRows.length
          ? ' No official start time is saved yet, so there are no 15-minute rows. Enter the start under Test times for paperwork, press Save test times, then sync again.' : '';
        if (!(result.layoutVersion >= 6)) {
          this.renderSheetStatus('Synced, but the Google Sheet script is out of date: it may have erased design values typed into the Sheet, and the Pipeline Data, stroke count or design switch may have been ignored. Paste the new Code.gs into Apps Script (keep your own HYDRO_TEMPLATE_ID line) and deploy a new version (see SETUP.md).', 'error');
          return;
        }
        const strokeNote = result.strokeRowsWritten ? ` Wrote ${result.strokeRowsWritten - 1} stroke reading${result.strokeRowsWritten === 2 ? '' : 's'} to the Test Stroke Count tab.` : '';
        const message = `Synced ${result.officialRowsWritten || 0} official row${result.officialRowsWritten === 1 ? '' : 's'}${rows} using the ${this.pressureOffset()} psi offset.${strokeNote} Imported ${importedTemperatures} temperature row${importedTemperatures === 1 ? '' : 's'} from the Sheet.${noStart || ' Manual-only mode remains on.'}`;
        this.renderSheetStatus(message, 'complete');
      } catch (error) {
        this.renderSheetStatus(`${error?.message || 'Google Sheet synchronization failed.'} The local recording is still safe.`, 'error');
      } finally {
        this.sheetSyncInFlight = false;
        this.renderSheetStatus(this.root.querySelector('.sheet-sync-message').textContent, this.root.querySelector('.paperwork-sync-panel').classList.contains('sync-error') ? 'error' : '');
      }
    }

    saveTestState() {
      if (!this.checkJobCurrent()) return;
      localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
      const status = this.root.querySelector('.test-save-status');
      status.textContent = demo?.enabled ? 'Practice tab only · not saved' : `Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      if (!demo?.enabled) window.HydroCloud?.schedule();
    }

    checkJobCurrent() {
      const stored = JSON.parse(localStorage.getItem(`${testStoragePrefix}${this.slot}`) || 'null');
      if (stored && (stored.jobId || '') !== (this.testState.jobId || '')) {
        this.obsoleteJob = true;
        this.root.inert = true;
        if (this.connected()) this.disconnect();
        this.showError('A different job was opened in another tab. Refresh this page before using this test slot.');
        return false;
      }
      return !this.obsoleteJob;
    }

    async startNewJob() {
      if (navigator.locks && !demo?.enabled) {
        return navigator.locks.request(`grantg-new-job-${this.slot}`, { ifAvailable: true }, lock => {
          if (!lock) { this.workflowController.message('Another tab is already starting this test. Wait for it to finish.'); return; }
          return this.startNewJobLocked();
        });
      }
      return this.startNewJobLocked();
    }

    async startNewJobLocked() {
      if (this.jobTransition) return;
      this.jobTransition = true;
      let committed = false;
      try {
        if (!this.checkJobCurrent()) return;
        if (this.connected() || this.reconnectWanted) throw new Error('Disconnect this test’s pressure gauge first. The other test can keep recording.');
        if (this.sheetSyncInFlight || this.temperatureControlInFlight || this.restoringBackup || this.importingDesign) throw new Error('Wait for this test’s current save or connection operation to finish.');
        if (!window.confirm(`Start a new job in ${testNameForSlot(this.slot)}? Readings, notes, workflow, offset and Sheet link will start fresh. Equipment defaults stay saved. The other test is not reset.`)) return;
        this.root.inert = true;
        this.workflowController.message('Checking recordings and saving the previous job…');
        await this.readingsReady;
        const storedPressure = readingStore ? await readingStore.load(window.HydroJobs.pressureKey(this.testState), true) : [];
        const archivePressure = [...new Map([...storedPressure, ...this.readings].map(r => [Number(r.at), r])).values()].sort((a, b) => a.at - b.at);
        const session = remote ? { ...remote } : null;
        if (session && !demo?.enabled) {
          const result = await temperatureApi('list_devices', {}, true);
          if (!Array.isArray(result.devices)) throw new Error('Could not verify logger status. Reconnect to the website and try again.');
          const busy = (result.devices || []).find(d => d.session_id === session.session_id && d.slot === this.slot);
          if (busy) throw new Error('Open Temperatures and press Stop recording temps for this test, then start the new job.');
        }
        const temperatures = new Map(this.temperatureReadings.map(r => [`${r.source || ''}:${r.sourceId || ''}:${r.at}`, r]));
        // Fetch the entire completed temperature log, not just the host’s currently loaded pages.
        if (session && !demo?.enabled) {
          let cursor = 0, more;
          do {
            const result = await temperatureApi('view', { session_id: session.session_id, publish_token: session.publish_token, since_id: cursor });
            if (result.ok === false || !Array.isArray(result.readings)) throw new Error('Could not verify the complete temperature archive. Retry when the website is available.');
            for (const row of result.readings) if (row.slot === this.slot && window.HydroJobs.acceptsTemperature(this.testState, row)) {
              const r = { at: Number(row.at), source: 'live', sourceId: row.source_id };
              for (const key of ['ambient', 'pipe', 'soil', 'aux']) if (row[key] !== null && row[key] !== '' && Number.isFinite(Number(row[key]))) r[key] = Number(row[key]);
              temperatures.set(`live:${r.sourceId || ''}:${r.at}`, r);
            }
            more = result.has_more === true;
            const next = Number(result.last_id) || cursor;
            if (more && next <= cursor) throw new Error('Temperature archive did not finish loading. The current test was not reset.');
            cursor = next;
          } while (more);
        }
        if (!this.checkJobCurrent()) return;
        const at = Date.now(), id = crypto.randomUUID();
        const archive = { id: this.testState.cloudJobId || crypto.randomUUID(), format: 'grantg-hydrotest-backup', version: 1, archivedAt: at, exportedAt: new Date(at).toISOString(),
          test: clone(this.testState), equipment: clone(equipmentInventory), readings: clone(archivePressure),
          temperatureReadings: [...temperatures.values()].sort((a, b) => a.at - b.at),
          notes: clone(hostNotes.filter(n => n.slot === this.slot)), remoteSessionId: session?.session_id || null };
        await window.HydroJobs.save(archive, demo?.enabled);
        if (!demo?.enabled) window.HydroCloud?.schedule();
        if (!this.checkJobCurrent()) return;
        const next = { ...defaultTestState(this.slot), jobId: id, jobStartedAt: at, temperatureSourceIds: [],
          equipment: clone(this.testState.equipment), chartMax: this.testState.chartMax, traceThickness: this.testState.traceThickness };
        // Commit the new pointer only after the archive transaction succeeds. Old pressure storage is retained.
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(next));
        committed = true;
        this.testState = next;
        this.readings = []; this.temperatureReadings = []; this.peak = null; this.low = null;
        this.pendingDesign = null; this.buffer = ''; this.staleAlerted = false;
        hostNotes = hostNotes.filter(n => n.slot !== this.slot);
        saveHostNotes();
        this.root.querySelector('.test-design-review').classList.add('hidden');
        this.root.querySelector('.test-design-status').textContent = 'No test design has been selected.';
        this.restoreTestSetup();
        this.root.querySelector('.temp-history-range').value = 'all';
        this.temperaturePanel._temperatureSelection = { followLive: true, at: null };
        this.temperaturePanel._temperatureZoom = null;
        this.applyEquipmentOptions();
        this.updateUi(); this.draw(); this.drawTemperature();
        this.workflowController.hydrate(); this.workflowController.render(true);
        this.workflowController.renderJobs();
        this.workflowController.message('New test ready. Previous job saved to Test history (backup copy under Records → Local backup copies). Press Start recording temps when ready.');
        // Each slot’s source allow-list excludes yesterday even when a delayed poll returns or after reload.
        if (remote) { remote.last_published_at = { ...(remote.last_published_at || {}), [this.slot]: 0 }; saveRemoteSession(); queueMicrotask(() => publish()); }
      } catch (error) {
        this.workflowController.message(committed ? `Previous job is archived and the new job is saved. Refresh to reload its display: ${error.message || String(error)}` : `New test not started: ${error.message || String(error)}`);
      } finally {
        this.jobTransition = false;
        if (!this.obsoleteJob) this.root.inert = false;
      }
    }

    applyEquipmentOptions() {
      this.root.querySelectorAll('.equipment-select').forEach((select) => {
        const role = select.dataset.equipmentRole;
        const matches = equipmentInventory.filter((item) => item.type === role);
        const selected = this.testState.equipment[role];
        select.replaceChildren();
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = matches.length ? 'Select equipment' : 'No equipment added';
        select.appendChild(blank);
        matches.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.id;
          option.textContent = [item.name, item.serial ? `S/N ${item.serial}` : '', item.range].filter(Boolean).join(' • ');
          select.appendChild(option);
        });
        const fallback = matches.find((item) => item.isDefault)?.id || '';
        select.value = matches.some((item) => item.id === selected) ? selected : fallback;
        this.testState.equipment[role] = select.value;
      });
      this.saveTestState();
      this.renderCalibrationSummary();
    }

    renderCalibrationSummary() {
      const summary = this.root.querySelector('.calibration-summary');
      if (!summary) return;
      const selected = Object.entries(this.testState.equipment)
        .map(([role, id]) => ({ role, item: equipmentInventory.find((entry) => entry.id === id) }))
        .filter(({ role, item }) => item && role !== 'pump');
      if (!selected.length) {
        summary.innerHTML = '<span class="calibration-chip due">Select test equipment to check calibration dates</span>';
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      summary.replaceChildren(...selected.map(({ item }) => {
        const chip = document.createElement('span');
        chip.className = 'calibration-chip';
        const label = item.serial ? `S/N ${item.serial}` : item.name;
        if (!item.calibrationDate) {
          chip.classList.add('due');
          chip.textContent = `${label}: calibration date needed`;
          return chip;
        }
        const expires = new Date(`${item.calibrationDate}T12:00:00`);
        expires.setMonth(expires.getMonth() + (Number(item.intervalMonths) || 6));
        const days = Math.ceil((expires - today) / 86400000);
        if (days < 0) chip.classList.add('expired');
        else if (days <= 30) chip.classList.add('due');
        chip.textContent = days < 0 ? `${label}: expired ${expires.toLocaleDateString()}` : `${label}: calibrated through ${expires.toLocaleDateString()}`;
        return chip;
      }));
    }

    rampSteps() {
      return window.HydroWorkflow.steps(this.testState.rampProfile);
    }

    latestPressure() {
      const latest = this.readings.at(-1);
      return latest ? Number(latest.pressure) : null;
    }

    officialTestIsActive() {
      const start = this.testState.officialStart ? new Date(this.testState.officialStart).getTime() : 0;
      const end = this.testState.officialEnd ? new Date(this.testState.officialEnd).getTime() : 0;
      const endedByOperator = [...this.testState.events].reverse().find((event) => event.type === 'official-end');
      return Boolean(start && Date.now() >= start && !endedByOperator);
    }

    reapplyPressureOffset(previousOffset, nextOffset) {
      const previous = Number(previousOffset) || 0;
      const next = Number(nextOffset) || 0;
      const delta = next - previous;
      if (!Number.isFinite(delta) || delta === 0) return;
      const archivedThrough = Number(this.testState.workflow?.archives?.at(-1)?.endedAt) || 0;
      this.readings = this.readings.map((reading) => {
        if (archivedThrough && reading.at <= archivedThrough) return reading;
        const previousRecorded = Number(reading.pressure);
        const rawPressure = previousRecorded - previous;
        const isZeroBaseline = Math.abs(previousRecorded) <= .5 || Math.abs(rawPressure) <= .5;
        return { ...reading, pressure: isZeroBaseline ? previousRecorded : previousRecorded + delta };
      });
      this.testState.events = this.testState.events.map((event) => {
        const fixedZero = event.type === 'ramp' && /^Begin pressurizing/i.test(event.label);
        return Number.isFinite(Number(event.pressure)) && !fixedZero ? { ...event, pressure: Number(event.pressure) + delta } : event;
      });
      this.peak = this.readings.length ? this.readings.reduce((maximum, reading) => Math.max(maximum, Number(reading.pressure)), -Infinity) : null;
      this.low = this.readings.length ? this.readings.reduce((minimum, reading) => Math.min(minimum, Number(reading.pressure)), Infinity) : null;
      if (readingStore) {
        const key = window.HydroJobs.pressureKey(this.testState);
        readingStore.clear(key).then(() => this.readings.forEach((reading) => readingStore.add(key, reading)));
      }
      this.updateUi();
      this.draw();
      this.renderTestEvents();
      window.dispatchEvent(new CustomEvent('grantg-pressure-recalibrated', { detail: { slot: this.slot } }));
    }

    recordRampStep() {
      const recordedSteps = this.testState.events.filter((event) => event.type === 'ramp').length;
      const step = this.rampSteps()[recordedSteps];
      if (step === undefined) return;
      const pressure = step === 0 ? 0 : this.latestPressure();
      if (step !== 0 && pressure === null) {
        this.showError('Connect the gauge before recording this pressurization checkpoint.');
        return;
      }
      const label = step === 0 ? 'Begin pressurizing' : step === 100 ? 'Full pressure reached' : `${step}% pressure checkpoint`;
      this.addTestEvent('ramp', label, pressure);
    }

    startOfficialTest() {
      const pressure = this.latestPressure();
      if (pressure === null) {
        this.showError('Connect the gauge before starting the official test.');
        return;
      }
      if (this.testState.officialStart && !window.confirm('Replace the existing official test start time?')) return;
      const now = new Date();
      const durationHours = Number(this.testState.design?.testDurationHours) || 8;
      const expectedEnd = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
      this.testState.officialStart = dateTimeInputValue(now);
      this.testState.officialEnd = dateTimeInputValue(expectedEnd);
      this.root.querySelector('.test-start').value = this.testState.officialStart;
      this.root.querySelector('.test-end').value = this.testState.officialEnd;
      this.addTestEvent('official-start', `Begin ${durationHours} hour test`, pressure, now.getTime());
      this.draw();
    }

    endOfficialTest() {
      const pressure = this.latestPressure();
      if (!this.testState.officialStart) {
        this.showError('Start the official test before recording its end.');
        return;
      }
      if (pressure === null) {
        this.showError('No gauge reading is available for the ending pressure.');
        return;
      }
      const now = new Date();
      const durationHours = Number(this.testState.design?.testDurationHours) || 8;
      this.testState.officialEnd = dateTimeInputValue(now);
      this.root.querySelector('.test-end').value = this.testState.officialEnd;
      this.addTestEvent('official-end', `End ${durationHours} hour test`, pressure, now.getTime());
      this.draw();
    }

    addTestEvent(type, label, pressure, at = Date.now()) {
      this.testState.events.push({ id: `${at}-${Math.random().toString(36).slice(2)}`, type, label, pressure, at });
      this.saveTestState();
      this.renderTestEvents();
    }

    nearestPressureReading(at) {
      if (!this.readings.length) return null;
      let low = 0;
      let high = this.readings.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.readings[middle].at < at) low = middle + 1;
        else high = middle;
      }
      const after = this.readings[low];
      const before = this.readings[Math.max(0, low - 1)];
      return Math.abs(Number(before.at) - at) <= Math.abs(Number(after.at) - at) ? before : after;
    }

    nearestTemperatureReading(at, maximumGap = 7.5 * 60 * 1000, readings = this.temperatureReadings) {
      const reading = window.TemperatureChartRenderer.nearest(readings, Number(at));
      const allowedGap = reading?.source === 'live' ? Math.max(30000, (this.temperatureRecordingOptions().sampleIntervalSeconds + 5) * 1000) : maximumGap;
      return reading && Math.abs(Number(reading.at) - Number(at)) <= allowedGap ? reading : null;
    }

    downloadAtmosLog(anchor) {
      if (demo?.enabled) return this.showActionError(anchor, 'Demo records are for practice only; exports are disabled.');
      const startEvent = [...this.testState.events].reverse().find((event) => event.type === 'official-start');
      const endEvent = [...this.testState.events].reverse().find((event) => event.type === 'official-end');
      const start = startEvent ? Number(startEvent.at) : this.testState.officialStart ? new Date(this.testState.officialStart).getTime() : 0;
      const end = endEvent ? Number(endEvent.at) : this.testState.officialEnd ? new Date(this.testState.officialEnd).getTime() : 0;
      const endedByOperator = this.testState.events.some((event) => event.type === 'official-end');
      if (!start || !end || end <= start || !endedByOperator) {
        this.showActionError(anchor, 'Enter and save the actual test start and end under Records before downloading the Atmos log rows.');
        return;
      }
      const rowFor = (at, pressure, comment) => {
        const temperature = this.nearestTemperatureReading(at) || {};
        const nearbyNotes = hostNotes.filter((note) => note.slot === this.slot && Math.abs(Number(note.at) - at) <= 7.5 * 60 * 1000).map((note) => note.text);
        const remarks = [comment, ...nearbyNotes].filter(Boolean).join(' / ');
        return [new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), window.HydroWorkflow.number(pressure) === null ? '' : Math.round(Number(pressure)), temperature.ambient ?? '', temperature.pipe ?? '', temperature.soil ?? '', remarks];
      };
      const rows = [];
      this.testState.events.filter((event) => ['ramp', 'note'].includes(event.type) && event.at < start).sort((a,b) => a.at-b.at).forEach((event) => rows.push(rowFor(event.at, event.pressure, event.label)));
      const sampleTimes = [];
      for (let at = start; at < end; at += 15 * 60 * 1000) sampleTimes.push(at);
      if (!sampleTimes.length || sampleTimes.at(-1) !== end) sampleTimes.push(end);
      const missingTimes = [];
      sampleTimes.forEach((at, index) => {
        const reading = this.nearestPressureReading(at);
        if (!reading || Math.abs(Number(reading.at) - at) > 30000) {
          missingTimes.push(new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
          return;
        }
        const comment = index === 0 ? 'Begin test' : at === end ? 'End test' : '';
        rows.push(rowFor(at, reading.pressure, comment));
      });
      if (missingTimes.length) {
        this.showActionError(anchor, `No gauge reading was found within 30 seconds of ${missingTimes.slice(0, 4).join(', ')}${missingTimes.length > 4 ? ` and ${missingTimes.length - 4} more time${missingTimes.length - 4 === 1 ? '' : 's'}` : ''}. The log was not exported.`);
        return;
      }
      if (rows.length > 38) {
        this.showActionError(anchor, `This test needs ${rows.length} log rows, but the locked Atmos form has 38. No rows were omitted.`);
        return;
      }
      const content = [['Time', 'Pressure', 'Ambient', 'Pipe', 'Ground', 'Comments / Remarks'], ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const name = (this.testState.jobNumber || this.settings().name || testNameForSlot(this.slot)).replace(/[^a-z0-9]+/gi, '_');
      link.href = url;
      link.download = `${name}_Atmos_LOG_rows.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showActionError(anchor, '');
    }

    downloadTestBackup(anchor) {
      if (demo?.enabled) return this.showActionError(anchor, 'Demo records cannot be exported as a real test backup.');
      const selectedEquipment = Object.values(this.testState.equipment)
        .map((id) => equipmentInventory.find((item) => item.id === id))
        .filter(Boolean);
      const payload = {
        format: 'grantg-hydrotest-backup', version: 1, exportedAt: new Date().toISOString(),
        test: this.testState, equipment: selectedEquipment, readings: this.readings, temperatureReadings: this.temperatureReadings,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const name = (this.testState.jobNumber || this.settings().name || testNameForSlot(this.slot)).replace(/[^a-z0-9]+/gi, '_');
      link.href = url;
      link.download = `${name}_${new Date().toISOString().slice(0, 10)}_backup.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async restoreTestBackup(file, anchor) {
      if (demo?.enabled) return this.showActionError(anchor, 'Backup imports are disabled in demo mode.');
      if (this.jobTransition || this.connected()) return this.showActionError(anchor, 'Finish the current operation and disconnect the gauge before restoring.');
      if (!file) return;
      this.restoringBackup = true;
      try {
        const payload = JSON.parse(await file.text());
        if (payload?.format !== 'grantg-hydrotest-backup' || !payload.test || !Array.isArray(payload.readings)) throw new Error('That file is not a Hydrotest Field Console backup.');
        (payload.equipment || []).forEach((item) => {
          if (item?.id && !equipmentInventory.some((entry) => entry.id === item.id)) equipmentInventory.push(item);
        });
        saveEquipmentInventory();
        this.testState = { ...defaultTestState(this.slot), ...payload.test, cloudJobId: crypto.randomUUID(), jobId: crypto.randomUUID(), temperatureSourceIds: [], slot: this.slot, equipment: { ...(payload.test.equipment || {}) }, events: Array.isArray(payload.test.events) ? payload.test.events : [] };
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        this.readings = payload.readings.filter((reading) => Number.isFinite(Number(reading?.at)) && Number.isFinite(Number(reading?.pressure))).map((reading) => ({ at: Number(reading.at), pressure: Number(reading.pressure), unit: String(reading.unit || 'PSI') })).sort((a, b) => a.at - b.at).slice(-500000);
        this.temperatureReadings = Array.isArray(payload.temperatureReadings) ? payload.temperatureReadings : [];
        this.testState.manualTemperatures = this.normalizeManualTemperatures(this.testState.manualTemperatures?.length ? this.testState.manualTemperatures : this.temperatureReadings.filter((entry) => entry?.source === 'manual' || entry?.source === 'sheet'));
        this.peak = this.readings.length ? this.readings.reduce((maximum, reading) => Math.max(maximum, reading.pressure), -Infinity) : null;
        this.low = this.readings.length ? this.readings.reduce((minimum, reading) => Math.min(minimum, reading.pressure), Infinity) : null;
        if (readingStore) {
          const key = window.HydroJobs.pressureKey(this.testState);
          this.readings.forEach((reading) => readingStore.add(key, reading));
        }
        this.restoreTestSetup();
        renderEquipmentLibrary();
        this.updateUi();
        this.draw();
        this.showActionError(anchor, '');
      } catch (error) {
        this.showActionError(anchor, error.message || String(error));
      } finally {
        this.restoringBackup = false;
        this.root.querySelector('.restore-test-backup').value = '';
      }
    }

    renderTestEvents() {
      const body = this.root.querySelector('.test-event-table tbody');
      if (!body) return;
      const events = this.testState.events || [];
      if (!events.length) body.innerHTML = '<tr><td colspan="3" class="event-empty">No entries yet. Add checkpoints or notes from Live test whenever you have time.</td></tr>';
      else body.innerHTML = [...events].sort((a,b) => a.at-b.at).map((event) => `<tr><td>${new Date(event.at).toLocaleString()}</td><td>${escapeHtml(event.label)}${event.shared ? ' <span class="shared-tag">Shown to viewers</span>' : ''}</td><td>${event.pressure !== null && Number.isFinite(Number(event.pressure)) ? `${Number(event.pressure).toFixed(1)} psi` : '—'}</td></tr>`).join('');

    }

    async restoreStoredReadings() {
      if (!readingStore) return;
      const state = this.testState;
      const stored = await readingStore.load(window.HydroJobs.pressureKey(state));
      if (state !== this.testState) return;
      if (!stored.length) return;
      const byTime = new Map([...stored, ...this.readings].map((reading) => [Number(reading.at), reading]));
      this.readings = [...byTime.values()].sort((a, b) => a.at - b.at).slice(-500000);
      this.peak = this.readings.reduce((maximum, reading) => Math.max(maximum, Number(reading.pressure)), -Infinity);
      this.low = this.readings.reduce((minimum, reading) => Math.min(minimum, Number(reading.pressure)), Infinity);
      this.updateUi();
      this.draw();
    }

    checkStale() {
      if (!this.active || !this.connected()) return;
      const latestAt = Number(this.readings.at(-1)?.at) || this.connectedAt;
      const staleFor = Date.now() - latestAt;
      const status = this.root.querySelector('.connection-status');
      if (staleFor >= 30000) {
        status.classList.add('stale');
        status.innerHTML = `<i></i> No update for ${Math.floor(staleFor / 1000)} sec`;
        if (!this.staleAlerted) {
          this.staleAlerted = true;
          staleDing();
        }
      } else if (this.staleAlerted) {
        this.staleAlerted = false;
        this.setConnection('Connected • receiving readings', true);
      }
    }

    publishBatch(afterTimestamp, limit = 2000) {
      let low = 0;
      let high = this.readings.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.readings[middle].at <= afterTimestamp) low = middle + 1;
        else high = middle;
      }
      const readings = (this.active ? this.readings.slice(low, low + limit) : []).map((reading) => ({
        at: reading.at,
        pressure: reading.pressure,
        unit: reading.unit,
      }));
      return { slot: this.slot, readings, config: this.settings() };
    }

    setActive(active) {
      this.active = Boolean(active);
      this.root.classList.toggle('inactive-test', !this.active);
    }

    async connect() {
      if (demo?.enabled) return this.showError('Use the demo pressure slider. Real gauges are disabled in practice.');
      if (!('serial' in navigator)) {
        this.showError('USB serial requires desktop Chrome or Microsoft Edge.');
        return;
      }
      this.showError('');
      this.cancelReconnect();
      this.setConnection('Choose the gauge…', false);
      let port;
      try {
        port = await navigator.serial.requestPort();
      } catch (error) {
        if (error && error.name === 'NotFoundError') {
          this.setConnection('No gauge selected', false);
          return;
        }
        this.showError(error.message || String(error));
        this.setConnection('Could not connect', false);
        return;
      }
      if (gauges.some((gauge) => gauge !== this && gauge.port === port)) {
        this.showError('That gauge is already connected to the other test.');
        this.setConnection('Not connected', false);
        return;
      }
      await this.openPort(port);
    }

    async openPort(port, automatic = false) {
      try {
        await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      } catch (error) {
        if (!automatic) {
          this.showError(error.message || String(error));
          this.setConnection('Could not connect', false);
        }
        return false;
      }
      this.port = port;
      this.portInfo = port.getInfo?.() || {};
      rememberGaugePort(this.slot, this.portInfo);
      this.cancelReconnect();
      this.keepReading = true;
      this.connectedAt = Date.now();
      this.staleAlerted = false;
      this.buffer = '';
      this.setConnection(automatic ? 'Reconnected • receiving readings' : 'Connected • receiving readings', true);
      this.readLoop();
      screenAwake.update();
      await new Promise((resolve) => setTimeout(resolve, 180));
      await this.query().catch(() => {});
      // Ticks come from a worker so a minimized window still asks every second.
      gaugeTicker.add(this.queryTick);
      return true;
    }

    // The cable was pulled or Windows dropped the USB device. Recording stops
    // (the gap stays blank) and the same gauge is reopened as soon as it returns.
    async handleLost() {
      gaugeTicker.remove(this.queryTick);
      this.keepReading = false;
      const port = this.port;
      this.port = null;
      this.reader = null;
      this.connectedAt = 0;
      try { await port?.close(); } catch (_) {}
      const lostAt = new Date().toLocaleTimeString();
      this.setConnection('Gauge disconnected • reconnecting automatically…', false);
      this.root.querySelector('.connection-status').classList.add('stale');
      this.root.querySelector('.connect-button').textContent = 'Stop reconnecting';
      this.showError(`The USB connection to the gauge dropped at ${lostAt}. It will reconnect automatically when the gauge is available again; check the cable if this does not clear. Nothing is recorded while it is disconnected.`);
      staleDing();
      this.startReconnect();
    }

    startReconnect() {
      this.reconnectWanted = true;
      if (!this.reconnectTimer) this.reconnectTimer = setInterval(() => this.tryReconnect(), 3000);
      screenAwake.update();
      this.tryReconnect();
    }

    cancelReconnect() {
      this.reconnectWanted = false;
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    async tryReconnect(afterReload = false) {
      if ((!this.reconnectWanted && !afterReload) || this.port || this.reconnecting || !this.active || demo?.enabled) return;
      this.reconnecting = true;
      try {
        const port = await findGaugePort(this);
        if (port && await this.openPort(port, true)) {
          const notice = afterReload ? '' : `Gauge reconnected automatically at ${new Date().toLocaleTimeString()}. Readings resumed; the gap stays blank in the record.`;
          this.showError(notice);
          // The reconnect notice is informational: clear it after a minute unless something newer replaced it.
          clearTimeout(this.reconnectNoticeTimer);
          if (notice) this.reconnectNoticeTimer = setTimeout(() => {
            if (this.root.querySelector('.gauge-error').textContent === notice) this.showError('');
          }, this.reconnectNoticeMs ?? 60000);
        }
      } finally {
        this.reconnecting = false;
      }
    }

    async query() {
      if (!this.port || !this.port.writable) return;
      const writer = this.port.writable.getWriter();
      try { await writer.write(encoder.encode('?PRE\r')); }
      finally { writer.releaseLock(); }
    }

    async readLoop() {
      const port = this.port;
      while (this.port === port && port.readable && this.keepReading) {
        const reader = this.port.readable.getReader();
        this.reader = reader;
        try {
          while (this.keepReading) {
            const result = await reader.read();
            if (result.done) break;
            if (result.value) this.consume(this.decoder.decode(result.value, { stream: true }));
          }
        } catch (error) {
          if (this.keepReading) this.showError(error.message || String(error));
        } finally {
          reader.releaseLock();
          this.reader = null;
        }
      }
      if (this.port === port && this.keepReading) this.handleLost();
    }

    consume(text) {
      this.buffer += text;
      const lines = this.buffer.split(/\r\n|\n|\r/);
      this.buffer = lines.pop() || '';
      lines.forEach((line) => this.parse(line));
    }

    parse(raw) {
      const line = raw.trim();
      if (!line) return;
      const match = line.match(/(?:^|[^0-9+\-.])([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([A-Za-z][A-Za-z0-9/²^.-]*)/);
      if (!match) return;
      const pressure = Number(match[1]);
      if (!Number.isFinite(pressure)) return;
      const unit = match[2].toUpperCase();
      this.checkUnit(unit);
      this.add({ at: Date.now(), pressure: this.recordedPressure(pressure), unit });
    }

    // Readings are recorded as reported; a non-PSI unit is flagged, never converted.
    checkUnit(unit) {
      const warning = /^PSIG?$/.test(unit) ? '' : `The gauge is reporting ${unit}, not PSI. Set the gauge to PSI. Readings are recorded exactly as the gauge reports them and are not converted.`;
      if (warning === this.unitWarning) return;
      if (warning) staleDing();
      if (warning || this.root.querySelector('.gauge-error').textContent === this.unitWarning) this.showError(warning);
      this.unitWarning = warning;
    }

    add(reading) {
      if (this.jobTransition || !this.checkJobCurrent()) return;
      this.readings.push(reading);
      if (this.readings.length > 500000) this.readings.splice(0, this.readings.length - 500000);
      if (readingStore) readingStore.add(window.HydroJobs.pressureKey(this.testState), reading);
      this.staleAlerted = false;
      this.root.querySelector('.connection-status').classList.remove('stale');
      this.peak = this.peak === null ? reading.pressure : Math.max(this.peak, reading.pressure);
      this.low = this.low === null ? reading.pressure : Math.min(this.low, reading.pressure);
      this.updateUi();
      this.draw();
    }

    updateUi() {
      const latest = this.readings.at(-1);
      const displayedLow = this.low;
      this.root.querySelector('.current-pressure').textContent = latest ? latest.pressure.toFixed(1) : '---.-';
      this.root.querySelector('.current-pressure').classList.toggle('waiting', !latest);
      this.root.querySelector('.current-unit').textContent = latest ? latest.unit : 'PSI';
      const trend = this.root.querySelector('.pressure-trend');
      if (trend) trend.textContent = this.trendText();
      this.updateRate();
      this.root.querySelector('.stat-last').textContent = latest ? new Date(latest.at).toLocaleTimeString() : 'No readings';
      this.root.querySelector('.stat-peak').textContent = this.peak === null ? '—' : `${this.peak.toFixed(1)} psi`;
      this.root.querySelector('.stat-low').textContent = displayedLow === null ? '—' : `${displayedLow.toFixed(1)} psi`;
      this.root.querySelector('.stat-count').textContent = this.readings.length.toLocaleString();
      this.updateWarning();
    }

    // Net change over the last five minutes, so a slow drift of a few tenths is visible at a glance.
    trendText() {
      const latest = this.readings.at(-1);
      if (!latest) return '';
      const from = latest.at - 5 * 60000;
      let low = 0, high = this.readings.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.readings[middle].at < from) low = middle + 1;
        else high = middle;
      }
      const first = this.readings[low];
      const minutes = (latest.at - first.at) / 60000;
      if (minutes < 0.5) return '';
      const span = minutes >= 4.5 ? '5 min' : `${Math.max(1, Math.round(minutes))} min`;
      const delta = latest.pressure - first.pressure;
      if (Math.abs(delta) < 0.05) return `Steady over ${span}`;
      return `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} psi in ${span}`;
    }

    // Pressure-up pacing against the operator's maximum rate (psi per minute),
    // measured over the last 30 seconds so a pump adjustment shows quickly.
    rateTarget() {
      const value = Number(this.testState.rateTarget);
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    currentRate() {
      const latest = this.readings.at(-1);
      if (!latest) return null;
      const from = latest.at - 30000;
      let low = 0, high = this.readings.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.readings[middle].at < from) low = middle + 1;
        else high = middle;
      }
      const first = this.readings[low];
      const seconds = (latest.at - first.at) / 1000;
      return seconds >= 10 ? (latest.pressure - first.pressure) / (seconds / 60) : null;
    }

    // Shared by the readout and the log book's latest row.
    paceStatus() {
      const target = this.rateTarget();
      const rate = this.currentRate();
      if (!target || rate === null) return null;
      const shown = `${Math.abs(rate).toFixed(1)} psi/min`;
      if (rate < -0.5) return { tone: 'neutral', word: 'Falling', shown, target };
      if (rate < 0.5) return { tone: 'neutral', word: 'Holding', shown, target };
      if (rate > target) return { tone: 'slow', word: '▼ Slow down', shown, target };
      if (rate < target * 0.8) return { tone: 'speed', word: '▲ Speed up', shown, target };
      return { tone: 'pace', word: 'On pace', shown, target };
    }

    updateRate() {
      const element = this.root.querySelector('.pressure-rate');
      if (!element) return;
      const pace = this.paceStatus();
      element.hidden = !pace;
      if (!pace) return;
      element.textContent = `${pace.word} · ${pace.shown}${pace.tone === 'neutral' ? '' : ` (max ${pace.target})`}`;
      element.className = `pressure-rate ${pace.tone}`;
    }

    updateWarning() {
      const element = this.root.querySelector('.pressure-state');
      const latest = this.readings.at(-1);
      if (!latest) {
        element.className = 'pressure-state monitor';
        element.innerHTML = '<strong>Waiting for gauge</strong><span>Connect by USB or load a demo trace.</span>';
        return;
      }
      const settings = this.settings();
      const start = settings.testStart ? new Date(settings.testStart).getTime() : 0;
      let end = settings.testEnd ? new Date(settings.testEnd).getTime() : 0;
      if (start && end && end <= start) end += 86400000;
      const active = start && Date.now() >= start && (!end || Date.now() <= end);
      const bottom = settings.windowBottom === '' ? null : Number(settings.windowBottom);
      const top = settings.windowTop === '' ? null : Number(settings.windowTop);
      let tone = 'monitor', title = 'Monitoring', detail = 'Official-window warnings are not active.';
      if (active && Number.isFinite(bottom) && Number.isFinite(top)) {
        if (latest.pressure < bottom || latest.pressure > top) {
          tone = 'failed'; title = 'Outside test window'; detail = 'Record the exact time and pressure immediately.';
        } else {
          const lowDistance = latest.pressure - bottom;
          const highDistance = top - latest.pressure;
          if (lowDistance <= settings.warningMargin) { tone = 'warning'; title = 'Approaching lower limit'; detail = `${lowDistance.toFixed(1)} psi above the lower limit.`; }
          else if (highDistance <= settings.warningMargin) { tone = 'warning'; title = 'Approaching upper limit'; detail = `${highDistance.toFixed(1)} psi below the upper limit.`; }
          else { tone = 'safe'; title = 'Inside pressure window'; detail = `${Math.min(lowDistance, highDistance).toFixed(1)} psi from the nearest limit.`; }
        }
      }
      element.className = `pressure-state ${tone}`;
      element.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
    }

    draw() {
      window.PressureChartRenderer.draw(this.canvas, this.readings, this.settings());
      if (!this.lastTemperatureDrawAt || Date.now() - this.lastTemperatureDrawAt >= 3000) this.drawTemperature();
    }

    drawTemperature() {
      this.lastTemperatureDrawAt = Date.now();
      window.TemperatureChartRenderer.renderPanel(this.temperaturePanel, {
        pressureReadings: this.readings,
        temperatureReadings: this.temperatureReadings,
        channels: this.temperatureChannels(),
        testStart: this.testState.officialStart,
        testEnd: this.testState.officialEnd,
        notes: hostNotes.filter((note) => note.slot === this.slot),
        wholeDegrees: this.temperatureRecordingOptions().wholeDegrees,
      });
      const status = this.root.querySelector('.temperature-status');
      if (status) {
        const latestLive = this.temperatureReadings.filter((entry) => entry.source === 'live').at(-1);
        const manualCount = this.temperatureReadings.filter((entry) => entry.source === 'manual').length;
        const sheetCount = this.temperatureReadings.filter((entry) => entry.source === 'sheet').length;
        const liveAge = latestLive ? Date.now() - Number(latestLive.at) : Infinity;
        const current = liveAge >= -30000 && liveAge < Math.max(30000, this.temperatureRecordingOptions().sampleIntervalSeconds * 2000 + 5000);
        status.textContent = latestLive ? `${current ? 'MadgeTech live' : 'MadgeTech delayed'} · ${new Date(latestLive.at).toLocaleTimeString()}` : sheetCount ? `${sheetCount} Google Sheet reading${sheetCount === 1 ? '' : 's'}` : manualCount ? `${manualCount} manual reading${manualCount === 1 ? '' : 's'}` : this.temperatureReadings.length ? 'Historical temperature data' : 'No temperature data';
        status.className = current || (this.temperatureReadings.length && !latestLive) ? 'pill live temperature-status' : 'pill amber temperature-status';
      }
    }

    async disconnect() {
      clearInterval(this.queryTimer);
      this.queryTimer = null;
      gaugeTicker.remove(this.queryTick);
      this.cancelReconnect();
      forgetGaugePort(this.slot);
      this.keepReading = false;
      try {
        if (this.reader) await this.reader.cancel();
        if (this.port) await this.port.close();
      } catch (_) {}
      this.port = null;
      this.connectedAt = 0;
      this.staleAlerted = false;
      this.unitWarning = '';
      this.setConnection('Not connected', false);
      screenAwake.update();
    }

    setConnection(text, connected) {
      const status = this.root.querySelector('.connection-status');
      status.classList.toggle('connected', connected);
      if (!connected) status.classList.remove('stale');
      status.innerHTML = `<i></i> ${text}`;
      const button = this.root.querySelector('.connect-button');
      button.textContent = connected ? 'Disconnect' : 'Connect gauge';
      button.classList.toggle('primary', !connected);
    }

    // A message about a button low on the page shows under that button, where the operator is looking.
    showActionError(anchor, message) {
      if (anchor && window.HydroFeedback) window.HydroFeedback.near(anchor, message);
      else this.showError(message);
    }

    showError(message) {
      const box = this.root.querySelector('.gauge-error');
      box.textContent = message;
      box.classList.toggle('hidden', !message);
    }

    clear() {
      this.readings = [];
      this.temperatureReadings = this.temperatureReadings.filter((entry) => entry.source === 'live');
      this.testState.manualTemperatures = [];
      this.peak = null;
      this.low = null;
      this.saveTestState();
      this.renderManualTemperatures();
      this.updateUi();
      this.draw();
      if (readingStore) readingStore.clear(window.HydroJobs.pressureKey(this.testState));
    }

  }

  const gauges = Array.from(document.querySelectorAll('[data-gauge]')).map((root) => new GaugeHost(root));
  const equipmentForm = document.getElementById('equipmentForm');
  const equipmentTableBody = document.getElementById('equipmentTableBody');

  function saveEquipmentInventory() {
    localStorage.setItem(equipmentStorageKey, JSON.stringify(equipmentInventory));
  }

  function equipmentIdentity(item) {
    return [item.name, item.serial ? `S/N ${item.serial}` : ''].filter(Boolean).join(' • ');
  }

  function renderEquipmentLibrary() {
    if (!equipmentTableBody) return;
    if (!equipmentInventory.length) {
      equipmentTableBody.innerHTML = '<tr><td colspan="6" class="event-empty">No equipment has been added.</td></tr>';
    } else {
      equipmentTableBody.innerHTML = equipmentInventory.map((item) => {
        const rangeOrCapacity = item.type === 'pump' ? (item.capacity ? `${item.capacity} gal/stroke` : 'Capacity needed') : (item.range || '—');
        const calibration = item.type === 'pump' ? 'Not applicable' : (item.calibrationDate ? `${new Date(`${item.calibrationDate}T12:00:00`).toLocaleDateString()} • ${Number(item.intervalMonths) || 6} months` : 'Date needed');
        return `<tr><td>${escapeHtml(equipmentTypeLabels[item.type] || item.type)}</td><td>${escapeHtml(equipmentIdentity(item))}</td><td>${escapeHtml(rangeOrCapacity)}</td><td>${escapeHtml(calibration)}</td><td>${item.isDefault ? 'Yes' : ''}</td><td><button type="button" class="ghost edit-equipment" data-equipment-action="edit" data-equipment-id="${escapeHtml(item.id)}">Edit</button><button type="button" class="ghost remove-equipment" data-equipment-action="remove" data-equipment-id="${escapeHtml(item.id)}">Remove</button></td></tr>`;
      }).join('');
    }
    gauges.forEach((gauge) => gauge.applyEquipmentOptions());
  }

  equipmentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const type = document.getElementById('equipmentType').value;
    const name = document.getElementById('equipmentName').value.trim();
    if (!name) return;
    const editId = document.getElementById('equipmentEditId').value;
    const item = {
      id: editId || ((window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      type,
      name,
      serial: document.getElementById('equipmentSerial').value.trim(),
      manufacturer: document.getElementById('equipmentManufacturer').value.trim(),
      range: document.getElementById('equipmentRange').value.trim(),
      calibrationDate: document.getElementById('equipmentCalibration').value,
      intervalMonths: Number(document.getElementById('equipmentInterval').value) || 6,
      capacity: document.getElementById('equipmentCapacity').value.trim(),
      isDefault: document.getElementById('equipmentDefault').checked,
    };
    if (item.isDefault) equipmentInventory.forEach((entry) => { if (entry.type === type && entry.id !== item.id) entry.isDefault = false; });
    const existingIndex = equipmentInventory.findIndex((entry) => entry.id === item.id);
    if (existingIndex >= 0) equipmentInventory[existingIndex] = item;
    else equipmentInventory.push(item);
    saveEquipmentInventory();
    resetEquipmentForm();
    renderEquipmentLibrary();
  });

  function resetEquipmentForm() {
    equipmentForm.reset();
    document.getElementById('equipmentEditId').value = '';
    document.getElementById('equipmentInterval').value = '6';
    document.getElementById('saveEquipment').textContent = 'Add equipment';
    document.getElementById('cancelEquipmentEdit').classList.add('hidden');
  }

  document.getElementById('cancelEquipmentEdit').addEventListener('click', resetEquipmentForm);

  equipmentTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-equipment-id]');
    if (!button) return;
    const item = equipmentInventory.find((entry) => entry.id === button.dataset.equipmentId);
    if (!item) return;
    if (button.dataset.equipmentAction === 'edit') {
      document.getElementById('equipmentEditId').value = item.id;
      document.getElementById('equipmentType').value = item.type;
      document.getElementById('equipmentName').value = item.name;
      document.getElementById('equipmentSerial').value = item.serial || '';
      document.getElementById('equipmentManufacturer').value = item.manufacturer || '';
      document.getElementById('equipmentRange').value = item.range || '';
      document.getElementById('equipmentCalibration').value = item.calibrationDate || '';
      document.getElementById('equipmentInterval').value = String(item.intervalMonths || 6);
      document.getElementById('equipmentCapacity').value = item.capacity || '';
      document.getElementById('equipmentDefault').checked = Boolean(item.isDefault);
      document.getElementById('saveEquipment').textContent = 'Save changes';
      document.getElementById('cancelEquipmentEdit').classList.remove('hidden');
      document.getElementById('equipmentName').focus();
      return;
    }
    if (!window.confirm(`Remove ${equipmentIdentity(item)} from the equipment library?`)) return;
    equipmentInventory = equipmentInventory.filter((entry) => entry.id !== item.id);
    saveEquipmentInventory();
    renderEquipmentLibrary();
  });

  renderEquipmentLibrary();
  const hostGrid = document.getElementById('hostGaugeGrid');
  const notesStorageKey = 'grantg-live-test-notes';
  const activeTestLabel = document.getElementById('activeTestLabel');
  const addSecondTestButton = document.getElementById('addSecondTest');
  const hideSecondTestButton = document.getElementById('hideSecondTest');
  const secondTestStorageKey = 'grantg-hydro-second-test-active';
  let secondTestActive = localStorage.getItem(secondTestStorageKey) === 'true';

  function gaugeFor(slot) { return gauges.find((gauge) => gauge.slot === slot); }

  function setLayout(mode) {
    const allowedMode = mode === 'B' && !secondTestActive ? 'A' : mode === 'both' && !secondTestActive ? 'A' : mode;
    hostGrid.dataset.viewMode = allowedMode;
    document.querySelectorAll('[data-layout-mode]').forEach((item) => item.classList.toggle('active', item.dataset.layoutMode === allowedMode));
    const nameA = gaugeFor('A').settings().name;
    const nameB = gaugeFor('B').settings().name;
    activeTestLabel.textContent = allowedMode === 'both' ? 'Both tests' : allowedMode === 'B' ? nameB : nameA;
    requestAnimationFrame(() => gauges.filter((gauge) => gauge.active).forEach((gauge) => gauge.draw()));
  }

  function applySecondTestUi(focusNewTest = false) {
    gaugeFor('A').setActive(true);
    gaugeFor('B').setActive(secondTestActive);
    app.classList.toggle('second-test-active', secondTestActive);
    document.querySelectorAll('.second-test-control').forEach((control) => control.classList.toggle('hidden', !secondTestActive));
    addSecondTestButton.classList.toggle('hidden', secondTestActive);
    hideSecondTestButton.classList.toggle('hidden', !secondTestActive);
    const requestedMode = focusNewTest && secondTestActive ? 'B' : hostGrid.dataset.viewMode;
    setLayout(requestedMode);
  }

  addSecondTestButton.addEventListener('click', () => {
    secondTestActive = true;
    localStorage.setItem(secondTestStorageKey, 'true');
    applySecondTestUi(true);
    publish();
  });

  hideSecondTestButton.addEventListener('click', async () => {
    const second = gaugeFor('B');
    if (second.connected() && !window.confirm('Test 2 is connected. Hide it and disconnect its gauge? Saved readings will remain on this laptop.')) return;
    if (second.connected()) await second.disconnect();
    secondTestActive = false;
    localStorage.setItem(secondTestStorageKey, 'false');
    applySecondTestUi();
    publish();
  });

  document.querySelectorAll('.gauge-name').forEach((input) => input.addEventListener('input', () => setLayout(hostGrid.dataset.viewMode)));

  function saveHostNotes() {
    localStorage.setItem(notesStorageKey, JSON.stringify(hostNotes));
  }

  function loadHostNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(notesStorageKey) || '[]');
      if (Array.isArray(saved)) {
        hostNotes = saved.filter((note) => note && Number.isFinite(Number(note.at)) && String(note.text || '').trim()).slice(-200).map((note) => ({
          id: String(note.id || `${Number(note.at)}-${Math.random().toString(36).slice(2)}`),
          at: Number(note.at),
          text: String(note.text).trim().slice(0, 500),
          slot: note.slot === 'B' ? 'B' : 'A',
        })).filter(note => note.at >= (Number(gaugeFor(note.slot).testState.jobStartedAt) || 0));
      }
    } catch (_) { hostNotes = []; }
  }

  loadHostNotes();

  document.querySelectorAll('[data-layout-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setLayout(button.dataset.layoutMode);
    });
  });
  app.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      app.dataset.dashboardView = button.dataset.dashboardTab;
      app.querySelectorAll('[data-dashboard-tab]').forEach((item) => item.classList.toggle('active', item === button));
      renderWorkspaceHeading(button.dataset.dashboardTab);
      requestAnimationFrame(() => gauges.forEach((gauge) => { gauge.draw(); gauge.drawTemperature(); }));
    });
  });

  const workspaceCopy = {
    pressure: ['FIELD RECORDER', 'Live test', 'Live readings and a flexible field log. Add actual times and notes whenever you have a moment.'],
    temperature: ['FIELD LOGGER', 'Temperatures', 'Open the field app. Choose your logger. Press Start recording temps.'],
    logs: ['Test record', 'Records & paperwork', 'Review official readings, stroke counts and events. Sync the Sheet only when you choose.'],
    setup: ['BEFORE YOU START', 'Test setup', 'Job details, equipment and recording settings—all in one place.'],
    tools: ['Utilities', 'Field tools', 'Use the hydrotest calculator or build a polished recorder report.'],
    sharing: ['OPTIONAL', 'Share with viewers', 'Give someone a read-only link. Sharing is not required to record pressure or temperatures.'],
  };

  function renderWorkspaceHeading(view) {
    const copy = workspaceCopy[view] || workspaceCopy.pressure;
    document.getElementById('workspaceEyebrow').textContent = copy[0];
    document.getElementById('workspaceTitle').textContent = copy[1];
    document.getElementById('workspaceDescription').textContent = copy[2];
  }

  function updateFieldClock() {
    const clock = document.getElementById('fieldClock');
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  renderWorkspaceHeading(app.dataset.dashboardView);
  updateFieldClock();
  setInterval(updateFieldClock, 1000);
  document.querySelectorAll('[data-tool-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-tool-tab]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-tool-frame]').forEach((frame) => frame.classList.toggle('hidden', frame.dataset.toolFrame !== button.dataset.toolTab));
    });
  });
  applySecondTestUi();
  gaugeTicker.add(() => gauges.forEach((gauge) => gauge.checkStale()));
  localSaveHealth.onRecover = (since) => {
    if (!readingStore) return;
    gauges.forEach((gauge) => {
      const key = window.HydroJobs.pressureKey(gauge.testState);
      gauge.readings.filter((reading) => reading.at >= since).forEach((reading) => readingStore.add(key, reading));
    });
  };
  if (!demo?.enabled && 'serial' in navigator) {
    navigator.serial.addEventListener('connect', () => gauges.forEach((gauge) => gauge.tryReconnect()));
    // After a reload or crash, reopen each test's gauge when that is unambiguous.
    gauges.filter((gauge) => gauge.active && savedGaugePort(gauge.slot)).forEach((gauge) => gauge.tryReconnect(true));
  }
  const remotePanel = document.getElementById('remotePanel');
  const remoteStart = document.getElementById('remoteStart');
  const remoteActive = document.getElementById('remoteActive');
  const remoteError = document.getElementById('remoteError');
  const headerStatus = document.getElementById('remoteHeaderStatus');
  const viewerShowTemperatures = document.getElementById('viewerShowTemperatures');
  const viewerTemperatureStorageKey = 'grantg-viewer-show-temperatures';
  let remote = null;
  let publishTimer = null;
  let publishInFlight = false;
  let temperatureTimer = null;
  let temperatureInFlight = false;
  let temperatureSessionId = '';
  let temperatureCursor = 0;
  let temperatureDevices = [];
  let deviceRefreshInFlight = false;

  function viewerIsEnabled() {
    return Boolean(remote && (remote.viewer_enabled === true
      || (remote.viewer_enabled === undefined && remote.viewer_url)));
  }

  function saveRemoteSession() {
    if (remote) localStorage.setItem('grantg-live-session', JSON.stringify(remote));
    else localStorage.removeItem('grantg-live-session');
  }

  async function ensureTestSession() {
    if (remote?.session_id && remote?.publish_token) return remote;
    remote = await api('create_private', {
      title: document.getElementById('remoteTitle').value,
    }, true);
    saveRemoteSession();
    applyRemoteUi();
    return remote;
  }

  function showRemoteError(message) {
    remoteError.textContent = message;
    remoteError.classList.toggle('hidden', !message);
  }

  function applyRemoteUi() {
    const viewerEnabled = viewerIsEnabled();
    remoteStart.classList.toggle('hidden', viewerEnabled);
    remoteActive.classList.toggle('hidden', !viewerEnabled);
    remotePanel.open = viewerEnabled;
    headerStatus.textContent = viewerEnabled ? 'Remote publishing active' : 'Remote viewing off';
    headerStatus.className = viewerEnabled ? 'pill live' : 'pill amber';
    renderTemperatureDevices();
    if (remote) {
      if (temperatureSessionId !== remote.session_id) {
        temperatureSessionId = remote.session_id;
        temperatureCursor = 0;
        gauges.forEach((gauge) => {
          gauge.temperatureReadings = gauge.temperatureReadings.filter((entry) => entry.source !== 'live');
          gauge.drawTemperature();
        });
      }
      if (viewerEnabled) {
        const link = document.getElementById('viewerLink');
        const qrLink = document.getElementById('viewerQrLink');
        link.href = remote.viewer_url;
        link.textContent = remote.viewer_url;
        qrLink.href = remote.viewer_url;
        try {
          window.SimpleQr.draw(document.getElementById('viewerQrCode'), remote.viewer_url);
        } catch (error) {
          showRemoteError(error.message || String(error));
        }
        startPublisher();
      } else {
        if (publishTimer) clearInterval(publishTimer);
        publishTimer = null;
      }
      startTemperaturePoller();
    } else {
      if (publishTimer) clearInterval(publishTimer);
      if (temperatureTimer) clearInterval(temperatureTimer);
      publishTimer = null;
      temperatureTimer = null;
    }
  }

  function temperatureOptionElements(root) {
    return {
      interval: root.querySelector('.temperature-sample-interval'),
      intervalValue: root.querySelector('.temperature-sample-interval-value'),
      whole: root.querySelector('.temperature-whole-degrees'),
    };
  }

  function saveTemperatureOptions(root) {
    const controls = temperatureOptionElements(root);
    localStorage.setItem(`grantg-temperature-options-${root.dataset.gauge}`, JSON.stringify({
      sampleIntervalSeconds: Math.max(2, Math.min(60, Number(controls.interval?.value) || 2)),
      wholeDegrees: controls.whole?.checked === true,
    }));
  }

  function setTemperatureOptions(root, options, locked = false) {
    const controls = temperatureOptionElements(root);
    const interval = Math.max(2, Math.min(60, Number(options?.sampleIntervalSeconds) || 2));
    if (controls.interval) {
      controls.interval.value = String(interval);
      controls.interval.disabled = locked;
    }
    if (controls.intervalValue) controls.intervalValue.textContent = String(interval);
    if (controls.whole) {
      controls.whole.checked = options?.wholeDegrees === true;
      controls.whole.disabled = locked;
    }
  }

  document.querySelectorAll('[data-gauge]').forEach((root) => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`grantg-temperature-options-${root.dataset.gauge}`) || 'null'); } catch (_) {}
    setTemperatureOptions(root, saved || { sampleIntervalSeconds: 2, wholeDegrees: false });
    const controls = temperatureOptionElements(root);
    controls.interval?.addEventListener('input', () => {
      setTemperatureOptions(root, {
        sampleIntervalSeconds: controls.interval.value,
        wholeDegrees: controls.whole?.checked === true,
      });
      saveTemperatureOptions(root);
    });
    controls.whole?.addEventListener('change', () => {
      saveTemperatureOptions(root);
      gauges.find((gauge) => gauge.slot === root.dataset.gauge)?.drawTemperature();
    });
  });

  async function api(action, payload, includeCsrf) {
    if (demo?.enabled) throw new Error('Demo mode cannot publish or write to Google Sheets.');
    const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(includeCsrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The server rejected the request.');
    return result;
  }

  async function temperatureApi(action, payload, includeCsrf = false) {
    if (demo?.enabled) throw new Error('Real temperature devices are disabled in demo mode.');
    const response = await fetch(`temperature.php?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(includeCsrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The temperature server rejected the request.');
    return result;
  }

  function attachedTemperatureDevice(gauge) {
    return temperatureDevices.find((device) => remote && device.session_id === remote.session_id && device.slot === gauge.slot
      && (!Array.isArray(gauge.testState.temperatureSourceIds) || gauge.testState.temperatureSourceIds.includes(device.source_id)));
  }

  function renderTemperatureDevices() {
    document.querySelectorAll('[data-gauge]').forEach((root) => {
      const select = root.querySelector('.temperature-device-select');
      if (!select) return;
      const slot = root.dataset.gauge;
      const gauge = gauges.find(g => g.slot === slot);
      const selectedBefore = select.value;
      const attached = attachedTemperatureDevice(gauge);
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = temperatureDevices.length ? 'Choose a logger' : 'Waiting for field app…';
      select.appendChild(placeholder);
      temperatureDevices.forEach((device) => {
        const option = document.createElement('option');
        option.value = device.id;
        const assignment = device.finishing ? ' · ready for a new recording' : (device.session_id
          ? ` · recording ${remote && device.session_id === remote.session_id ? `Test ${device.slot === 'A' ? '1' : '2'}` : 'another session'}`
          : '');
        option.textContent = `${device.serial} — ${device.online ? 'Online' : 'Offline'}${assignment}`;
        select.appendChild(option);
      });
      if (attached) select.value = attached.id;
      else if (temperatureDevices.some((device) => device.id === selectedBefore)) select.value = selectedBefore;
      else if (temperatureDevices.filter((device) => device.online).length === 1) {
        select.value = temperatureDevices.find((device) => device.online).id;
      }
      else if (temperatureDevices.length === 1) select.value = temperatureDevices[0].id;
      const chosen = temperatureDevices.find((device) => device.id === select.value);
      const powerStatus = root.querySelector('.temperature-laptop-power');
      if (powerStatus && window.HydroFieldPower) {
        const power = window.HydroFieldPower.describe(chosen);
        powerStatus.textContent = power.text;
        powerStatus.dataset.state = power.state;
        const run = window.HydroFieldPower.batteryRun?.(chosen?.power);
        if (run) {
          const line = document.createElement('small');
          line.className = 'temperature-battery-run';
          line.textContent = run;
          powerStatus.append(line);
        }
      }
      const controls = temperatureOptionElements(root);
      if (attached) {
        setTemperatureOptions(root, {
          sampleIntervalSeconds: attached.sample_interval_seconds,
          wholeDegrees: attached.whole_degrees === true,
        }, true);
      } else {
        if (controls.interval) controls.interval.disabled = false;
        if (controls.whole) controls.whole.disabled = false;
      }
      const busy = gauge.temperatureControlInFlight === true;
      select.disabled = busy || Boolean(attached);
      const connect = root.querySelector('.temperature-device-connect');
      connect.textContent = chosen?.session_id && !attached ? 'Move logger here & record' : 'Start recording temps';
      connect.disabled = busy || !chosen?.online || Boolean(attached);
      root.querySelector('.temperature-device-disconnect').disabled = busy || !remote || !attached;
      if (busy) { if (controls.interval) controls.interval.disabled = true; if (controls.whole) controls.whole.disabled = true; return; }
      const status = root.querySelector('.temperature-bridge-status');
      if (attached) {
        const received = gauge.temperatureReadings.some(row => row.source === 'live' && (!attached.source_id || row.sourceId === attached.source_id));
        status.textContent = !attached.online ? `${attached.serial} is offline. Keep recording on the field laptop; saved readings upload when it reconnects.`
          : !received ? `Recording started. Waiting for the first reading from ${attached.serial}…`
          : `${attached.serial} is recording every ${attached.sample_interval_seconds || 2} seconds${attached.whole_degrees ? ', rounded to whole degrees.' : '.'}`;
      }
      else if (chosen?.session_id) status.textContent = 'This logger is attached to another recording. Move it here to stop that recording and start this test. Earlier readings stay with their original test.';
      else if (chosen?.online) status.textContent = `${chosen.serial} is ready. Press Start recording temps. Earlier readings will not be added to this test.`;
      else if (chosen?.bridge_online) status.textContent = 'Field app reached the website, but cannot read the logger. On the field laptop, check USB, MadgeTech Real Time mode and the bridge window.';
      else status.textContent = 'Field laptop is not online. Open MadgeTech in Real Time mode, open Run-Bridge.cmd, and check its hotspot connection. This page checks automatically.';
    });
  }

  async function refreshTemperatureDevices() {
    if (deviceRefreshInFlight) return;
    deviceRefreshInFlight = true;
    try {
      const result = await temperatureApi('list_devices', {}, true);
      temperatureDevices = result.devices || [];
      renderTemperatureDevices();
    } catch (error) {
      document.querySelectorAll('.temperature-bridge-status').forEach((status) => {
        status.textContent = `Logger list unavailable: ${error.message || String(error)}`;
      });
      document.querySelectorAll('.temperature-laptop-power').forEach((status) => {
        status.textContent = 'Field laptop: battery status unavailable — website connection could not be refreshed.';
        status.dataset.state = 'stale';
      });
    } finally { deviceRefreshInFlight = false; }
  }

  document.querySelectorAll('[data-gauge]').forEach((root) => {
    const select = root.querySelector('.temperature-device-select');
    if (!select) return;
    const connect = root.querySelector('.temperature-device-connect');
    const disconnect = root.querySelector('.temperature-device-disconnect');
    const status = root.querySelector('.temperature-bridge-status');
    const errorBox = root.querySelector('.temperature-connection-error');
    const showError = text => { if (errorBox) { errorBox.textContent = text; errorBox.hidden = !text; } };
    select.addEventListener('change', renderTemperatureDevices);
    root.querySelector('.temperature-device-refresh')?.addEventListener('click', refreshTemperatureDevices);
    // Moving the logger to another field laptop: download a fresh private setup file for it.
    root.querySelector('.temperature-device-reissue')?.addEventListener('click', async () => {
      const chosen = temperatureDevices.find((device) => device.id === select.value) || (temperatureDevices.length === 1 ? temperatureDevices[0] : null);
      if (!chosen) { showError('Choose the field logger first. Use Refresh loggers if the list is empty.'); return; }
      if (!window.confirm(`Download a new setup file for logger ${chosen.serial}?\n\nThe field app on the current field laptop stops sending as soon as you do this. The recording on this page carries on once the new laptop's field app starts.`)) return;
      showError('');
      try {
        const result = await temperatureApi('reissue_device', { device_id: chosen.id }, true);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([JSON.stringify(result.settings, null, 2)], { type: 'application/octet-stream' }));
        link.download = 'field-device.settings';
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
        status.textContent = `Downloaded field-device.settings for ${chosen.serial}. Put it next to MadgeTechFieldBridge.exe on the new field laptop, then start the field app there.`;
      } catch (error) { showError(error.message || String(error)); }
    });
    connect.addEventListener('click', async () => {
      if (!select.value) return;
      const gauge = gauges.find(g => g.slot === root.dataset.gauge);
      if (gauge.temperatureControlInFlight || gauge.jobTransition || !gauge.checkJobCurrent()) return;
      const chosen = temperatureDevices.find(device => device.id === select.value);
      const moveRecording = Boolean(chosen?.session_id);
      if (moveRecording && !window.confirm(`Move logger ${chosen.serial} to this test? Its current recording will stop now. A new recording starts here with no earlier temperatures. The updated field app will finish any remaining old uploads separately.`)) return;
      const deviceId = select.value;
      gauge.temperatureControlInFlight = true;
      showError(''); renderTemperatureDevices();
      status.textContent = 'Starting temperature recording…';
      try {
        await ensureTestSession();
        const options = gauges.find((gauge) => gauge.slot === root.dataset.gauge)?.temperatureRecordingOptions()
          || { sampleIntervalSeconds: 2, wholeDegrees: false };
        const started = await temperatureApi('connect_device', {
          session_id: remote.session_id, publish_token: remote.publish_token,
          slot: root.dataset.gauge, device_id: deviceId,
          replace_recording: moveRecording, expected_source_id: chosen?.source_id || null,
          sample_interval_seconds: options.sampleIntervalSeconds,
          whole_degrees: options.wholeDegrees,
        }, true);
        if (Array.isArray(gauge.testState.temperatureSourceIds)) {
          if (!started.source_id) throw new Error('Logger started without a source identifier. Stop it and retry.');
          if (!gauge.testState.temperatureSourceIds.includes(started.source_id)) gauge.testState.temperatureSourceIds.push(started.source_id);
          gauge.saveTestState();
          publish();
        }
        await refreshTemperatureDevices();
      } catch (error) { showError(error.message || String(error)); }
      finally { gauge.temperatureControlInFlight = false; renderTemperatureDevices(); }
    });
    disconnect.addEventListener('click', async () => {
      if (!remote || !select.value) return;
      const gauge = gauges.find(g => g.slot === root.dataset.gauge);
      if (gauge.temperatureControlInFlight || gauge.jobTransition || !gauge.checkJobCurrent()) return;
      gauge.temperatureControlInFlight = true;
      const deviceId = select.value;
      showError(''); renderTemperatureDevices();
      status.textContent = 'Stopping temperature recording…';
      try {
        await temperatureApi('disconnect_device', {
          session_id: remote.session_id, publish_token: remote.publish_token,
          slot: root.dataset.gauge, device_id: deviceId,
        }, true);
        await refreshTemperatureDevices();
      } catch (error) { showError(error.message || String(error)); }
      finally { gauge.temperatureControlInFlight = false; renderTemperatureDevices(); }
    });
  });

  async function pollTemperatures() {
    if (!remote || temperatureInFlight) return;
    temperatureInFlight = true;
    const sessionId = remote.session_id;
    try {
      let pages = 0;
      let more = false;
      do {
        const result = await temperatureApi('view', {
          session_id: sessionId, publish_token: remote.publish_token, since_id: temperatureCursor,
        });
        if (!remote || remote.session_id !== sessionId) return;
        const changed = new Set();
        (result.readings || []).forEach((row) => {
          const gauge = gauges.find((item) => item.slot === row.slot);
          if (!gauge || gauge.obsoleteJob || !window.HydroJobs.acceptsTemperature(gauge.testState, row)) return;
          const reading = { at: Number(row.at), source: 'live', sourceId: row.source_id };
          ['pipe', 'soil', 'ambient', 'aux'].forEach((key) => {
            if (row[key] !== null && row[key] !== '' && Number.isFinite(Number(row[key]))) reading[key] = Number(row[key]);
          });
          gauge.temperatureReadings.push(reading);
          changed.add(gauge);
        });
        temperatureCursor = Number(result.last_id) || temperatureCursor;
        changed.forEach((gauge) => {
          gauge.temperatureReadings.sort((a, b) => Number(a.at) - Number(b.at));
          gauge.drawTemperature();
        });
        more = result.has_more === true;
        pages++;
      } while (more && pages < 4);
      gauges.forEach((gauge) => gauge.drawTemperature());
    } catch (error) {
      document.querySelectorAll('.temperature-bridge-status').forEach((status) => {
        status.textContent = `Temperature feed waiting: ${error.message || String(error)}`;
      });
    } finally { temperatureInFlight = false; }
  }

  function startTemperaturePoller() {
    if (temperatureTimer) clearInterval(temperatureTimer);
    pollTemperatures();
    temperatureTimer = setInterval(pollTemperatures, 3000);
  }

  document.getElementById('startRemote').addEventListener('click', async () => {
    showRemoteError('');
    try {
      await ensureTestSession();
      const result = await api('enable_viewer', {
        session_id: remote.session_id,
        publish_token: remote.publish_token,
        title: document.getElementById('remoteTitle').value,
        viewer_password: document.getElementById('viewerPassword').value,
      }, true);
      remote.viewer_enabled = true;
      remote.viewer_url = result.viewer_url;
      saveRemoteSession();
      applyRemoteUi();
    } catch (error) { showRemoteError(error.message || String(error)); }
  });

  document.getElementById('copyViewerLink').addEventListener('click', async () => {
    if (!remote) return;
    await navigator.clipboard.writeText(remote.viewer_url);
    headerStatus.textContent = 'Viewer link copied';
  });

  document.getElementById('stopRemote').addEventListener('click', async () => {
    if (!remote) return;
    try {
      await api('disable_viewer', {
        session_id: remote.session_id,
        publish_token: remote.publish_token,
      }, true);
      remote.viewer_enabled = false;
      delete remote.viewer_url;
      saveRemoteSession();
      showRemoteError('');
      applyRemoteUi();
    } catch (error) { showRemoteError(error.message || String(error)); }
  });

  async function publish() {
    if (!remote || !viewerIsEnabled() || publishInFlight) return;
    publishInFlight = true;
    try {
      const publishedAt = remote.last_published_at || { A: 0, B: 0 };
      const batches = gauges.filter(gauge => !gauge.jobTransition && gauge.checkJobCurrent()).map((gauge) => gauge.publishBatch(Number(publishedAt[gauge.slot]) || 0));
      await api('publish', {
        session_id: remote.session_id,
        publish_token: remote.publish_token,
        gauges: batches,
        notes: [
          ...hostNotes.map((note) => ({ at: note.at, text: `${gauges.find((gauge) => gauge.slot === note.slot)?.settings().name || testNameForSlot(note.slot)}: ${note.text}` })),
          ...gauges.filter((gauge) => gauge.active).flatMap((gauge) => (gauge.testState.events || [])
            .filter((event) => event.shared && event.type === 'note')
            .map((event) => ({ at: event.at, text: `${gauge.settings().name || testNameForSlot(gauge.slot)}: ${event.label}` }))),
        ].sort((a, b) => Number(a.at) - Number(b.at)).slice(-200),
      }, false);
      remote.last_published_at = { ...publishedAt };
      batches.forEach((batch) => {
        const latest = batch.readings.at(-1);
        if (latest) remote.last_published_at[batch.slot] = latest.at;
      });
      saveRemoteSession();
      const stillSyncing = gauges.filter((gauge) => gauge.active).some((gauge) => {
        const latest = gauge.readings.at(-1);
        return latest && latest.at > (Number(remote.last_published_at[gauge.slot]) || 0);
      });
      if (viewerIsEnabled()) {
        headerStatus.textContent = stillSyncing ? 'Syncing earlier chart readings…' : `Remote updated ${new Date().toLocaleTimeString()}`;
        headerStatus.className = 'pill live';
      }
      showRemoteError('');
    } catch (error) {
      headerStatus.textContent = 'Remote waiting to reconnect';
      headerStatus.className = 'pill amber';
      showRemoteError(error.message || String(error));
    } finally { publishInFlight = false; }
  }

  function startPublisher() {
    if (publishTimer) clearInterval(publishTimer);
    publish();
    publishTimer = setInterval(publish, 1000);
  }

  viewerShowTemperatures.checked = localStorage.getItem(viewerTemperatureStorageKey) === 'true';
  viewerShowTemperatures.addEventListener('change', () => {
    localStorage.setItem(viewerTemperatureStorageKey, viewerShowTemperatures.checked ? 'true' : 'false');
    publish();
  });

  window.addEventListener('grantg-pressure-recalibrated', (event) => {
    if (!remote) return;
    remote.last_published_at = { ...(remote.last_published_at || {}), [event.detail.slot]: 0 };
    saveRemoteSession();
    publish();
  });

  try {
    const saved = localStorage.getItem('grantg-live-session');
    if (saved) remote = JSON.parse(saved);
  } catch (_) {}
  applyRemoteUi();
  if (!demo?.enabled) {
    refreshTemperatureDevices();
    setInterval(refreshTemperatureDevices, 5000);
  }
  window.HydroWorkflowUI.attach(gauges, {
    ding: staleDing,
    unlockAudio() {
      try {
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();
      } catch (_) {}
    },
  });
  demo?.attach(gauges);
  window.HydroWorkspace?.attach(gauges);
  window.HydroCloud?.attach(gauges, async gauge => {
    const state = gauge.testState;
    await gauge.readingsReady;
    if (state !== gauge.testState || gauge.jobTransition || !gauge.checkJobCurrent()) return null;
    const storedPressure = readingStore ? await readingStore.load(window.HydroJobs.pressureKey(state), true) : [];
    if (state !== gauge.testState || gauge.jobTransition || !gauge.checkJobCurrent()) return null;
    const latestState = JSON.parse(localStorage.getItem(`${testStoragePrefix}${gauge.slot}`) || 'null') || state;
    const readings = [...new Map([...gauge.readings, ...storedPressure].map(r => [Number(r.at), r])).values()].sort((a,b) => a.at-b.at);
    if (!readings.length && !gauge.temperatureReadings.length && !latestState.events.length && !latestState.jobNumber) return null;
    if (!latestState.cloudJobId) {
      latestState.cloudJobId = crypto.randomUUID();
      localStorage.setItem(`${testStoragePrefix}${gauge.slot}`, JSON.stringify(latestState));
    }
    state.cloudJobId = latestState.cloudJobId;
    return clone({ id: latestState.cloudJobId, format: 'grantg-hydrotest-backup', version: 1,
      archivedAt: 0, exportedAt: new Date().toISOString(), test: latestState,
      equipment: equipmentInventory, readings, temperatureReadings: gauge.temperatureReadings,
      notes: hostNotes.filter(n => n.slot === gauge.slot) });
  });
  window.addEventListener('storage', event => {
    if (event.key?.startsWith(testStoragePrefix)) gauges.forEach(g => g.checkJobCurrent());
    if (event.key === notesStorageKey) loadHostNotes();
  });
  // Log book on the Live test page: pressure and the probes in use, at a chosen interval.
  function logbookData(gauge) {
    const all = gauge.temperatureReadings;
    const cache = gauge.logbookCache || {};
    if (cache.source !== all || cache.length !== all.length || cache.lastAt !== all.at(-1)?.at) {
      // Probe readings, not typed or Sheet (chart thermometer) values, where the probes recorded.
      const temperatures = window.TemperatureChartRenderer.probePreferred([...all].sort((a, b) => Number(a.at) - Number(b.at))).readings;
      const present = new Set(['ambient', 'pipe', 'soil', 'aux'].filter((key) => temperatures.some((row) => Number.isFinite(Number(row[key])) && row[key] !== null && row[key] !== '')));
      gauge.logbookCache = { source: all, length: all.length, lastAt: all.at(-1)?.at, temperatures, present };
    }
    const enabled = gauge.testState.enabledProbes || ['ambient', 'pipe', 'soil', 'aux'];
    const smoothing = gauge.smoothingSeconds();
    return {
      pressure: gauge.readings,
      temperatures: window.TemperatureChartRenderer.smoothReadings(gauge.logbookCache.temperatures, smoothing),
      channels: gauge.temperatureChannels().filter((channel) => enabled.includes(channel.key) && gauge.logbookCache.present.has(channel.key))
        .map((channel) => smoothing ? { ...channel, name: `${channel.name} (${smoothing < 60 ? `${smoothing} s` : `${smoothing / 60} min`} avg)` } : channel),
      wholeDegrees: gauge.temperatureRecordingOptions?.().wholeDegrees === true,
      pace: gauge.paceStatus(),
    };
  }
  const logbooks = window.HydroLogbook ? gauges.map((gauge) => {
    const card = document.createElement('section');
    card.className = 'logbook-card';
    (gauge.root.querySelector('.page-pressure') || gauge.root).append(card);
    return window.HydroLogbook.mount(card, { getData: () => logbookData(gauge), storageKey: `grantg-logbook-interval-${gauge.slot}` });
  }) : [];
  gaugeTicker.add(() => gauges.forEach((gauge, index) => { if (gauge.active) logbooks[index]?.refresh(); }));

  // Stroke count panel on the Live test page (type the counter, Enter, next checkpoint).
  window.HydroStrokeCount?.attach(gauges, { ding: staleDing });
  gaugeTicker.add(() => gauges.forEach((gauge) => gauge.strokeCount?.render()));

  // Trailer alerts: a banner that stays up while the problem lasts, with a ding
  // every 20 seconds until it is silenced. A cleared problem re-alerts next time.
  const BATTERY_ALERT_PERCENT = 75;
  const alertBar = document.getElementById('hostAlerts');
  const silencedAlerts = new Set();
  let lastAlertDingAt = 0;
  const minutesAgo = (ms) => ms < 90000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60000)} minutes`;

  function activeAlerts() {
    const now = Date.now();
    const alerts = [];
    for (const gauge of gauges.filter((item) => item.active)) {
      const name = gauge.settings().name || testNameForSlot(gauge.slot);
      if (gauge.reconnectWanted && !gauge.port) alerts.push({ id: `gauge-lost-${gauge.slot}`, text: `${name}: gauge disconnected. Check the USB cable; it reconnects by itself when the gauge is back.` });
      else if (gauge.port && gauge.staleAlerted) alerts.push({ id: `gauge-stale-${gauge.slot}`, text: `${name}: no reading from the gauge for over 30 seconds.` });
      const device = demo?.enabled ? null : attachedTemperatureDevice(gauge);
      if (!device) continue;
      let latest = null;
      for (let i = gauge.temperatureReadings.length - 1; i >= 0; i--) {
        const row = gauge.temperatureReadings[i];
        if (row.source === 'live' && (!device.source_id || row.sourceId === device.source_id)) { latest = row; break; }
      }
      const limit = Math.max(60000, (Number(device.sample_interval_seconds) || 2) * 2000 + 10000);
      if (latest && gauge.testState.auxHeatAlert !== false && Number(latest.aux) >= AUX_HEAT_ALERT_F && now - Number(latest.at) <= limit)
        alerts.push({ id: `aux-heat-${gauge.slot}`, text: `${name}: Auxiliary is at ${Number(latest.aux).toFixed(1)} °F. If it's under the field laptop, the laptop is getting too hot. Move it out of the sun and give it air.` });
      if (latest && now - Number(latest.at) > limit) alerts.push({ id: `temps-stopped-${gauge.slot}`, text: `${name}: temperature feed stopped. Last reading ${minutesAgo(now - Number(latest.at))} ago. Check the field laptop, MadgeTech and the bridge.` });
      const power = device.power;
      const fresh = power && device.bridge_online === true && Number.isFinite(power.reported_at) && now - power.reported_at <= 60000;
      if (!fresh) continue;
      if (window.HydroFieldPower?.isHot(power)) alerts.push({ id: 'field-hot', text: `Field laptop is hot (${power.laptop_temp_f} °F). Move it out of the sun and clear the vents.` });
      if (power.has_battery === false) continue;
      const percent = Number.isInteger(power.battery_percent) ? power.battery_percent : null;
      const level = percent === null ? '' : ` (${percent}%)`;
      if (power.on_ac === false) alerts.push({ id: 'field-unplugged', text: `Field laptop is unplugged and running on battery${level}.` });
      else if (power.on_ac === true && power.charging === false && percent !== null && percent < 95) alerts.push({ id: 'field-not-charging', text: `Field laptop is plugged in but not charging${level}.` });
      if (percent !== null && percent < BATTERY_ALERT_PERCENT) alerts.push({ id: 'field-battery-low', text: `Field laptop battery is at ${percent}%.` });
    }
    return [...new Map(alerts.map((alert) => [alert.id, alert])).values()];
  }

  function renderAlerts() {
    if (!alertBar) return;
    const alerts = activeAlerts();
    const ids = new Set(alerts.map((alert) => alert.id));
    silencedAlerts.forEach((id) => { if (!ids.has(id)) silencedAlerts.delete(id); });
    alertBar.replaceChildren(...alerts.map((alert) => {
      const row = document.createElement('div');
      row.className = `host-alert${silencedAlerts.has(alert.id) ? ' silenced' : ''}`;
      const text = document.createElement('span'); text.textContent = alert.text;
      row.append(text);
      if (!silencedAlerts.has(alert.id)) {
        const silence = document.createElement('button');
        silence.type = 'button'; silence.textContent = 'Silence'; silence.dataset.silenceAlert = alert.id;
        row.append(silence);
      }
      return row;
    }));
    alertBar.hidden = !alerts.length;
    document.title = `${alerts.length ? '⚠ ' : ''}${document.title.replace(/^⚠ /, '')}`;
    const loud = alerts.some((alert) => !silencedAlerts.has(alert.id));
    if (loud && Date.now() - lastAlertDingAt >= 20000) { lastAlertDingAt = Date.now(); staleDing(); setTimeout(staleDing, 450); }
    if (!loud) lastAlertDingAt = 0;
  }
  alertBar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-silence-alert]');
    if (!button) return;
    silencedAlerts.add(button.dataset.silenceAlert);
    renderAlerts();
  });
  // Browsers only play sound after a click on the page; any click unlocks it.
  document.addEventListener('pointerdown', () => {
    try { audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume(); } catch (_) {}
  }, { passive: true });
  gaugeTicker.add(renderAlerts);

  window.addEventListener('beforeunload', () => { if (publishTimer) clearInterval(publishTimer); });
})();
