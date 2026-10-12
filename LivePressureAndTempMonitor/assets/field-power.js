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
  if (typeof module !== 'undefined' && module.exports) module.exports = { describe, isHot };
  else root.HydroFieldPower = { describe, isHot };
})(typeof window !== 'undefined' ? window : globalThis);
