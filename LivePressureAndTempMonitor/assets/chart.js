(function () {
  'use strict';

  const SIZE = 700;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const INNER = 102;
  const OUTER = 302;
  // Thinner lines when zoomed in full screen, so the trace stays readable.
  let lineFactor = 1;

  function polar(offsetHours, radius) {
    const angle = (offsetHours / 24) * Math.PI * 2 - Math.PI / 2;
    return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle), angle };
  }

  function point(timestamp, pressure, chartMax) {
    const date = new Date(timestamp);
    const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
    const offsetHours = ((minutes - 720 + 1440) % 1440) / 60;
    const bounded = Math.max(0, Math.min(chartMax, Number(pressure) || 0));
    const radius = INNER + (bounded / chartMax) * (OUTER - INNER);
    return polar(offsetHours, radius);
  }

  function pressureRadius(pressure, chartMax) {
    return INNER + (Math.max(0, Math.min(chartMax, pressure)) / chartMax) * (OUTER - INNER);
  }

  function pressureIntervals(chartMax) {
    const maximum = Math.max(1, Number(chartMax) || 1000);
    let major;
    if (maximum <= 100) major = 10;
    else if (maximum <= 300) major = 25;
    else if (maximum <= 750) major = 50;
    else if (maximum <= 1500) major = 100;
    else if (maximum <= 3000) major = 200;
    else if (maximum <= 7500) major = 500;
    else if (maximum <= 15000) major = 1000;
    else major = Math.pow(10, Math.floor(Math.log10(maximum / 10)));
    return { major, minor: major / 10 };
  }

  function hourLabel(offset) {
    if (offset === 0) return 'NOON';
    if (offset === 12) return 'MIDNIGHT';
    return String(offset % 12);
  }

  function strokeArc(ctx, pressure, startValue, endValue, chartMax, color, thickness) {
    if (!startValue || !Number.isFinite(pressure)) return;
    const start = new Date(startValue).getTime();
    // With no actual end entered yet, draw the window through the present.
    let end = endValue ? new Date(endValue).getTime() : (window.HydroDemo?.enabled ? window.HydroDemo.ClockDate.now() : Date.now());
    if (!endValue && end <= start) return;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    while (end <= start) end += 86400000;
    ctx.beginPath();
    for (let index = 0; index <= 120; index += 1) {
      const at = start + ((end - start) * index) / 120;
      const p = point(at, pressure, chartMax);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(.5, Math.min(5, Number(thickness) || 1)) * lineFactor;
    ctx.stroke();
  }

  // `view` is only passed by the full-screen viewer: { k, e, f, lineFactor } is the
  // device-pixel transform for the current pinch zoom and pan.
  function draw(canvas, readings, settings, view) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const chartMax = Math.max(1, Number(settings.chartMax) || 1000);
    if (view) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fffef8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(view.k, 0, 0, view.k, view.e, view.f);
      lineFactor = view.lineFactor;
    } else {
      remember(canvas, readings, settings);
      const displayedWidth = canvas.getBoundingClientRect().width || SIZE;
      const renderScale = Math.max(2, Math.min(4, (window.devicePixelRatio || 1) * displayedWidth / SIZE));
      const backingSize = Math.round(SIZE * renderScale);
      if (canvas.width !== backingSize || canvas.height !== backingSize) {
        canvas.width = backingSize;
        canvas.height = backingSize;
      }
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#fffef8';
      ctx.fillRect(0, 0, SIZE, SIZE);
      lineFactor = 1;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const intervals = pressureIntervals(chartMax);
    const pressureStep = intervals.major;
    const minorStep = intervals.minor;
    for (let pressure = minorStep; pressure <= chartMax + 0.001; pressure += minorStep) {
      const major = Math.abs(pressure / pressureStep - Math.round(pressure / pressureStep)) < 0.001;
      ctx.beginPath();
      ctx.arc(CX, CY, pressureRadius(pressure, chartMax), 0, Math.PI * 2);
      ctx.strokeStyle = major ? 'rgba(74,146,123,.72)' : 'rgba(184,216,205,.67)';
      ctx.lineWidth = (major ? 1.05 : 0.5) * lineFactor;
      ctx.stroke();
    }

    for (let index = 0; index < 96; index += 1) {
      const offset = index / 4;
      const start = polar(offset, INNER);
      const end = polar(offset, OUTER);
      const hour = index % 4 === 0;
      const sixHour = index % 24 === 0;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = sixHour ? '#24765f' : hour ? 'rgba(86,153,132,.85)' : 'rgba(194,221,212,.72)';
      ctx.lineWidth = (sixHour ? 1.5 : hour ? 0.9 : 0.45) * lineFactor;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#176c54';
    for (let offset = 0; offset < 24; offset += 1) {
      const p = polar(offset, OUTER + 25);
      const label = hourLabel(offset);
      ctx.font = label.length > 2 ? '800 9px system-ui' : '800 12px system-ui';
      ctx.fillText(label, p.x, p.y);
    }

    ctx.font = '500 7px system-ui';
    for (let pressure = pressureStep; pressure < chartMax - 0.001; pressure += pressureStep) {
      const radius = pressureRadius(pressure, chartMax);
      for (const offset of [0, 4, 8, 12, 16, 20]) {
        const p = polar(offset, radius);
        let rotation = p.angle + Math.PI / 2;
        while (rotation > Math.PI / 2) rotation -= Math.PI;
        while (rotation < -Math.PI / 2) rotation += Math.PI;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rotation);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fffef8';
        ctx.strokeText(String(Math.round(pressure)), 0, 0);
        ctx.fillStyle = '#1d6f5a';
        ctx.fillText(String(Math.round(pressure)), 0, 0);
        ctx.restore();
      }
    }

    if (settings.showWindow) {
      if (settings.windowTop !== '') strokeArc(ctx, Number(settings.windowTop), settings.testStart, settings.testEnd, chartMax, '#16a35b', settings.windowThickness);
      if (settings.windowBottom !== '') strokeArc(ctx, Number(settings.windowBottom), settings.testStart, settings.testEnd, chartMax, '#1688c8', settings.windowThickness);
    }

    if (readings.length) {
      ctx.beginPath();
      readings.forEach((reading, index) => {
        const p = point(reading.at, reading.pressure, chartMax);
        if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = settings.traceColor || '#d43b3b';
      ctx.lineWidth = Math.max(.1, Math.min(5, Number(settings.traceThickness) || 1)) * lineFactor;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(CX, CY, INNER, 0, Math.PI * 2);
    ctx.fillStyle = '#fffef8';
    ctx.fill();
    ctx.strokeStyle = '#24765f';
    ctx.lineWidth = 1.5 * lineFactor;
    ctx.stroke();
    ctx.fillStyle = '#176c54';
    ctx.font = '900 9px system-ui';
    ctx.fillText('PRESSURE RECORDER', CX, CY - 34);
    ctx.fillStyle = '#18342c';
    ctx.beginPath();
    ctx.arc(CX, CY, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#668379';
    ctx.font = '700 6px system-ui';
    ctx.fillText('24-HOUR LIVE RECORD', CX, CY + 36);
    ctx.fillStyle = '#176c54';
    ctx.font = '800 8px system-ui';
    ctx.fillText(`0–${Math.round(chartMax).toLocaleString()} PSI`, CX, CY + 50);
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER, 0, Math.PI * 2);
    ctx.strokeStyle = '#14654f';
    ctx.lineWidth = 2.5 * lineFactor;
    ctx.stroke();
    lineFactor = 1;
  }

  // Full-screen chart: tap the round chart to open it, then pinch, scroll or
  // double-tap to zoom and drag to move. It is redrawn at screen resolution on
  // every change, so labels and the trace stay sharp at any zoom, and it keeps
  // following live readings while open.
  const MAX_ZOOM = 12;
  const latest = new WeakMap();
  let zoomed = null;

  function remember(canvas, readings, settings) {
    latest.set(canvas, { readings, settings });
    addOpenButton(canvas);
    if (zoomed && zoomed.source === canvas) zoomed.schedule();
  }

  function addOpenButton(canvas) {
    const wrap = canvas.closest('.chart-wrap');
    if (!wrap || wrap.querySelector('.chart-zoom-open')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chart-zoom-open';
    button.textContent = 'Full screen ⤢';
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => openZoom(canvas));
    canvas.addEventListener('click', () => openZoom(canvas));
    wrap.append(button);
  }

  function openZoom(source) {
    if (zoomed || !latest.has(source)) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'chart-zoom-dialog';
    dialog.setAttribute('aria-label', 'Full-screen pressure chart');
    dialog.innerHTML = '<header class="chart-zoom-header"><div><strong>Recorder chart</strong><small>Pinch or scroll to zoom. Drag to move. Double-tap to zoom in or reset.</small></div><div class="chart-zoom-actions"><button type="button" data-chart-zoom="out" aria-label="Zoom out">−</button><button type="button" data-chart-zoom="in" aria-label="Zoom in">+</button><button type="button" data-chart-zoom="reset">Fit</button><button type="button" class="chart-zoom-close">Close</button></div></header><canvas class="chart-zoom-canvas"></canvas>';
    document.body.append(dialog);
    const canvas = dialog.querySelector('canvas');
    const state = { source, zoom: 1, panX: 0, panY: 0, frame: 0 };
    const size = () => { const r = canvas.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1 }; };
    const clampPan = () => {
      const { w, h } = size(), half = (SIZE / 2) * (Math.min(w, h) / SIZE) * state.zoom;
      state.panX = Math.max(-half, Math.min(half, state.panX));
      state.panY = Math.max(-half, Math.min(half, state.panY));
    };
    const render = () => {
      state.frame = 0;
      const data = latest.get(source); if (!data) return;
      const { w, h } = size(), dpr = window.devicePixelRatio || 1;
      const width = Math.round(w * dpr), height = Math.round(h * dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const k = dpr * (Math.min(w, h) / SIZE) * state.zoom;
      draw(canvas, data.readings, data.settings, { k, e: dpr * (w / 2 + state.panX) - k * CX, f: dpr * (h / 2 + state.panY) - k * CY, lineFactor: 1 / Math.sqrt(state.zoom) });
    };
    state.schedule = () => { if (!state.frame) state.frame = requestAnimationFrame(render); };
    // Zoom by `factor` keeping the chart point under (x, y) in place.
    const zoomAt = (factor, x, y) => {
      const { w, h } = size();
      const next = Math.max(1, Math.min(MAX_ZOOM, state.zoom * factor));
      const ratio = next / state.zoom;
      const cx = x - w / 2, cy = y - h / 2;
      state.panX = cx - (cx - state.panX) * ratio;
      state.panY = cy - (cy - state.panY) * ratio;
      state.zoom = next;
      clampPan(); state.schedule();
    };
    const local = (event) => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
    const pointers = new Map();
    let pinch = null, lastTap = 0;
    canvas.addEventListener('pointerdown', (event) => {
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      }
      if (pointers.size === 1) {
        const now = Date.now(), p = local(event);
        if (now - lastTap < 300) { if (state.zoom > 1.01) { state.zoom = 1; state.panX = 0; state.panY = 0; state.schedule(); } else zoomAt(3, p.x, p.y); lastTap = 0; }
        else lastTap = now;
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      const before = pointers.get(event.pointerId), now = local(event);
      pointers.set(event.pointerId, now);
      if (pointers.size === 1) {
        state.panX += now.x - before.x; state.panY += now.y - before.y;
        clampPan(); state.schedule();
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        // Move with the fingers' midpoint, then zoom around it.
        state.panX += (now.x - before.x) / 2; state.panY += (now.y - before.y) / 2;
        zoomAt(distance / pinch.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch.distance = distance;
      }
    });
    const release = (event) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const p = local(event);
      zoomAt(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002)), p.x, p.y);
    }, { passive: false });
    dialog.querySelector('.chart-zoom-actions').addEventListener('click', (event) => {
      const action = event.target.closest('[data-chart-zoom]')?.dataset.chartZoom; if (!action) return;
      const { w, h } = size();
      if (action === 'reset') { state.zoom = 1; state.panX = 0; state.panY = 0; state.schedule(); }
      else zoomAt(action === 'in' ? 1.6 : 1 / 1.6, w / 2, h / 2);
    });
    // Phone back button closes the chart instead of leaving the page.
    let pushed = false;
    try { history.pushState({ chartZoom: true }, ''); pushed = true; } catch (_) {}
    const onPop = () => { pushed = false; dialog.close(); };
    window.addEventListener('popstate', onPop);
    const onResize = () => { clampPan(); state.schedule(); };
    window.addEventListener('resize', onResize);
    dialog.querySelector('.chart-zoom-close').addEventListener('click', () => dialog.close());
    const priorOverflow = document.body.style.overflow;
    dialog.addEventListener('close', () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('resize', onResize);
      if (state.frame) cancelAnimationFrame(state.frame);
      document.body.style.overflow = priorOverflow;
      zoomed = null;
      dialog.remove();
      if (pushed) history.back();
      source.closest('.chart-wrap')?.querySelector('.chart-zoom-open')?.focus({ preventScroll: true });
    });
    zoomed = state;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    render();
  }

  window.PressureChartRenderer = { draw, pressureIntervals, openZoom };
})();
