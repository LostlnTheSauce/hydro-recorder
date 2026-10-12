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
      chartMax: '1000', traceThickness: '1.0', windowBottom: '', windowTop: '', design: null, sheet: null, manualTemperatures: [], slot,
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

  function localStamp(date) {
    return date.toLocaleString();
  }

  function localDateValue(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
      this.root.querySelector('.download-button').addEventListener('click', () => this.downloadCsv());
      this.root.querySelector('.demo-button').addEventListener('click', () => this.loadDemo());
      this.root.querySelector('.paste-test-button').addEventListener('click', () => {
        const panel = this.root.querySelector('.paste-test-panel');
        panel.open = true;
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => this.root.querySelector('.paste-test-input').focus(), 250);
      });
      this.root.querySelector('.clear-button').addEventListener('click', () => {
        const manualCount = this.temperatureReadings.filter((entry) => entry.source === 'manual').length;
        if (manualCount && !window.confirm(`Clear all pressure readings and ${manualCount} manually entered temperature reading${manualCount === 1 ? '' : 's'} for this test?`)) return;
        this.clear();
      });
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
      this.bindManualTemperatures();
      const pasteDate = this.root.querySelector('.paste-test-date');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      pasteDate.value = localDateValue(yesterday);
      this.root.querySelector('.import-paste-button').addEventListener('click', () => this.importPastedTest());
      this.root.querySelector('.bleed-demo-button').addEventListener('click', () => this.loadBleedDemo());
      this.root.querySelector('.paste-clear-button').addEventListener('click', () => {
        this.root.querySelector('.paste-test-input').value = '';
        this.showPasteStatus('');
      });
    }

    connected() { return Boolean(this.port); }

    pressureOffset() {
      return Number(this.root.querySelector('.pressure-offset')?.value) || 0;
    }

    recordedPressure(rawPressure, offset = this.pressureOffset()) {
      const raw = Number(rawPressure);
      if (!Number.isFinite(raw)) return null;
      return Math.abs(raw) <= .5 ? 0 : raw + Number(offset || 0);
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

    restoreTestSetup() {
      if (!this.root.querySelector('.enabled-probes')) {
        const probes = document.createElement('fieldset'); probes.className = 'enabled-probes';
        probes.innerHTML = '<legend>Probes used for this test</legend><p>Unchecked probes are hidden from viewers. Original logger readings are still retained.</p>';
        for (const [key, name] of [['ambient','Ambient'],['pipe','Pipe'],['soil','Soil'],['aux','Auxiliary']]) {
          const label = document.createElement('label'); label.className = 'temp-toggle';
          const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.enabledProbe = key;
          label.append(input, document.createTextNode(name)); probes.append(label);
          input.addEventListener('change', () => {
            this.testState.enabledProbes = [...probes.querySelectorAll('input:checked')].map(el => el.dataset.enabledProbe);
            this.saveTestState(); publish();
          });
        }
        this.temperaturePanel.querySelector('.temperature-controls').before(probes);
      }
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
        maybeRenderHostLog(true);
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
      maybeRenderHostLog(true);
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
      this.root.querySelector('.download-atmos-log').addEventListener('click', () => this.downloadAtmosLog());
      this.root.querySelector('.download-test-backup').addEventListener('click', () => this.downloadTestBackup());
      this.root.querySelector('.restore-test-backup').addEventListener('change', (event) => this.restoreTestBackup(event.target.files[0]));

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
      reopenButton.addEventListener('click', () => this.root.querySelector('.test-design-review').classList.remove('hidden'));
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
      review.classList.remove('hidden');
      this.root.querySelector('.review-saved-design').classList.remove('hidden');
      const warnings = options.warnings || [];
      if (options.applied) {
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
    }

    renderSheetStatus(message = '', state = '') {
      const sheet = this.testState.sheet;
      const panel = this.root.querySelector('.paperwork-sync-panel');
      const status = this.root.querySelector('.sheet-sync-status');
      const create = this.root.querySelector('.create-google-sheet');
      const open = this.root.querySelector('.open-google-sheet');
      const sync = this.root.querySelector('.sync-google-sheet');
      const copy = this.root.querySelector('.sheet-sync-message');
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

    sheetLogRow(at, preferredPressure, comment = '') {
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
      const temperature = this.nearestTemperatureReading(timestamp) || {};
      hostNotes
        .filter((note) => note.slot === this.slot && Math.abs(Number(note.at) - timestamp) <= 7.5 * 60 * 1000)
        .forEach((note) => remarks.push(note.text));
      (this.testState.events || [])
        .filter((event) => ['configuration', 'note'].includes(event.type) && Math.abs(Number(event.at) - timestamp) < 7.5 * 60 * 1000)
        .forEach((event) => remarks.push(event.label));
      return {
        at: timestamp,
        pressure: Number.isFinite(pressure) ? Math.round(pressure) : '',
        ambient: window.HydroWorkflow.number(temperature.ambient) ?? '',
        pipe: window.HydroWorkflow.number(temperature.pipe) ?? '',
        ground: window.HydroWorkflow.number(temperature.soil) ?? '',
        comments: [...new Set(remarks.filter(Boolean))].join(' / '),
      };
    }

    sheetRows() {
      const events = this.testState.events || [];
      const startEvent = [...events].reverse().find((event) => event.type === 'official-start');
      const start = startEvent ? Number(startEvent.at) : this.testState.officialStart ? new Date(this.testState.officialStart).getTime() : 0;
      const endEvent = [...events].reverse().find((event) => event.type === 'official-end');
      let pre = events.filter((event) => ['ramp','note'].includes(event.type) && (!start || Number(event.at) < start)).sort((a,b) => a.at-b.at).map((event) => {
        const label = /^Begin pressurizing/i.test(event.label) ? 'Pressure is at 0 psi / Begin pressurizing' : event.label;
        return this.sheetLogRow(event.at, event.pressure, label);
      });

      const official = [];
      if (start && Date.now() >= start) {
        const times = window.HydroWorkflow.officialTimes({ officialStart: start, officialEnd: endEvent?.at || 0 }, Date.now());
        times.forEach((at, index, all) => {
          const comments = [];
          if (index === 0) comments.push('Begin test');
          if (endEvent && index === all.length - 1) comments.push('End test');
          official.push(this.sheetLogRow(at, null, comments.join(' / ')));
        });
      }

      const post = endEvent ? hostNotes
        .filter((note) => note.slot === this.slot && Number(note.at) > Number(endEvent.at) + 7.5 * 60 * 1000)
        .sort((a, b) => Number(a.at) - Number(b.at))
        .map((note) => this.sheetLogRow(note.at, null, note.text)) : [];
      if (endEvent) events.filter(event => event.at > endEvent.at && ['workflow', 'note'].includes(event.type))
        .forEach(event => post.push(this.sheetLogRow(event.at, event.pressure, event.label)));
      post.sort((a, b) => a.at - b.at);
      return { preTestRows: pre, officialRows: official, postTestRows: post };
    }

    sheetSnapshot() {
      const rows = this.sheetRows();
      window.HydroWorkflow.sheetCapacity(rows);
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
      maybeRenderHostLog(true);
      return imported.length;
    }

    async createGoogleSheet() {
      if (demo?.enabled) return this.showError('Demo mode cannot create or sync Google Sheets.');
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
          createdAt, lastSyncedAt: result.updatedAt || new Date().toISOString(), finalized: false,
        };
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        this.renderSheetStatus(`Created ${result.title}. Future Sheet updates are manual-only; press Sync to Sheet when ready.${importedTemperatures ? ` Imported ${importedTemperatures} temperature row${importedTemperatures === 1 ? '' : 's'}.` : ''}`, 'complete');
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
      if (demo?.enabled) return this.showError('Demo mode cannot create or sync Google Sheets.');
      if (!this.testState.sheet?.spreadsheetId || this.sheetSyncInFlight) return;
      if (!window.confirm('Sync to Google Sheet now? This will rewrite generated Sheet fields, including times, pressures, and comments. Temperatures in columns C–E are preserved when no site value is present. Continue?')) return;
      this.sheetSyncInFlight = true;
      this.renderSheetStatus('Writing the current test values to Google Sheet…', 'working');
      try {
        const snapshot = this.sheetSnapshot();
        const result = await api('sheet_sync', {
          spreadsheet_id: this.testState.sheet.spreadsheetId,
          finalized: false,
          snapshot,
        }, true);
        const importedTemperatures = this.importSheetTemperatures(result.temperatureReadings);
        this.testState.sheet = {
          ...this.testState.sheet, url: result.url || this.testState.sheet.url, title: result.title || this.testState.sheet.title,
          lastSyncedAt: result.updatedAt || new Date().toISOString(), finalized: false,
        };
        localStorage.setItem(`${testStoragePrefix}${this.slot}`, JSON.stringify(this.testState));
        const message = `Synced ${result.officialRowsWritten || 0} official row${result.officialRowsWritten === 1 ? '' : 's'} using the ${this.pressureOffset()} psi offset. Imported ${importedTemperatures} temperature row${importedTemperatures === 1 ? '' : 's'} from the Sheet. Manual-only mode remains on.`;
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
        renderHostNotes(); maybeRenderHostLog(true);
        this.workflowController.hydrate(); this.workflowController.render(true);
        this.workflowController.renderJobs();
        this.workflowController.message('New test ready. Previous job archived under Records → Previous tests. Press Start recording temps when ready.');
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
        return { ...reading, pressure: isZeroBaseline ? 0 : previousRecorded + delta };
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

    nearestTemperatureReading(at, maximumGap = 7.5 * 60 * 1000) {
      const reading = window.TemperatureChartRenderer.nearest(this.temperatureReadings, Number(at));
      const allowedGap = reading?.source === 'live' ? Math.max(30000, (this.temperatureRecordingOptions().sampleIntervalSeconds + 5) * 1000) : maximumGap;
      return reading && Math.abs(Number(reading.at) - Number(at)) <= allowedGap ? reading : null;
    }

    downloadAtmosLog() {
      if (demo?.enabled) return this.showError('Demo records are for practice only; exports are disabled.');
      const startEvent = [...this.testState.events].reverse().find((event) => event.type === 'official-start');
      const endEvent = [...this.testState.events].reverse().find((event) => event.type === 'official-end');
      const start = startEvent ? Number(startEvent.at) : this.testState.officialStart ? new Date(this.testState.officialStart).getTime() : 0;
      const end = endEvent ? Number(endEvent.at) : this.testState.officialEnd ? new Date(this.testState.officialEnd).getTime() : 0;
      const endedByOperator = this.testState.events.some((event) => event.type === 'official-end');
      if (!start || !end || end <= start || !endedByOperator) {
        this.showError('Enter and save the actual test start and end under Records before downloading the Atmos log rows.');
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
        this.showError(`No gauge reading was found within 30 seconds of ${missingTimes.slice(0, 4).join(', ')}${missingTimes.length > 4 ? ` and ${missingTimes.length - 4} more time${missingTimes.length - 4 === 1 ? '' : 's'}` : ''}. The log was not exported.`);
        return;
      }
      if (rows.length > 38) {
        this.showError(`This test needs ${rows.length} log rows, but the locked Atmos form has 38. No rows were omitted.`);
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
      this.showError('');
    }

    downloadTestBackup() {
      if (demo?.enabled) return this.showError('Demo records cannot be exported as a real test backup.');
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

    async restoreTestBackup(file) {
      if (demo?.enabled) return this.showError('Backup imports are disabled in demo mode.');
      if (this.jobTransition || this.connected()) return this.showError('Finish the current operation and disconnect the gauge before restoring.');
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
        maybeRenderHostLog(true);
        this.showError('');
      } catch (error) {
        this.showError(error.message || String(error));
      } finally {
        this.restoringBackup = false;
        this.root.querySelector('.restore-test-backup').value = '';
      }
    }

    renderTestEvents() {
      const body = this.root.querySelector('.test-event-table tbody');
      if (!body) return;
      const events = this.testState.events || [];
      if (!events.length) body.innerHTML = '<tr><td colspan="3" class="event-empty">No entries yet. Add checkpoints or notes from Live pressure whenever you have time.</td></tr>';
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
      maybeRenderHostLog(true);
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
          this.showError(afterReload ? '' : `Gauge reconnected automatically at ${new Date().toLocaleTimeString()}. Readings resumed; the gap stays blank in the record.`);
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
      maybeRenderHostLog();
    }

    updateUi() {
      const latest = this.readings.at(-1);
      const adjustedZero = this.pressureOffset();
      const displayedLow = this.low !== null && Math.abs(this.low - adjustedZero) <= .5 ? 0 : this.low;
      this.root.querySelector('.current-pressure').textContent = latest ? latest.pressure.toFixed(1) : '---.-';
      this.root.querySelector('.current-unit').textContent = latest ? latest.unit : 'PSI';
      const trend = this.root.querySelector('.pressure-trend');
      if (trend) trend.textContent = this.trendText();
      this.root.querySelector('.stat-last').textContent = latest ? new Date(latest.at).toLocaleTimeString() : 'No readings';
      this.root.querySelector('.stat-peak').textContent = this.peak === null ? '—' : `${this.peak.toFixed(1)} psi`;
      this.root.querySelector('.stat-low').textContent = displayedLow === null ? '—' : `${displayedLow.toFixed(1)} psi`;
      this.root.querySelector('.stat-count').textContent = this.readings.length.toLocaleString();
      this.root.querySelector('.download-button').disabled = !this.readings.length;
      this.root.querySelector('.clear-button').disabled = !this.readings.length && !this.temperatureReadings.length;
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
      maybeRenderHostLog(true);
    }

    loadDemo() {
      this.clear();
      const demo = window.TemperatureChartRenderer.demoData();
      this.applyHistoricalTest(demo, { noteKind: 'demo', chartMax: 1100, windowBottom: 1019, windowTop: 1069, visibleKeys: ['pipe'] });
      this.setConnection('Historical field demo • not connected', false);
    }

    loadBleedDemo() {
      this.clear();
      const demo = window.TemperatureChartRenderer.bleedDemoData();
      this.applyHistoricalTest(demo, { noteKind: 'bleed', chartMax: 4400, visibleKeys: ['ambient', 'pipe', 'soil'] });
      this.setConnection('Historical bleed-off demo • not connected', false);
      this.showPasteStatus(`Loaded the attached bleed-off example: ${demo.pressureReadings.length} rows, ${demo.notes.length} operational notes, and an inferred eight-hour test window.`);
    }

    importPastedTest() {
      try {
        const imported = window.TemperatureChartRenderer.parsePastedTest(
          this.root.querySelector('.paste-test-input').value,
          this.root.querySelector('.paste-test-date').value,
        );
        const maximumPressure = imported.pressureReadings.reduce((maximum, reading) => Math.max(maximum, Number(reading.pressure) || 0), 0);
        const chartStep = maximumPressure <= 1200 ? 100 : maximumPressure <= 5000 ? 500 : 1000;
        const chartMax = Math.max(chartStep, Math.ceil(maximumPressure * 1.05 / chartStep) * chartStep);
        this.clear();
        this.applyHistoricalTest(imported, {
          noteKind: 'import',
          chartMax,
          visibleKeys: ['ambient', 'pipe', 'soil'],
        });
        this.setConnection('Pasted historical test • not connected', false);
        const windowMessage = imported.inferredWindow ? 'Official test window found from the remarks.' : 'No official start/end remarks were found, so the graph shows the complete recording.';
        const skippedMessage = imported.skipped ? ` ${imported.skipped} incomplete row${imported.skipped === 1 ? ' was' : 's were'} skipped.` : '';
        this.showPasteStatus(`Imported ${imported.rowCount} rows and ${imported.notes.length} operational notes. ${windowMessage}${skippedMessage}`);
      } catch (error) {
        this.showPasteStatus(error.message || String(error), true);
      }
    }

    applyHistoricalTest(data, options = {}) {
      this.readings = data.pressureReadings;
      this.temperatureReadings = data.temperatureReadings;
      this.root.querySelector('.chart-max').value = String(options.chartMax || this.root.querySelector('.chart-max').value || 1000);
      this.root.querySelector('.live-chart-max').value = this.root.querySelector('.chart-max').value;
      this.root.querySelector('.window-bottom').value = options.windowBottom ?? '';
      this.root.querySelector('.window-top').value = options.windowTop ?? '';
      this.root.querySelector('.test-start').value = data.testStart || '';
      this.root.querySelector('.test-end').value = data.testEnd || '';
      this.testState.officialStart = data.testStart || '';
      this.testState.officialEnd = data.testEnd || '';
      this.peak = this.readings.reduce((maximum, reading) => Math.max(maximum, Number(reading.pressure)), -Infinity);
      this.low = this.readings.reduce((minimum, reading) => Math.min(minimum, Number(reading.pressure)), Infinity);
      const panel = this.temperaturePanel;
      const visibleKeys = options.visibleKeys || ['pipe'];
      panel.querySelectorAll('.temp-toggle input').forEach((input) => { input.checked = visibleKeys.includes(input.value); });
      loadHistoricalNotes(data.notes, this.slot, options.noteKind || 'import');
      this.updateUi();
      this.draw();
      maybeRenderHostLog(true);
    }

    showPasteStatus(message, error = false) {
      const status = this.root.querySelector('.paste-test-status');
      status.textContent = message;
      status.className = `paste-test-status${error ? ' error' : ''}${message ? '' : ' hidden'}`;
    }

    downloadCsv() {
      if (demo?.enabled) return this.showError('Demo records are for practice only; exports are disabled.');
      if (!this.readings.length) return;
      const rows = [['Timestamp UTC', 'Timestamp Local', 'Recorded Pressure', 'Unit', 'Ambient Temperature F', 'Pipe Temperature F', 'Ground Temperature F', 'Auxiliary Temperature F']];
      this.readings.forEach((reading) => {
        const temperature = window.TemperatureChartRenderer.nearest(this.temperatureReadings, Number(reading.at)) || {};
        rows.push([new Date(reading.at).toISOString(), localStamp(new Date(reading.at)), reading.pressure, reading.unit, temperature.ambient ?? '', temperature.pipe ?? '', temperature.soil ?? '', temperature.aux ?? '']);
      });
      const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.settings().name.replace(/[^a-z0-9]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const hostLog = document.getElementById('hostPressureLog');
  const hostLogDescription = document.getElementById('hostLogDescription');
  const notesStorageKey = 'grantg-live-test-notes';
  const notesList = document.getElementById('hostNotesList');
  const noteForm = document.getElementById('hostNoteForm');
  const noteInput = document.getElementById('hostNoteText');
  const noteTest = document.getElementById('hostNoteTest');
  const noteDate = document.getElementById('hostNoteDate');
  const noteTime = document.getElementById('hostNoteTime');
  const noteUseNow = document.getElementById('hostNoteUseNow');
  const clearNotesButton = document.getElementById('clearHostNotes');
  const activeTestLabel = document.getElementById('activeTestLabel');
  const addSecondTestButton = document.getElementById('addSecondTest');
  const hideSecondTestButton = document.getElementById('hideSecondTest');
  const secondTestStorageKey = 'grantg-hydro-second-test-active';
  let secondTestActive = localStorage.getItem(secondTestStorageKey) === 'true';
  let hostLogIntervalMs = 15000;
  let lastHostLogBucket = -1;

  function gaugeFor(slot) { return gauges.find((gauge) => gauge.slot === slot); }

  function setLayout(mode) {
    const allowedMode = mode === 'B' && !secondTestActive ? 'A' : mode === 'both' && !secondTestActive ? 'A' : mode;
    hostGrid.dataset.viewMode = allowedMode;
    document.querySelectorAll('[data-layout-mode]').forEach((item) => item.classList.toggle('active', item.dataset.layoutMode === allowedMode));
    const nameA = gaugeFor('A').settings().name;
    const nameB = gaugeFor('B').settings().name;
    activeTestLabel.textContent = allowedMode === 'both' ? 'Both tests' : allowedMode === 'B' ? nameB : nameA;
    noteTest.value = allowedMode === 'B' ? 'B' : 'A';
    requestAnimationFrame(() => gauges.filter((gauge) => gauge.active).forEach((gauge) => gauge.draw()));
  }

  function applySecondTestUi(focusNewTest = false) {
    gaugeFor('A').setActive(true);
    gaugeFor('B').setActive(secondTestActive);
    app.classList.toggle('second-test-active', secondTestActive);
    document.querySelectorAll('.second-test-control').forEach((control) => control.classList.toggle('hidden', !secondTestActive));
    addSecondTestButton.classList.toggle('hidden', secondTestActive);
    hideSecondTestButton.classList.toggle('hidden', !secondTestActive);
    const secondNoteOption = noteTest.querySelector('option[value="B"]');
    secondNoteOption.hidden = !secondTestActive;
    secondNoteOption.disabled = !secondTestActive;
    const requestedMode = focusNewTest && secondTestActive ? 'B' : hostGrid.dataset.viewMode;
    setLayout(requestedMode);
    lastHostLogBucket = -1;
    maybeRenderHostLog(true);
    renderHostNotes();
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

  function setNoteTimestampNow() {
    const [date, time] = dateTimeInputValue(new Date()).split('T');
    noteDate.value = date;
    noteTime.value = time;
    noteTime.setCustomValidity('');
  }

  function selectedNoteTimestamp() {
    const dateParts = noteDate.value.split('-').map(Number);
    const timeParts = noteTime.value.split(':').map(Number);
    if (dateParts.length !== 3 || timeParts.length < 2 || [...dateParts, ...timeParts].some((value) => !Number.isFinite(value))) return null;
    const selected = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], 0, 0);
    return Number.isFinite(selected.getTime()) ? selected.getTime() : null;
  }

  function renderHostNotes() {
    const fragment = document.createDocumentFragment();
    const visibleNotes = hostNotes.filter((note) => note.slot === 'A' || secondTestActive).sort((a, b) => Number(b.at) - Number(a.at));
    if (!visibleNotes.length) {
      const empty = document.createElement('p');
      empty.className = 'note-empty';
      empty.textContent = 'No notes have been added.';
      fragment.appendChild(empty);
    } else {
      visibleNotes.forEach((note) => {
        const row = document.createElement('article');
        row.className = 'event-note';
        const copy = document.createElement('div');
        const test = document.createElement('strong');
        test.className = 'note-test-name';
        test.textContent = gauges.find((gauge) => gauge.slot === note.slot)?.settings().name || testNameForSlot(note.slot);
        const time = document.createElement('time');
        time.dateTime = new Date(note.at).toISOString();
        time.textContent = new Date(note.at).toLocaleString();
        const text = document.createElement('p');
        text.textContent = note.text;
        copy.append(test, time, text);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ghost note-remove';
        remove.textContent = 'Delete';
        remove.dataset.noteId = note.id;
        row.append(copy, remove);
        fragment.appendChild(row);
      });
    }
    notesList.replaceChildren(fragment);
    clearNotesButton.disabled = !hostNotes.length;
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
    renderHostNotes();
  }

  function loadHistoricalNotes(notes, slot, kind) {
    const prefixes = ['demo', 'bleed', 'import'].map((name) => `${name}-${slot}-`);
    hostNotes = hostNotes.filter((note) => !prefixes.some((prefix) => String(note.id).startsWith(prefix)));
    const prefix = `${kind}-${slot}-`;
    (notes || []).forEach((note) => hostNotes.push({
      id: `${prefix}${note.at}-${note.text}`,
      at: Number(note.at),
      text: String(note.text),
      slot,
    }));
    hostNotes = hostNotes.slice(-200);
    saveHostNotes();
    renderHostNotes();
    gauges.forEach((gauge) => gauge.drawTemperature());
  }

  noteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const selectedGauge = gaugeFor(noteTest.value);
    if (selectedGauge?.jobTransition || (selectedGauge && !selectedGauge.checkJobCurrent())) return;
    const text = noteInput.value.trim();
    if (!text) return;
    const at = selectedNoteTimestamp();
    if (at === null) {
      noteTime.setCustomValidity('Choose the date and time when this event happened.');
      noteTime.reportValidity();
      return;
    }
    noteTime.setCustomValidity('');
    const slot = noteTest.value === 'B' ? 'B' : 'A';
    hostNotes.push({
      id: (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : `${at}-${Math.random().toString(36).slice(2)}`,
      at,
      text: text.slice(0, 500),
      slot,
    });
    hostNotes = hostNotes.slice(-200);
    saveHostNotes();
    renderHostNotes();
    noteInput.value = '';
    setNoteTimestampNow();
    noteInput.focus();
    publish();
  });

  noteUseNow.addEventListener('click', setNoteTimestampNow);

  notesList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-id]');
    if (!button) return;
    const removed = hostNotes.find((note) => note.id === button.dataset.noteId);
    hostNotes = hostNotes.filter((note) => note.id !== button.dataset.noteId);
    saveHostNotes();
    renderHostNotes();
    publish();
  });

  clearNotesButton.addEventListener('click', () => {
    if (!hostNotes.length || !window.confirm('Clear all test notes from this host and the remote viewer?')) return;
    hostNotes = [];
    saveHostNotes();
    renderHostNotes();
    publish();
  });

  setNoteTimestampNow();
  loadHostNotes();

  function maybeRenderHostLog(force = false) {
    const latestRecordingAt = Math.max(0, ...gauges.filter((gauge) => gauge.active).map((gauge) => Number(gauge.readings.at(-1)?.at) || 0));
    const bucket = latestRecordingAt ? Math.floor(latestRecordingAt / hostLogIntervalMs) : -1;
    if (!force && bucket === lastHostLogBucket) return;
    lastHostLogBucket = bucket;
    window.PressureChartRenderer.renderLog(hostLog, {
      A: gauges.find((gauge) => gauge.slot === 'A').readings,
      B: secondTestActive ? gauges.find((gauge) => gauge.slot === 'B').readings : [],
    }, hostLogIntervalMs);
  }

  document.querySelectorAll('[data-host-log-interval]').forEach((button) => {
    button.addEventListener('click', () => {
      hostLogIntervalMs = Number(button.dataset.hostLogInterval) || 15000;
      document.querySelectorAll('[data-host-log-interval]').forEach((item) => item.classList.toggle('active', item === button));
      const label = hostLogIntervalMs === 15000 ? '15 seconds' : hostLogIntervalMs === 60000 ? '1 minute' : hostLogIntervalMs === 300000 ? '5 minutes' : '15 minutes';
      hostLogDescription.textContent = `Every ${label} • newest recording first • chart continues recording every second`;
      lastHostLogBucket = -1;
      maybeRenderHostLog(true);
    });
  });

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
  maybeRenderHostLog(true);
  setInterval(() => maybeRenderHostLog(), 1000);
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

  function renderTemperatureDevices() {
    document.querySelectorAll('[data-gauge]').forEach((root) => {
      const select = root.querySelector('.temperature-device-select');
      if (!select) return;
      const slot = root.dataset.gauge;
      const gauge = gauges.find(g => g.slot === slot);
      const selectedBefore = select.value;
      const attached = temperatureDevices.find((device) => remote && device.session_id === remote.session_id && device.slot === slot
        && (!Array.isArray(gauge.testState.temperatureSourceIds) || gauge.testState.temperatureSourceIds.includes(device.source_id)));
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
        if (changed.size) maybeRenderHostLog(true);
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
  window.addEventListener('beforeunload', () => { if (publishTimer) clearInterval(publishTimer); });
})();
