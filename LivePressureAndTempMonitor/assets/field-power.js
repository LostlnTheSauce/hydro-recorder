(function (root) {
  'use strict';
  function describe(device, now = Date.now()) {
    const power = device?.power;
    if (!device) return { text: 'Field laptop: choose a logger to see battery status.', state: 'unknown' };
    if (!power) return { text: 'Field laptop: battery status unavailable. Update the field bridge to enable it.', state: 'unknown' };
    const percent = Number.isInteger(power.battery_percent) && power.battery_percent >= 0 && power.battery_percent <= 100
      ? `${power.battery_percent}%` : 'Battery level unknown';
    const supply = power.on_ac === true
      ? (power.charging === true ? 'Plugged in · Charging' : power.charging === false ? 'Plugged in · Not charging' : 'Plugged in · Charging status unknown')
      : power.on_ac === false ? 'On battery' : 'Power source unknown';
    const label = power.has_battery === false
      ? (power.on_ac === true ? 'Plugged in · No battery detected' : 'No battery detected · Power source unknown')
      : `${percent} · ${supply}`;
    const fresh = device.bridge_online === true && Number.isFinite(power.reported_at) && now - power.reported_at >= -5000 && now - power.reported_at <= 30000;
    if (!fresh) return { text: `Field laptop: status stale — last reported ${label}.`, state: 'stale' };
    const low = power.has_battery !== false && Number.isInteger(power.battery_percent) && power.battery_percent <= 20 && power.on_ac === false;
    return { text: `Field laptop: ${label}${low ? ' · Low battery — connect power.' : ''}`, state: low ? 'low' : 'current' };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { describe };
  else root.HydroFieldPower = { describe };
})(typeof window !== 'undefined' ? window : globalThis);
