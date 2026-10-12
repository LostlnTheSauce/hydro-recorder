(function () {
  'use strict';

  const SIZE = 700;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const INNER = 102;
  const OUTER = 302;

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
    ctx.lineWidth = Math.max(.5, Math.min(5, Number(thickness) || 1));
    ctx.stroke();
  }

  function draw(canvas, readings, settings) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const displayedWidth = canvas.getBoundingClientRect().width || SIZE;
    const renderScale = Math.max(2, Math.min(4, (window.devicePixelRatio || 1) * displayedWidth / SIZE));
    const backingSize = Math.round(SIZE * renderScale);
    if (canvas.width !== backingSize || canvas.height !== backingSize) {
      canvas.width = backingSize;
      canvas.height = backingSize;
    }
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    const chartMax = Math.max(1, Number(settings.chartMax) || 1000);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#fffef8';
    ctx.fillRect(0, 0, SIZE, SIZE);
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
      ctx.lineWidth = major ? 1.05 : 0.5;
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
      ctx.lineWidth = sixHour ? 1.5 : hour ? 0.9 : 0.45;
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
      ctx.lineWidth = Math.max(.1, Math.min(5, Number(settings.traceThickness) || 1));
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(CX, CY, INNER, 0, Math.PI * 2);
    ctx.fillStyle = '#fffef8';
    ctx.fill();
    ctx.strokeStyle = '#24765f';
    ctx.lineWidth = 1.5;
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
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  window.PressureChartRenderer = { draw, pressureIntervals };
})();
