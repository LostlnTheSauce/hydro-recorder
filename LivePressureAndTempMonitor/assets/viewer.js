(function () {
  'use strict';
  const app = document.getElementById('viewerApp');
  if (!app) return;
  const apiUrl = app.dataset.api;
  const sessionId = app.dataset.sessionId;
  const lock = document.getElementById('viewerLock');
  const dashboard = document.getElementById('viewerDashboard');
  const loginForm = document.getElementById('viewerLogin');
  const loginError = document.getElementById('viewerLoginError');
  const feedError = document.getElementById('viewerFeedError');
  const feedStatus = document.getElementById('feedStatus');
  let password = '';
  let viewerToken = '';
  // Send the password once; afterwards the server's signed token is enough.
  const viewerCredentials = () => viewerToken ? { viewer_token: viewerToken } : { viewer_password: password };
  let lastId = 0;
  let updatedAt = 0;
  let serverClockOffset = 0;
  let pollTimer = null;
  let temperatureTimer = null;
  let temperatureInFlight = false;
  let temperatureCursor = 0;
  const state = { A: { readings: [], liveTemperatures: [], config: {} }, B: { readings: [], liveTemperatures: [], config: {} }, notes: [] };

  const defaults = {
    name: 'Pressure test', chartMax: 1000, traceColor: '#d43b3b', traceThickness: 1, windowThickness: 1,
    windowBottom: '', windowTop: '', warningMargin: 10, testStart: '', testEnd: '', showWindow: true,
    temperature: { channels: window.TemperatureChartRenderer.DEFAULT_CHANNELS, readings: [], preview: true, viewerVisible: false },
  };

  function testNameForSlot(slot) {
    return slot === 'A' ? 'Test 1' : 'Test 2';
  }

  function configFor(slot) {
    return { ...defaults, active: slot === 'A' || state[slot].readings.length > 0, name: testNameForSlot(slot), traceColor: slot === 'A' ? '#d43b3b' : '#9b3ec2', ...state[slot].config };
  }

  function secondTestIsActive() { return configFor('B').active !== false; }

  async function load(first) {
    let more = false;
    if (first) lastId = 0;
    do {
      const response = await fetch(`${apiUrl}?action=view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, ...viewerCredentials(), since_id: lastId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the live test.');
      if (result.viewer_token) viewerToken = result.viewer_token;
      document.getElementById('viewerTitle').textContent = result.title || 'Live pressure tests';
      updatedAt = Number(result.updated_at) || 0;
      serverClockOffset = (Number(result.server_time) || Date.now()) - Date.now();
      state.A.config = result.config && result.config.A ? result.config.A : state.A.config;
      state.B.config = result.config && result.config.B ? result.config.B : state.B.config;
      state.notes = result.config && Array.isArray(result.config.notes) ? result.config.notes : state.notes;
      for (const slot of ['A', 'B']) {
        const current = state[slot];
        current.readings = current.readings.filter(r => r.at >= (Number(current.config.jobStartedAt) || 0));
        current.liveTemperatures = current.liveTemperatures.filter(r => window.HydroJobs.acceptsTemperature(current.config, r));
      }
      (result.readings || []).forEach((row) => {
        if (row.slot !== 'A' && row.slot !== 'B') return;
        if (Number(row.at) < (Number(state[row.slot].config.jobStartedAt) || 0)) return;
        const reading = { at: Number(row.at), pressure: Number(row.pressure), unit: row.unit || 'PSI' };
        if (!Number.isFinite(reading.at) || !Number.isFinite(reading.pressure)) return;
        state[row.slot].readings.push(reading);
      });
      lastId = Math.max(lastId, Number(result.last_id) || 0);
      more = Boolean(result.has_more);
    } while (more);
    state.A.readings = state.A.readings.slice(-100000);
    state.B.readings = state.B.readings.slice(-100000);
    renderGauge('A');
    renderGauge('B');
    updateViewerTestControls();
    updateViewerTemperatureVisibility();
    renderViewerNotes();
    renderPressureLog(first);
    showFeedError('');
    updateFeedStatus();
  }

  function renderGauge(slot, renderTemperature = true) {
    const root = document.querySelector(`[data-view-gauge="${slot}"]`);
    const readings = state[slot].readings;
    const config = configFor(slot);
    root.classList.toggle('inactive-test', config.active === false);
    const latest = readings.at(-1);
    root.querySelector('.viewer-gauge-name').textContent = config.name;
    root.querySelector('.current-pressure').textContent = latest ? latest.pressure.toFixed(1) : '---.-';
    root.querySelector('.current-unit').textContent = latest ? latest.unit : 'PSI';
    root.querySelector('.stat-last').textContent = latest ? new Date(latest.at).toLocaleTimeString() : 'No readings';
    let peak = null;
    let low = null;
    readings.forEach((item) => {
      peak = peak === null ? item.pressure : Math.max(peak, item.pressure);
      low = low === null ? item.pressure : Math.min(low, item.pressure);
    });
    root.querySelector('.stat-peak').textContent = peak === null ? '—' : `${peak.toFixed(1)} psi`;
    root.querySelector('.stat-low').textContent = low === null ? '—' : `${low.toFixed(1)} psi`;
    root.querySelector('.stat-count').textContent = readings.length.toLocaleString();
    window.PressureChartRenderer.draw(root.querySelector('.pressure-chart'), readings, config);
    const temperature = config.temperature && typeof config.temperature === 'object' ? config.temperature : defaults.temperature;
    const enabled = temperature.enabledProbes || ['ambient','pipe','soil','aux'];
    for (const key of ['ambient','pipe','soil','aux']) {
      const toggle = root.querySelector(`.temp-toggle input[value="${key}"]`);
      if (toggle) {
        toggle.disabled = !enabled.includes(key); toggle.closest('label').style.display = toggle.disabled ? 'none' : '';
        if (toggle.disabled) toggle.checked = false;
      }
      for (const node of root.querySelectorAll(`[data-temp-current="${key}"],[data-temp-inspector-value="${key}"]`)) {
        const cell = node.hasAttribute('data-temp-inspector-value') ? node.parentElement : node;
        cell.style.display = enabled.includes(key) ? '' : 'none';
      }
    }
    if (!renderTemperature || temperature.viewerVisible !== true) return;
    const manualTemperatures = Array.isArray(temperature.readings) ? temperature.readings : [];
    const temperatures = [...state[slot].liveTemperatures, ...manualTemperatures].sort((a, b) => Number(a.at) - Number(b.at));
    window.TemperatureChartRenderer.renderPanel(root.querySelector('[data-temperature-panel]'), {
      pressureReadings: readings,
      temperatureReadings: temperatures,
      channels: temperature.channels,
      testStart: config.testStart,
      testEnd: config.testEnd,
      notes: state.notes,
      wholeDegrees: temperature.wholeDegrees === true,
    });
    const temperatureStatus = root.querySelector('.temperature-status');
    if (temperatureStatus) {
      const latestLive = state[slot].liveTemperatures.at(-1);
      if (latestLive) {
        const liveAge = Date.now() - Number(latestLive.at);
        const current = liveAge >= -30000 && liveAge < Math.max(30000, (Number(temperature.sampleIntervalSeconds) || 2) * 2000 + 5000);
        temperatureStatus.textContent = `${current ? 'MadgeTech live' : 'MadgeTech delayed'} · ${new Date(latestLive.at).toLocaleTimeString()}`;
        temperatureStatus.className = current ? 'pill live temperature-status' : 'pill amber temperature-status';
      } else {
        temperatureStatus.textContent = manualTemperatures.length ? 'Manual temperature readings' : 'No temperature data';
        temperatureStatus.className = manualTemperatures.length ? 'pill live temperature-status' : 'pill amber temperature-status';
      }
    }
  }

  async function loadTemperatures() {
    if (!password || temperatureInFlight) return;
    temperatureInFlight = true;
    try {
      let pages = 0;
      let more = false;
      do {
        const response = await fetch('temperature.php?action=view', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, ...viewerCredentials(), since_id: temperatureCursor }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load temperatures.');
        const changed = new Set();
        (result.readings || []).forEach((row) => {
          if (row.slot !== 'A' && row.slot !== 'B') return;
          if (!window.HydroJobs.acceptsTemperature(state[row.slot].config, row)) return;
          const reading = { at: Number(row.at), source: 'live', sourceId: row.source_id };
          ['pipe', 'soil', 'ambient', 'aux'].forEach((key) => {
            if (row[key] !== null && row[key] !== '' && Number.isFinite(Number(row[key]))) reading[key] = Number(row[key]);
          });
          state[row.slot].liveTemperatures.push(reading);
          changed.add(row.slot);
        });
        temperatureCursor = Number(result.last_id) || temperatureCursor;
        changed.forEach((slot) => {
          state[slot].liveTemperatures.sort((a, b) => Number(a.at) - Number(b.at));
          renderGauge(slot);
        });
        more = result.has_more === true;
        pages++;
      } while (more && pages < 4);
      renderGauge('A');
      renderGauge('B');
      renderPressureLog(false);
    } catch (error) {
      showFeedError(`Temperature feed: ${error.message || String(error)}`);
    } finally { temperatureInFlight = false; }
  }

  // Log book per test: pressure plus only the probes the host shares with viewers.
  const viewerLogbooks = {};
  function viewerLogbookData(slot) {
    const config = configFor(slot), temperature = config.temperature || {};
    const enabled = temperature.viewerVisible === true ? temperature.enabledProbes || ['ambient','pipe','soil','aux'] : [];
    const manual = enabled.length && Array.isArray(temperature.readings) ? temperature.readings : [];
    const live = state[slot].liveTemperatures;
    const key = `${live.length}:${live.at(-1)?.at}:${manual.length}:${manual.at(-1)?.at}`;
    if (state[slot].logbookCache?.key !== key || state[slot].logbookCache.live !== live) {
      const temperatures = [...live, ...manual].sort((a, b) => Number(a.at) - Number(b.at));
      const present = new Set(['ambient','pipe','soil','aux'].filter(name => temperatures.some(row => row[name] !== null && row[name] !== '' && row[name] !== undefined && Number.isFinite(Number(row[name])))));
      state[slot].logbookCache = { key, live, temperatures, present };
    }
    const names = Array.isArray(temperature.channels) ? temperature.channels : [];
    const channels = TemperatureChartRenderer.DEFAULT_CHANNELS
      .filter(channel => enabled.includes(channel.key) && state[slot].logbookCache.present.has(channel.key))
      .map(channel => ({ key: channel.key, name: names.find(item => item.key === channel.key)?.name || channel.name }));
    return { pressure: state[slot].readings, temperatures: enabled.length ? state[slot].logbookCache.temperatures : [], channels, wholeDegrees: temperature.wholeDegrees === true };
  }

  function renderPressureLog(force = false) {
    if (!window.HydroLogbook) return;
    for (const slot of ['A', 'B']) {
      const container = document.querySelector(`[data-viewer-logbook="${slot}"]`);
      if (!container) continue;
      if (!viewerLogbooks[slot]) viewerLogbooks[slot] = window.HydroLogbook.mount(container, { getData: () => viewerLogbookData(slot), storageKey: 'grantg-viewer-logbook-interval' });
      container.querySelector('.logbook-header h3').textContent = `${configFor(slot).name} log book`;
      viewerLogbooks[slot].refresh(force);
    }
  }

  function renderViewerNotes() {
    const list = document.getElementById('viewerNotesList');
    const notes = (state.notes || []).filter((note) => note && Number.isFinite(Number(note.at)) && String(note.text || '').trim()).slice(-200).reverse();
    const fragment = document.createDocumentFragment();
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'note-empty';
      empty.textContent = 'No notes have been added.';
      fragment.appendChild(empty);
    } else {
      notes.forEach((note) => {
        const row = document.createElement('article');
        row.className = 'event-note';
        const time = document.createElement('time');
        time.dateTime = new Date(Number(note.at)).toISOString();
        time.textContent = new Date(Number(note.at)).toLocaleString();
        const text = document.createElement('p');
        text.textContent = String(note.text);
        row.append(time, text);
        fragment.appendChild(row);
      });
    }
    list.replaceChildren(fragment);
  }

  function updateFeedStatus() {
    const now = Date.now() + serverClockOffset;
    const age = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : Infinity;
    if (age <= 12) {
      feedStatus.textContent = 'Live';
      feedStatus.className = 'pill live';
    } else if (age <= 60) {
      feedStatus.textContent = `${age}s behind`;
      feedStatus.className = 'pill amber';
    } else {
      feedStatus.textContent = updatedAt ? `Last update ${new Date(updatedAt).toLocaleTimeString()}` : 'Waiting for host';
      feedStatus.className = 'pill stale';
    }
  }

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.toggle('hidden', !message);
  }

  function showFeedError(message) {
    feedError.textContent = message ? `Connection interrupted: ${message}. This page will keep retrying.` : '';
    feedError.classList.toggle('hidden', !message);
  }

  function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    if (temperatureTimer) clearInterval(temperatureTimer);
    const poll = async () => {
      try { await load(false); }
      catch (error) { showFeedError(error.message || String(error)); }
      pollTimer = setTimeout(poll, 1000);
    };
    pollTimer = setTimeout(poll, 1000);
    loadTemperatures();
    temperatureTimer = setInterval(loadTemperatures, 3000);
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    password = document.getElementById('viewerLoginPassword').value;
    viewerToken = '';
    showLoginError('');
    try {
      lastId = 0;
      state.A.readings = [];
      state.B.readings = [];
      state.A.liveTemperatures = [];
      state.B.liveTemperatures = [];
      temperatureCursor = 0;
      state.notes = [];
      await load(true);
      lock.classList.add('hidden');
      dashboard.classList.remove('hidden');
      startPolling();
    } catch (error) { showLoginError(error.message || String(error)); }
  });

  setInterval(updateFeedStatus, 1000);

  const viewerGrid = document.getElementById('viewerGaugeGrid');

  function setViewerLayout(mode) {
    const allowedMode = !secondTestIsActive() && mode !== 'A' ? 'A' : mode;
    viewerGrid.dataset.viewMode = allowedMode;
    document.querySelectorAll('[data-layout-mode]').forEach((item) => item.classList.toggle('active', item.dataset.layoutMode === allowedMode));
    requestAnimationFrame(() => {
      renderGauge('A');
      if (secondTestIsActive()) renderGauge('B');
    });
  }

  function updateViewerTestControls() {
    const active = secondTestIsActive();
    dashboard.classList.toggle('second-test-active', active);
    document.querySelectorAll('.second-test-control').forEach((control) => control.classList.toggle('hidden', !active));
    setViewerLayout(viewerGrid.dataset.viewMode);
  }

  function viewerTemperaturesAreVisible() {
    return ['A', 'B'].some((slot) => configFor(slot).temperature?.viewerVisible === true);
  }

  function updateViewerTemperatureVisibility() {
    const visible = viewerTemperaturesAreVisible();
    const button = dashboard.querySelector('[data-dashboard-tab="temperature"]');
    button.classList.toggle('hidden', !visible);
    if (!visible && dashboard.dataset.dashboardView === 'temperature') setViewerDashboard('pressure');
  }

  function setViewerDashboard(view) {
    const selected = view === 'temperature' && !viewerTemperaturesAreVisible() ? 'pressure' : view;
    dashboard.dataset.dashboardView = selected;
    dashboard.querySelectorAll('[data-dashboard-tab]').forEach((item) => item.classList.toggle('active', item.dataset.dashboardTab === selected));
    requestAnimationFrame(() => {
      renderGauge('A');
      renderGauge('B');
    });
  }
  document.querySelectorAll('[data-view-gauge]').forEach((root) => {
    window.TemperatureChartRenderer.bindPanel(root.querySelector('[data-temperature-panel]'), () => renderGauge(root.dataset.viewGauge));
  });
  document.querySelectorAll('[data-layout-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setViewerLayout(button.dataset.layoutMode);
    });
  });
  dashboard.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      setViewerDashboard(button.dataset.dashboardTab);
    });
  });
})();
