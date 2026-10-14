(function () {
  'use strict';

  const DEFAULT_CHANNELS = [
    { key: 'ambient', name: 'Ambient', color: '#3f7fbe' },
    { key: 'pipe', name: 'Pipe', color: '#e07832' },
    { key: 'soil', name: 'Soil', color: '#77624c' },
    { key: 'aux', name: 'Auxiliary', color: '#8a55ae' },
  ];

  function channels(input) {
    const supplied = Array.isArray(input) ? input : [];
    return DEFAULT_CHANNELS.map((fallback) => {
      const match = supplied.find((item) => item && item.key === fallback.key) || {};
      return {
        key: fallback.key,
        name: String(match.name || fallback.name).trim().slice(0, 30) || fallback.name,
        color: /^#[0-9a-f]{6}$/i.test(String(match.color || '')) ? match.color : fallback.color,
      };
    });
  }

  function validNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function period(startValue, endValue) {
    if (!startValue) return null;
    const start = new Date(startValue).getTime();
    // An actual end may be entered later; do not hide the known start meanwhile.
    if (!endValue) return Number.isFinite(start) ? { start, end: Infinity } : null;
    let end = new Date(endValue).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    while (end <= start) end += 86400000;
    return { start, end };
  }

  function nearest(readings, timestamp) {
    if (!readings.length) return null;
    let low = 0;
    let high = readings.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Number(readings[middle].at) < timestamp) low = middle + 1;
      else high = middle;
    }
    const current = readings[low];
    const previous = low > 0 ? readings[low - 1] : null;
    if (!previous) return current;
    return Math.abs(Number(previous.at) - timestamp) <= Math.abs(Number(current.at) - timestamp) ? previous : current;
  }

  // Round axis steps (1, 2, 2.5, 5 × 10ⁿ) on the chart's five shared gridlines,
  // so labels read 1,000.0 / 1,000.5 rather than 1,119.8, and never go below zero psi.
  function niceStep(rough) {
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  }

  function niceScale(values, minimumSpan, { floorAtZero = false, wholeSteps = false } = {}) {
    let minimum = Infinity;
    let maximum = -Infinity;
    values.forEach((value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      minimum = Math.min(minimum, number);
      maximum = Math.max(maximum, number);
    });
    if (!Number.isFinite(minimum)) return { min: 0, max: 5, decimals: 0 };
    let low = minimum, high = maximum;
    if (high - low < minimumSpan) { const middle = (low + high) / 2; low = middle - minimumSpan / 2; high = middle + minimumSpan / 2; }
    const padding = (high - low) * .06;
    low -= padding; high += padding;
    // A gauge reading a few psi below zero after a bleed-off still gets a 0 baseline.
    const keepPositive = floorAtZero && minimum >= -0.02 * Math.max(1, maximum);
    if (keepPositive) low = Math.max(0, low);
    let step = niceStep((high - low) / 5);
    if (wholeSteps) step = Math.max(1, step);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let start = Math.floor(low / step + 1e-9) * step;
      if (keepPositive) start = Math.max(0, start);
      if (start + 5 * step >= high - 1e-9) {
        const decimals = (String(Number(step.toPrecision(6))).split('.')[1] || '').length;
        return { min: start, max: start + 5 * step, decimals };
      }
      step = niceStep(step * 1.01);
    }
    return { min: low, max: high, decimals: 1 };
  }

  function chartHeight(canvas) {
    return canvas.closest('.temp-chart-dialog[open]') ? Math.max(240, canvas.getBoundingClientRect().height) : 330;
  }

  function canvasContext(canvas) {
    const width = Math.max(240, canvas.getBoundingClientRect().width || 900);
    const height = chartHeight(canvas);
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fffef9';
    context.fillRect(0, 0, width, height);
    return { context, width, height };
  }

  function line(context, points, color, width) {
    if (points.length < 2) return;
    const stride = Math.max(1, Math.ceil(points.length / 1800));
    context.beginPath();
    points.forEach((point, index) => {
      if (index % stride && index !== points.length - 1) return;
      if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();
  }

  function sampledPoints(items, mapper, maximumPoints = 1800) {
    if (!items.length) return [];
    const points = [];
    const stride = Math.max(1, Math.ceil(items.length / maximumPoints));
    for (let index = 0; index < items.length; index += stride) {
      const point = mapper(items[index]);
      if (point) points.push(point);
    }
    const lastIndex = items.length - 1;
    if (lastIndex % stride !== 0) {
      const lastPoint = mapper(items[lastIndex]);
      if (lastPoint) points.push(lastPoint);
    }
    return points;
  }

  function recordingLine(context, items, mapper, color, width, gap) {
    if (!gap) { line(context, sampledPoints(items, mapper), color, width); return; }
    let start = 0;
    for (let i = 1; i <= items.length; i++) {
      if (i === items.length || items[i].at - items[i-1].at > gap) {
        line(context, sampledPoints(items.slice(start, i), mapper), color, width); start = i;
      }
    }
  }

  // Snap to the closest pressure or temperature reading. Temperatures keep
  // arriving from the field laptop after the host page (and its gauge) closes,
  // so Live must follow whichever feed is newest, not pressure alone.
  function nearestEither(meta, at) {
    const pressure = nearest(meta.pressure, at);
    const temperature = nearest(meta.temperatures, at);
    if (!pressure) return temperature;
    if (!temperature) return pressure;
    return Math.abs(Number(temperature.at) - at) < Math.abs(Number(pressure.at) - at) ? temperature : pressure;
  }

  function updateMetaSelection(meta, requestedAt) {
    const targetAt = Number.isFinite(Number(requestedAt)) ? Math.max(meta.start, Math.min(meta.end, Number(requestedAt))) : meta.end;
    const anchor = nearestEither(meta, targetAt);
    meta.selectedAt = meta.replay ? targetAt : Math.max(meta.start, Math.min(meta.end, Number(anchor?.at) || targetAt));
    meta.selectedPressure = nearest(meta.pressure, meta.selectedAt);
    meta.selectedTemperature = nearest(meta.temperatures, meta.selectedAt);
    if (meta.gapLimits) {
      if (Math.abs((meta.selectedPressure?.at ?? Infinity)-meta.selectedAt) > meta.gapLimits.pressure) meta.selectedPressure = null;
      if (Math.abs((meta.selectedTemperature?.at ?? Infinity)-meta.selectedAt) > meta.gapLimits.temperature) meta.selectedTemperature = null;
    }
  }

  function selectionCanvasContext(canvas) {
    const width = Math.max(240, canvas.getBoundingClientRect().width || 900);
    const height = chartHeight(canvas);
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function drawSelectionOverlay(canvas, meta) {
    if (!canvas) return;
    const { context } = selectionCanvasContext(canvas);
    if (!meta) return;
    const selectedX = meta.box.left + (meta.selectedAt - meta.start) / Math.max(1, meta.end - meta.start) * (meta.box.right - meta.box.left);
    context.beginPath();
    context.moveTo(selectedX, meta.box.top);
    context.lineTo(selectedX, meta.box.bottom);
    context.setLineDash([5, 4]);
    context.strokeStyle = 'rgba(16, 54, 77, .78)';
    context.lineWidth = 1.3;
    context.stroke();
    context.setLineDash([]);
  }

  function chartFrame(context, width, height, leftLabel, rightLabel) {
    // Phones get slimmer side margins; with no pressure axis the left side only needs a small gap.
    const narrow = width < 500;
    const box = { left: leftLabel ? (narrow ? 44 : 58) : (narrow ? 10 : 58), right: width - (narrow ? 44 : 56), top: 28, bottom: height - 42 };
    context.font = '700 11px system-ui';
    context.fillStyle = '#607686';
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillText(leftLabel, box.left, 13);
    context.textAlign = 'right';
    context.fillText(rightLabel, box.right, 13);
    for (let index = 0; index <= 5; index += 1) {
      const y = box.top + (box.bottom - box.top) * index / 5;
      context.beginPath();
      context.moveTo(box.left, y);
      context.lineTo(box.right, y);
      context.strokeStyle = index === 5 ? '#9bb0bc' : '#dce6eb';
      context.lineWidth = index === 5 ? 1 : .7;
      context.stroke();
    }
    return box;
  }

  function drawEmpty(context, width, height, message) {
    context.fillStyle = '#718594';
    context.font = '700 13px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, width / 2, height / 2);
  }

  function drawTimeline(canvas, options) {
    const { context, width, height } = canvasContext(canvas);
    let pressure = options.pressureReadings;
    let temperatures = options.temperatureReadings;
    let earliestAt = Infinity;
    let latestAt = -Infinity;
    pressure.forEach((item) => {
      const at = Number(item.at);
      if (!Number.isFinite(at)) return;
      earliestAt = Math.min(earliestAt, at);
      latestAt = Math.max(latestAt, at);
    });
    temperatures.forEach((item) => {
      const at = Number(item.at);
      if (!Number.isFinite(at)) return;
      earliestAt = Math.min(earliestAt, at);
      latestAt = Math.max(latestAt, at);
    });
    if (!Number.isFinite(earliestAt) || !Number.isFinite(latestAt)) {
      drawEmpty(context, width, height, 'No temperature readings in this time range yet.');
      canvas._temperatureMeta = null;
      return;
    }
    let start = earliestAt;
    let end = latestAt;
    if (options.officialOnly && options.testPeriod) {
      start = Math.max(start, options.testPeriod.start);
      end = Math.min(end, options.testPeriod.end);
    }
    if (options.historyRange === 'pretest' && options.testPeriod) end = Math.min(end, options.testPeriod.start - 1);
    if (options.historyRange === 'recent') start = Math.max(start, end - 6 * 3600000);
    if (options.historyRange === 'official' && !options.testPeriod) {
      drawEmpty(context, width, height, 'Start the official test to view this period.');
      canvas._temperatureMeta = null;
      return;
    }
    if (end < start) {
      drawEmpty(context, width, height, 'No readings in this period.');
      canvas._temperatureMeta = null;
      return;
    }
    if (end - start < 60000) end = start + 60000;
    const fullStart = start, fullEnd = end;
    const zoom = clampZoom(options.zoom, fullStart, fullEnd);
    if (zoom) { start = zoom.start; end = zoom.end; }
    pressure = pressure.filter((item) => item.at >= start && item.at <= end);
    temperatures = temperatures.filter((item) => item.at >= start && item.at <= end);
    const temperatureValues = [];
    options.visibleKeys.forEach((key) => temperatures.forEach((item) => {
      const value = validNumber(item[key]);
      if (value !== null) temperatureValues.push(value);
    }));
    const pressureScale = niceScale(pressure.map((item) => item.pressure), 2, { floorAtZero: true });
    const temperatureScale = niceScale(temperatureValues, 4, { wholeSteps: options.wholeDegrees });
    const { min: pressureMin, max: pressureMax } = pressureScale;
    const { min: temperatureMin, max: temperatureMax } = temperatureScale;
    const showTemperatureScale = options.visibleKeys.length > 0;
    const showPressure = options.showPressure !== false;
    const box = chartFrame(context, width, height, showPressure ? 'PRESSURE (PSI)' : '', showTemperatureScale ? 'TEMPERATURE (°F)' : '');
    const x = (value) => box.left + (value - start) / (end - start) * (box.right - box.left);
    const pressureY = (value) => box.bottom - (value - pressureMin) / (pressureMax - pressureMin) * (box.bottom - box.top);
    const temperatureY = (value) => box.bottom - (value - temperatureMin) / (temperatureMax - temperatureMin) * (box.bottom - box.top);

    context.font = '600 12px system-ui';
    context.textBaseline = 'middle';
    for (let index = 0; index <= 5; index += 1) {
      const y = box.top + (box.bottom - box.top) * index / 5;
      context.fillStyle = '#b43b3b';
      context.textAlign = 'right';
      if (showPressure) context.fillText((pressureMax - (pressureMax - pressureMin) * index / 5).toLocaleString(undefined, { minimumFractionDigits: pressureScale.decimals, maximumFractionDigits: pressureScale.decimals }), box.left - 7, y);
      if (showTemperatureScale) {
        context.fillStyle = '#526b7f';
        context.textAlign = 'left';
        context.fillText(`${(temperatureMax - (temperatureMax - temperatureMin) * index / 5).toFixed(temperatureScale.decimals)}°`, box.right + 7, y);
      }
    }
    const timeTicks = width < 500 ? 2 : 4;
    for (let index = 0; index <= timeTicks; index += 1) {
      const at = start + (end - start) * index / timeTicks;
      const px = x(at);
      context.fillStyle = '#526b7f';
      context.textAlign = index === 0 ? 'left' : index === timeTicks ? 'right' : 'center';
      context.textBaseline = 'top';
      context.fillText(new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...((end - start) < 300000 ? { second: '2-digit' } : {}) }), px, box.bottom + 10);
    }

    (options.notes || []).filter((note) => note.at >= start && note.at <= end).slice(-40).forEach((note, index) => {
      const px = x(Number(note.at));
      context.beginPath();
      context.moveTo(px, box.top);
      context.lineTo(px, box.bottom);
      context.setLineDash([4, 4]);
      context.strokeStyle = 'rgba(90,65,126,.52)';
      context.lineWidth = 1;
      context.stroke();
      context.setLineDash([]);
      const label = String(note.text || '').slice(0, 28);
      if (label) {
        context.save();
        const nearRight = px > box.left + (box.right - box.left) * .75;
        context.translate(px + (nearRight ? -4 : 4), box.top + 7 + (index % 4) * 11);
        context.fillStyle = '#695080';
        context.font = '700 8px system-ui';
        context.textAlign = nearRight ? 'right' : 'left';
        context.textBaseline = 'top';
        context.fillText(label, 0, 0);
        context.restore();
      }
    });

    if (showPressure) recordingLine(context, pressure, (item) => ({ x: x(Number(item.at)), y: pressureY(Number(item.pressure)) }), '#c83d3d', 2.2, options.gapLimits?.pressure);
    options.channelConfig.forEach((channel) => {
      if (!options.visibleKeys.includes(channel.key)) return;
      recordingLine(context, temperatures.filter(item => validNumber(item[channel.key]) !== null), (item) => {
        const value = validNumber(item[channel.key]);
        return value === null ? null : { x: x(Number(item.at)), y: temperatureY(value) };
      }, channel.color, 2, options.gapLimits?.temperature);
    });

    const hasSelectedAt = options.selectedAt !== null && options.selectedAt !== undefined && Number.isFinite(Number(options.selectedAt));
    const meta = {
      box, height, start, end, fullStart, fullEnd, zoomed: Boolean(zoom), pressure, temperatures, channelConfig: options.channelConfig, visibleKeys: options.visibleKeys,
      pressureMin, pressureMax, temperatureMin, temperatureMax, showPressure,
      wholeDegrees: options.wholeDegrees === true, replay: options.replay === true, gapLimits: options.gapLimits,
    };
    updateMetaSelection(meta, hasSelectedAt ? options.selectedAt : end);
    canvas._temperatureMeta = meta;
  }

  function setPanelText(panel, selector, value) {
    const element = panel.querySelector(selector);
    if (element) element.textContent = value;
  }

  function inspectorTime(timestamp, includeDate = false) {
    if (!Number.isFinite(Number(timestamp))) return '—';
    const options = { hour: 'numeric', minute: '2-digit', second: '2-digit' };
    if (includeDate) Object.assign(options, { month: 'numeric', day: 'numeric', year: 'numeric' });
    return new Date(Number(timestamp)).toLocaleString([], options);
  }

  function updateInspector(panel, canvas, channelConfig, state) {
    const meta = canvas._temperatureMeta;
    const scrubber = panel.querySelector('.temp-scrubber');
    const returnLive = panel.querySelector('.temp-return-live');
    if (!meta) {
      if (scrubber) { scrubber.disabled = true; scrubber.value = '1000'; }
      if (returnLive) returnLive.disabled = true;
      setPanelText(panel, '.temp-inspector-time', 'Waiting for readings');
      setPanelText(panel, '.temp-inspector-pressure', '—');
      channelConfig.forEach((channel) => setPanelText(panel, `[data-temp-inspector-value="${channel.key}"]`, '—'));
      setPanelText(panel, '.temp-scrubber-start', '—');
      setPanelText(panel, '.temp-scrubber-end', 'Live');
      return;
    }
    if (scrubber) {
      const span = Math.max(1, meta.end - meta.start);
      scrubber.disabled = false;
      scrubber.value = state.followLive ? scrubber.max : String(Math.round((meta.selectedAt - meta.start) / span * Number(scrubber.max)));
      scrubber.setAttribute('aria-valuetext', `${state.followLive ? 'Live, ' : ''}${inspectorTime(meta.selectedAt, true)}`);
    }
    if (!state.followLive) state.at = meta.selectedAt;
    if (returnLive) returnLive.disabled = state.followLive;
    setPanelText(panel, '.temp-inspector-time', `${state.followLive ? 'Live • ' : ''}${inspectorTime(meta.selectedAt, true)}`);
    setPanelText(panel, '.temp-inspector-pressure', meta.selectedPressure ? `${Number(meta.selectedPressure.pressure).toFixed(1)} PSI` : '—');
    channelConfig.forEach((channel) => {
      const value = meta.selectedTemperature ? validNumber(meta.selectedTemperature[channel.key]) : null;
      setPanelText(panel, `[data-temp-inspector-value="${channel.key}"]`, value === null ? '—' : `${value.toFixed(meta.wholeDegrees ? 0 : 1)}°F`);
    });
    setPanelText(panel, '.temp-scrubber-start', inspectorTime(meta.start));
    setPanelText(panel, '.temp-scrubber-end', `${meta.zoomed || meta.replay ? '' : 'Live '}${inspectorTime(meta.end)}`);
  }

  function refreshSelection(panel, state, channelConfig) {
    const canvas = panel.querySelector('.temperature-chart');
    const overlay = panel.querySelector('.temperature-selection-overlay');
    const meta = canvas?._temperatureMeta || null;
    if (meta) updateMetaSelection(meta, state.followLive ? meta.end : state.at);
    drawSelectionOverlay(overlay, meta);
    updateInspector(panel, canvas, channelConfig || meta?.channelConfig || DEFAULT_CHANNELS, state);
  }

  // Optional round recorder chart (0–150 °F, last 24 hours) for the pipe, soil
  // and ambient probes, all on one chart or one chart each, drawn only while
  // its section is open. Unplugged probes read about -300 °F; those readings
  // leave a gap here and stay in the log.
  const ROUND_KEYS = ['ambient', 'pipe', 'soil'];
  const ROUND_MAX = 150;
  function drawRoundChart(panel, readings, channelConfig) {
    const section = panel.querySelector('.temperature-round-panel');
    if (!section || !section.open || !window.PressureChartRenderer) return;
    const separate = section.querySelector('.temperature-round-select')?.value === 'separate';
    const keys = ROUND_KEYS.filter((key) => !panel.querySelector(`.temp-toggle input[value="${key}"]`)?.disabled);
    const sorted = [...readings].sort((a, b) => Number(a.at) - Number(b.at));
    const end = sorted.length ? Number(sorted.at(-1).at) : Date.now();
    const recent = [];
    let lastKept = -Infinity;
    sorted.forEach((reading) => {
      const at = Number(reading.at);
      if (at < end - 86400000 || at - lastKept < 30000) return;
      recent.push(reading);
      lastKept = at;
    });
    const shown = channelConfig.filter((channel) => keys.includes(channel.key));
    const trace = (channel) => ({
      color: channel.color,
      readings: recent.map((reading) => {
        const value = validNumber(reading[channel.key]);
        return { at: reading.at, value: value === null || value < -50 ? null : value };
      }),
    });
    const draw = (key, title, zoomName, list) => {
      const wrap = section.querySelector(`.chart-wrap[data-round-key="${key}"]`);
      if (!wrap) return;
      wrap.hidden = !list;
      if (!list) return;
      window.PressureChartRenderer.draw(wrap.querySelector('canvas'), [], {
        chartMax: ROUND_MAX,
        gridStep: 10,
        title,
        scaleLabel: `0–${ROUND_MAX} °F`,
        zoomName,
        traceThickness: 1.6,
        legend: list,
        traces: list.map(trace),
      });
    };
    draw('all', 'TEMPERATURE RECORDER', 'temperature chart', separate ? null : shown);
    ROUND_KEYS.forEach((key) => {
      const channel = shown.find((item) => item.key === key);
      draw(key, `${String(channel?.name || key).slice(0, 18).toUpperCase()} TEMPERATURE`, `${channel?.name || key} temperature chart`, separate && channel ? [channel] : null);
    });
  }

  // Display-only smoothing for electrical noise (a laptop charger on a generator
  // makes the logger jitter). Each logger reading is shown as the trimmed mean
  // of that probe's readings over the preceding window: the highest and lowest
  // fifth are dropped so a single spike cannot pull the line. Manual and Sheet
  // entries stay as entered. Stored readings, exports and the Sheet are untouched.
  const smoothCache = new WeakMap();
  function smoothReadings(readings, seconds) {
    const windowMs = Math.max(0, Number(seconds) || 0) * 1000;
    if (!windowMs || !Array.isArray(readings) || readings.length < 2) return readings;
    const key = `${windowMs}:${readings.length}:${readings[0]?.at}:${readings.at(-1)?.at}`;
    const cached = smoothCache.get(readings);
    if (cached?.key === key) return cached.result;
    const result = readings.map((row) => ({ ...row }));
    const smoothable = (row) => row && row.source !== 'manual' && row.source !== 'sheet';
    for (const channel of DEFAULT_CHANNELS) {
      const points = [];
      readings.forEach((row, index) => {
        const value = smoothable(row) ? validNumber(row[channel.key]) : null;
        if (value !== null) points.push({ index, at: Number(row.at), value });
      });
      points.sort((a, b) => a.at - b.at);
      let first = 0;
      points.forEach((point, i) => {
        while (points[first].at < point.at - windowMs) first++;
        const values = points.slice(first, i + 1).map((item) => item.value).sort((a, b) => a - b);
        const trim = values.length >= 5 ? Math.floor(values.length / 5) : 0;
        const kept = values.slice(trim, values.length - trim);
        result[point.index][channel.key] = Math.round(kept.reduce((sum, value) => sum + value, 0) / kept.length * 100) / 100;
      });
    }
    smoothCache.set(readings, { key, result });
    return result;
  }

  function renderPanel(panel, options) {
    if (!panel) return;
    const channelConfig = channels(options.channels);
    const smoothingControl = panel.querySelector('.temp-smoothing');
    const smoothingSeconds = smoothingControl ? Number(smoothingControl.value) || 0 : Number(options.smoothingSeconds) || 0;
    const temperatureReadings = smoothReadings(Array.isArray(options.temperatureReadings) ? options.temperatureReadings.filter((item) => item && Number.isFinite(Number(item.at))) : [], smoothingSeconds);
    const pressureReadings = Array.isArray(options.pressureReadings) ? options.pressureReadings.filter((item) => item && Number.isFinite(Number(item.at)) && Number.isFinite(Number(item.pressure))) : [];
    const latest = temperatureReadings.at(-1) || {};
    channelConfig.forEach((channel) => {
      panel.querySelectorAll(`[data-temp-label="${channel.key}"]`).forEach((element) => { element.textContent = channel.name; });
      const value = validNumber(latest[channel.key]);
      setPanelText(panel, `[data-temp-value="${channel.key}"]`, value === null ? '—' : value.toFixed(options.wholeDegrees ? 0 : 1));
      const current = panel.querySelector(`[data-temp-current="${channel.key}"]`);
      if (current) current.classList.toggle('inactive', value === null);
    });
    const visibleKeys = Array.from(panel.querySelectorAll('.temp-toggle input:checked')).map((input) => input.value).filter((key) => channelConfig.some((channel) => channel.key === key));
    const testPeriod = period(options.testStart, options.testEnd);
    const canvas = panel.querySelector('.temperature-chart');
    const selectionState = panel._temperatureSelection || { followLive: true, at: null };
    if (options.replay && selectionState.followLive) { selectionState.followLive = false; selectionState.at = null; }
    panel._temperatureSelection = selectionState;
    const chartOptions = {
      pressureReadings,
      showPressure: panel.querySelector('.temp-pressure-toggle')?.checked !== false,
      temperatureReadings,
      channelConfig,
      visibleKeys,
      testPeriod,
      historyRange: panel.querySelector('.temp-history-range')?.value,
      officialOnly: panel.querySelector('.temp-history-range') ? panel.querySelector('.temp-history-range').value === 'official' : panel.querySelector('.temp-official-only')?.checked !== false,
      notes: panel.querySelector('.temp-show-notes')?.checked ? (options.notes || []) : [],
      selectedAt: selectionState.followLive ? null : selectionState.at,
      wholeDegrees: options.wholeDegrees === true,
      zoom: panel._temperatureZoom,
      replay: options.replay === true, gapLimits: options.gapLimits,
    };
    drawTimeline(canvas, chartOptions);
    drawRoundChart(panel, temperatureReadings, channelConfig);
    updateZoomControls(panel, canvas._temperatureMeta);
    refreshSelection(panel, selectionState, channelConfig);
  }

  function bindPanel(panel, onChange) {
    if (!panel || panel.dataset.temperatureBound === 'true') return;
    panel.dataset.temperatureBound = 'true';
    bindZoom(panel, onChange);
    panel.querySelector('.temperature-round-panel')?.addEventListener('toggle', () => onChange());
    const roundMode = panel.querySelector('.temperature-round-select');
    if (roundMode) {
      try { if (localStorage.getItem('grantg-round-temp-mode') === 'separate') roundMode.value = 'separate'; } catch (_) {}
      roundMode.addEventListener('change', () => {
        try { localStorage.setItem('grantg-round-temp-mode', roundMode.value); } catch (_) {}
        onChange();
      });
    }
    panel.querySelectorAll('.temp-toggle input,.temp-official-only,.temp-show-notes,.temp-history-range,.temp-smoothing').forEach((input) => input.addEventListener('change', () => {
      if (input.matches('.temp-history-range,.temp-official-only')) {
        panel._temperatureZoom = null;
        panel._temperatureSelection = { followLive: true, at: null };
      }
      onChange();
    }));
    const scrubber = panel.querySelector('.temp-scrubber');
    let scrubberFrame = null;
    if (scrubber) scrubber.addEventListener('input', () => {
      const meta = panel.querySelector('.temperature-chart')._temperatureMeta;
      if (!meta) return;
      const value = Number(scrubber.value);
      const maximum = Math.max(1, Number(scrubber.max));
      const state = panel._temperatureSelection || { followLive: true, at: null };
      state.followLive = value >= maximum && !meta.zoomed && !meta.replay;
      const requestedAt = meta.start + value / maximum * (meta.end - meta.start);
      const anchor = nearestEither(meta, requestedAt);
      state.at = meta.replay ? requestedAt : Number(anchor?.at) || requestedAt;
      panel._temperatureSelection = state;
      if (scrubberFrame !== null) return;
      scrubberFrame = window.setTimeout(() => {
        scrubberFrame = null;
        refreshSelection(panel, state);
      }, 32);
    });
    const returnLive = panel.querySelector('.temp-return-live');
    if (returnLive) returnLive.addEventListener('click', () => {
      panel._temperatureZoom = null;
      panel._temperatureSelection = { followLive: true, at: null };
      onChange();
    });
    const canvas = panel.querySelector('.temperature-chart');
    const tooltip = panel.querySelector('.temperature-tooltip');
    canvas.addEventListener('pointermove', (event) => {
      const meta = canvas._temperatureMeta;
      if (!meta || !tooltip) return;
      const rect = canvas.getBoundingClientRect();
      const pointerX = (event.clientX - rect.left) * (Math.max(240, rect.width || 900) / rect.width);
      if (pointerX < meta.box.left || pointerX > meta.box.right) {
        tooltip.classList.add('hidden');
        return;
      }
      const at = meta.start + (pointerX - meta.box.left) / (meta.box.right - meta.box.left) * (meta.end - meta.start);
      const pressure = nearest(meta.pressure, at);
      const temperature = nearest(meta.temperatures, at);
      const values = [`<strong>${inspectorTime(at, true)}</strong>`];
      if (meta.showPressure && pressure && (!meta.gapLimits || Math.abs(pressure.at-at) <= meta.gapLimits.pressure)) values.push(`<span>Pressure: ${Number(pressure.pressure).toFixed(1)} psi</span>`);
      meta.channelConfig.forEach((channel) => {
        if (!meta.visibleKeys.includes(channel.key) || !temperature || (meta.gapLimits && Math.abs(temperature.at-at) > meta.gapLimits.temperature)) return;
        const value = validNumber(temperature[channel.key]);
        if (value !== null) values.push(`<span>${channel.name}: ${value.toFixed(meta.wholeDegrees ? 0 : 1)}°F</span>`);
      });
      tooltip.innerHTML = values.join('');
      tooltip.classList.remove('hidden');
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - 150, event.clientX - rect.left + 12))}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 18)}px`;
    });
    canvas.addEventListener('pointerleave', () => { if (tooltip) tooltip.classList.add('hidden'); });
  }

  // View-only zoom: data, capture intervals, exports and official calculations stay unchanged.
  function clampZoom(zoom, start, end) {
    if (!zoom || !Number.isFinite(zoom.start) || !Number.isFinite(zoom.end) || zoom.end <= zoom.start || end <= start) return null;
    const span = Math.min(end - start, Math.max(10000, zoom.end - zoom.start));
    if (span >= end - start) return null;
    const left = Math.max(start, Math.min(end - span, zoom.start));
    return { start: left, end: left + span };
  }

  function updateZoomControls(panel, meta) {
    const controls = panel.querySelector('.temp-zoom-controls');
    if (!controls) return;
    controls.querySelectorAll('[data-zoom],select').forEach(el => { el.disabled = !meta; });
    if (!meta) { setPanelText(panel, '.temp-zoom-window', 'Zoom becomes available when readings arrive.'); return; }
    controls.querySelector('[data-zoom="reset"]').disabled = !meta.zoomed;
    controls.querySelector('[data-zoom="out"]').disabled = !meta.zoomed;
    controls.querySelector('[data-zoom="in"]').disabled = meta.end - meta.start <= 10000;
    controls.querySelector('[data-zoom="earlier"]').disabled = meta.start <= meta.fullStart;
    controls.querySelector('[data-zoom="later"]').disabled = meta.end >= meta.fullEnd;
    const preset = controls.querySelector('.temp-zoom-preset');
    const minutes = String((meta.end - meta.start) / 60000);
    preset.value = !meta.zoomed ? 'all' : [...preset.options].some(o => o.value === minutes) ? minutes : 'custom';
    setPanelText(panel, '.temp-zoom-window', `${meta.zoomed ? 'Zoomed view' : 'Full selected history'}: ${inspectorTime(meta.start, true)} – ${inspectorTime(meta.end, true)}`);
  }

  function bindZoom(panel, onChange) {
    const canvas = panel.querySelector('.temperature-chart');
    const wrap = canvas.closest('.temperature-canvas-wrap');
    const controls = document.createElement('div');
    controls.className = 'temp-zoom-controls';
    controls.innerHTML = `<div class="temp-zoom-actions"><label>Time window <select class="temp-zoom-preset" aria-label="Temperature chart time window"><option value="all">Full history</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="custom" disabled>Custom zoom</option></select></label><button type="button" data-zoom="in">Zoom in +</button><button type="button" data-zoom="out">Zoom out −</button><button type="button" data-zoom="earlier">← Earlier</button><button type="button" data-zoom="later">Later →</button><button type="button" data-zoom="reset">Reset zoom</button></div><small>Choose a window or drag across the graph to zoom in. Earlier / Later moves the window. Recording continues unchanged.</small><span class="temp-zoom-window" role="status"></span>`;
    wrap.before(controls);
    bindExpandedChart(panel, controls, wrap, onChange);
    const shade = document.createElement('div'); shade.className = 'temp-zoom-drag'; shade.hidden = true;
    shade.setAttribute('aria-hidden', 'true'); wrap.appendChild(shade);
    function apply(zoom) {
      const meta = canvas._temperatureMeta;
      if (!meta) return;
      panel._temperatureZoom = clampZoom(zoom, meta.fullStart, meta.fullEnd);
      const view = panel._temperatureZoom;
      panel._temperatureSelection = view ? { followLive: false, at: (view.start + view.end) / 2 } : { followLive: true, at: null };
      panel.querySelector('.temperature-tooltip')?.classList.add('hidden');
      onChange();
    }
    controls.querySelector('.temp-zoom-preset').addEventListener('change', event => {
      const meta = canvas._temperatureMeta; if (!meta) return;
      if (event.target.value === 'all') { apply(null); return; }
      const span = Number(event.target.value) * 60000;
      const center = panel._temperatureSelection?.followLive === false ? meta.selectedAt : meta.end - span / 2;
      apply({ start: center - span / 2, end: center + span / 2 });
    });
    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-zoom]'); const meta = canvas._temperatureMeta;
      if (!button || !meta) return;
      const action = button.dataset.zoom, span = meta.end - meta.start;
      if (action === 'reset') { apply(null); return; }
      if (action === 'earlier' || action === 'later') {
        const shift = span * .75 * (action === 'earlier' ? -1 : 1);
        apply({ start: meta.start + shift, end: meta.end + shift }); return;
      }
      const nextSpan = span * (action === 'in' ? .5 : 2);
      const center = action === 'in' && panel._temperatureSelection?.followLive === false ? meta.selectedAt : (meta.start + meta.end) / 2;
      apply({ start: center - nextSpan / 2, end: center + nextSpan / 2 });
    });
    let drag = null;
    function position(event, meta) {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.max(240, rect.width || 900) / rect.width;
      const x = Math.max(meta.box.left, Math.min(meta.box.right, (event.clientX - rect.left) * scale));
      return { x, at: meta.start + (x - meta.box.left) / (meta.box.right - meta.box.left) * (meta.end - meta.start), scale };
    }
    canvas.addEventListener('pointerdown', event => {
      const meta = canvas._temperatureMeta;
      if (!meta || event.button !== 0 || !event.isPrimary || (event.pointerType === 'touch' && !canvas.closest('.temp-chart-dialog[open]'))) return;
      const rect = canvas.getBoundingClientRect();
      const y = (event.clientY - rect.top) * meta.height / rect.height;
      const x = (event.clientX - rect.left) * Math.max(240, rect.width || 900) / rect.width;
      if (x < meta.box.left || x > meta.box.right || y < meta.box.top || y > meta.box.bottom) return;
      drag = { meta, first: position(event, meta), pointerId: event.pointerId };
      if (event.pointerType !== 'touch') {
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const point = position(event, drag.meta), rect = canvas.getBoundingClientRect();
      shade.hidden = false;
      shade.style.left = `${Math.min(point.x, drag.first.x) / point.scale}px`;
      shade.style.width = `${Math.abs(point.x - drag.first.x) / point.scale}px`;
      shade.style.top = `${drag.meta.box.top * rect.height / drag.meta.height}px`;
      shade.style.height = `${(drag.meta.box.bottom - drag.meta.box.top) * rect.height / drag.meta.height}px`;
      panel.querySelector('.temperature-tooltip')?.classList.add('hidden');
    });
    function cancelDrag() { drag = null; shade.hidden = true; }
    canvas.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const saved = drag, point = position(event, saved.meta); cancelDrag();
      if (event.pointerType !== 'touch' && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (Math.abs(point.x - saved.first.x) >= 8) apply({ start: Math.min(point.at, saved.first.at), end: Math.max(point.at, saved.first.at) });
    });
    canvas.addEventListener('pointercancel', cancelDrag);
    canvas.addEventListener('lostpointercapture', cancelDrag);
    controls.addEventListener('keydown', event => { if (event.key === 'Escape' && !canvas.closest('.temp-chart-dialog[open]')) { cancelDrag(); apply(null); } });
  }

  function bindExpandedChart(panel, controls, wrap, onChange) {
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'temp-chart-expand';
    expand.textContent = 'Expand chart ⤢';
    expand.setAttribute('aria-haspopup', 'dialog');
    controls.prepend(expand);
    const dialog = document.createElement('dialog');
    dialog.className = 'temp-chart-dialog';
    dialog.setAttribute('aria-label', 'Expanded pressure and temperature chart');
    dialog.innerHTML = '<header class="temp-chart-dialog-header"><div><strong>Pressure &amp; temperature</strong><small>Drag across the graph to zoom. Turn your phone sideways for a wider view.</small></div><button type="button" class="temp-chart-close" autofocus>Close chart</button></header><div class="temp-chart-dialog-body"></div>';
    panel.appendChild(dialog);
    const body = dialog.querySelector('.temp-chart-dialog-body');
    let moved = [], priorOverflow;
    expand.addEventListener('click', () => {
      if (dialog.open) return;
      // Put the graph first in the expanded view; controls remain just below it.
      const nodes = [wrap, controls, panel.querySelector('.temperature-controls'), panel.querySelector('.temperature-inspector')].filter(Boolean);
      moved = nodes.map(node => {
        const marker = document.createComment('Expanded chart original position');
        node.before(marker);
        body.appendChild(node);
        return { node, marker };
      });
      priorOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      dialog.showModal();
      onChange();
    });
    dialog.querySelector('.temp-chart-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      moved.forEach(({ node, marker }) => marker.replaceWith(node));
      moved = [];
      document.body.style.overflow = priorOverflow;
      panel.querySelector('.temperature-tooltip')?.classList.add('hidden');
      onChange();
      expand.focus({ preventScroll: true });
    });
    // Repaint at the new pixel size on rotation or expansion, even while offline.
    let previousSize = '', frame;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const size = `${width}:${height}`;
      if (!width || size === previousSize) return;
      previousSize = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(onChange);
    });
    observer.observe(wrap);
  }

  window.TemperatureChartRenderer = { DEFAULT_CHANNELS, channels, renderPanel, bindPanel, nearest, clampZoom, smoothReadings };
})();
