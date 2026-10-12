(function (root) {
  'use strict';
  const HOT_F = 185; // Laptop's own sensor; it starts slowing itself down around 195 °F.
  const isHot = (power) => Number.isInteger(power?.laptop_temp_f) && power.laptop_temp_f >= HOT_F;
  function describe(device, now = Date.now()) {
    const power = device?.power;
    if (!device) return { text: 'Field laptop: choose a logger to see battery status.', state: 'unknown' };
    if (!power) return { text: 'Field laptop: battery status unavailable. Update the field bridge to enable it.', state: 'unknown' };
    const percent = Number.isInteger(power.battery_percent) && power.battery_percent >= 0 && power.battery_percent <= 100
      ? `${power.battery_percent}%` : 'Battery level unknown';
    const supply = power.on_ac === true
      ? (power.charging === true ? 'Plugged in · Charging' : power.charging === false ? 'Plugged in · Not charging' : 'Plugged in · Charging status unknown')
      : power.on_ac === false ? 'On battery' : 'Power source unknown';
    const label = (power.has_battery === false
      ? (power.on_ac === true ? 'Plugged in · No battery detected' : 'No battery detected · Power source unknown')
      : `${percent} · ${supply}`) + (Number.isInteger(power.laptop_temp_f) ? ` · ${power.laptop_temp_f} °F` : '');
    const fresh = device.bridge_online === true && Number.isFinite(power.reported_at) && now - power.reported_at >= -5000 && now - power.reported_at <= 30000;
    if (!fresh) return { text: `Field laptop: status stale — last reported ${label}.`, state: 'stale' };
    // Matches the host alert: below 75% is flagged whether or not it is plugged in.
    const low = power.has_battery !== false && Number.isInteger(power.battery_percent) && power.battery_percent < 75;
    const hot = isHot(power);
    const advice = hot ? ' · Too hot — move it to shade and clear the vents.' : low ? ' · Below 75% — keep it plugged in and charging.' : '';
    return { text: `Field laptop: ${label}${advice}`, state: hot || low ? 'low' : 'current' };
  }
  // The latest stretch on battery from the saved battery history, so a
  // run-down is readable even after the host page was closed overnight.
  function batteryRun(power, now = Date.now(), format = (at) => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) {
    const history = Array.isArray(power?.history) ? power.history.filter((row) => row && Number.isFinite(row.at)) : [];
    let last = history.length - 1;
    while (last >= 0 && history[last].on_ac !== false) last -= 1;
    if (last < 0) return '';
    let first = last;
    while (first > 0 && history[first - 1].on_ac === false) first -= 1;
    const level = (value) => Number.isInteger(value) ? ` at ${value}%` : '';
    const span = (ms) => { const minutes = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; };
    const start = history[first];
    const plugged = history[last + 1];
    if (plugged) return `Last battery run: ${format(start.at)}${level(start.percent)} until plugged in ${format(plugged.at)}${level(Number.isInteger(plugged.percent) ? plugged.percent : history[last].percent)} (${span(plugged.at - start.at)}).`;
    const endAt = Number.isFinite(power.reported_at) ? power.reported_at : history[last].at;
    const endPercent = Number.isInteger(power.battery_percent) ? power.battery_percent : history[last].percent;
    if (now - endAt > 60000) return `Battery run: ${format(start.at)}${level(start.percent)} until last heard from ${format(endAt)}${level(endPercent)} (${span(endAt - start.at)}).`;
    return `On battery since ${format(start.at)}${level(start.percent)} · now${level(endPercent)} (${span(endAt - start.at)}).`;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { describe, isHot, batteryRun };
  else root.HydroFieldPower = { describe, isHot, batteryRun };
})(typeof window !== 'undefined' ? window : globalThis);
