// 24-hour circular recorder chart, laid out like the paper charts: noon at top, pressure rings outward.
(function () {
  'use strict';
  const SIZE = 700, CX = SIZE / 2, CY = SIZE / 2, INNER = 102, OUTER = 302, DAY = 86400000;
  const PAPER = '#fffef8';

  function polar(hours, radius) {
    const angle = (hours / 24) * Math.PI * 2 - Math.PI / 2;
    return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle), angle };
  }
  function radiusFor(pressure, max) {
    return INNER + (Math.max(0, Math.min(max, pressure)) / max) * (OUTER - INNER);
  }
  function point(at, pressure, max) {
    const d = new Date(at);
    const minutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    return polar(((minutes - 720 + 1440) % 1440) / 60, radiusFor(pressure, max));
  }
  function rings(max) {
    const steps = [[100, 10], [300, 25], [750, 50], [1500, 100], [3000, 200], [7500, 500], [15000, 1000]];
    const major = (steps.find(([limit]) => max <= limit) || [0, Math.pow(10, Math.floor(Math.log10(max / 10)))])[1];
    return { major, minor: major / 10 };
  }
  function arc(ctx, pressure, start, end, max, color, width) {
    if (!start || !end || !Number.isFinite(pressure)) return;
    ctx.beginPath();
    for (let i = 0; i <= 120; i += 1) {
      const p = point(start + ((Math.min(end, start + DAY) - start) * i) / 120, pressure, max);
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // points: [[time ms, psi], ...] in time order. s: {max, pen, low, high, start, end, title, lift}
  function draw(canvas, points, s) {
    const ctx = canvas.getContext('2d');
    const shown = canvas.getBoundingClientRect().width || SIZE;
    const scale = Math.max(2, Math.min(4, (window.devicePixelRatio || 1) * shown / SIZE));
    const backing = Math.round(SIZE * scale);
    if (canvas.width !== backing) { canvas.width = backing; canvas.height = backing; }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const max = Math.max(1, Number(s.max) || 1000);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const { major, minor } = rings(max);
    for (let p = minor; p <= max + 0.001; p += minor) {
      const isMajor = Math.abs(p / major - Math.round(p / major)) < 0.001;
      ctx.beginPath();
      ctx.arc(CX, CY, radiusFor(p, max), 0, Math.PI * 2);
      ctx.strokeStyle = isMajor ? 'rgba(74,146,123,.72)' : 'rgba(184,216,205,.67)';
      ctx.lineWidth = isMajor ? 1.05 : 0.5;
      ctx.stroke();
    }
    for (let i = 0; i < 96; i += 1) {
      const a = polar(i / 4, INNER), b = polar(i / 4, OUTER), hour = i % 4 === 0, six = i % 24 === 0;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = six ? '#24765f' : hour ? 'rgba(86,153,132,.85)' : 'rgba(194,221,212,.72)';
      ctx.lineWidth = six ? 1.5 : hour ? 0.9 : 0.45;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#176c54';
    for (let h = 0; h < 24; h += 1) {
      const p = polar(h, OUTER + 25), label = h === 0 ? 'NOON' : h === 12 ? 'MIDNIGHT' : String(h % 12);
      ctx.font = label.length > 2 ? '800 9px system-ui' : '800 12px system-ui';
      ctx.fillText(label, p.x, p.y);
    }
    ctx.font = '500 7px system-ui';
    for (let p = major; p < max - 0.001; p += major) {
      for (const h of [0, 4, 8, 12, 16, 20]) {
        const at = polar(h, radiusFor(p, max));
        let turn = at.angle + Math.PI / 2;
        while (turn > Math.PI / 2) turn -= Math.PI;
        while (turn < -Math.PI / 2) turn += Math.PI;
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(turn);
        ctx.lineWidth = 3;
        ctx.strokeStyle = PAPER;
        ctx.strokeText(String(Math.round(p)), 0, 0);
        ctx.fillStyle = '#1d6f5a';
        ctx.fillText(String(Math.round(p)), 0, 0);
        ctx.restore();
      }
    }

    if (s.start) {
      if (s.high != null) arc(ctx, Number(s.high), s.start, s.end, max, '#16a35b', 1);
      if (s.low != null) arc(ctx, Number(s.low), s.start, s.end, max, '#1688c8', 1);
    }

    // With pen lift on, the pen lifts wherever readings stop, so a gap in the record shows as a gap in the trace.
    if (points.length) {
      const from = points[points.length - 1][0] - DAY;
      let previous = null, gap = 60000;
      if (points.length > 2) gap = Math.max(gap, 4 * (points[points.length - 1][0] - points[0][0]) / points.length);
      if (!s.lift) gap = Infinity;
      ctx.beginPath();
      for (const [at, psi] of points) {
        if (at < from) continue;
        const p = point(at, psi, max);
        if (previous === null || at - previous > gap) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        previous = at;
      }
      ctx.strokeStyle = '#d43b3b';
      ctx.lineWidth = Math.max(0.3, Math.min(5, Number(s.pen) || 1));
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(CX, CY, INNER, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
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
    ctx.fillText((s.title || '24-HOUR RECORD').toUpperCase().slice(0, 34), CX, CY + 36);
    ctx.fillStyle = '#176c54';
    ctx.font = '800 8px system-ui';
    ctx.fillText(`0–${Math.round(max).toLocaleString()} PSI`, CX, CY + 50);
    ctx.beginPath();
    ctx.arc(CX, CY, OUTER, 0, Math.PI * 2);
    ctx.strokeStyle = '#14654f';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  window.RecorderChart = { draw };
})();
