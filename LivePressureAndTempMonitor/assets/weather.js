/* Weather for a place, for the operator only (Tools > Weather). Today in that place, midnight to
   midnight: what the nearest National Weather Service station actually recorded up to now, then the
   NWS hourly forecast for the rest of the day. Places come from the free Open-Meteo place search.
   Outside the US (no NWS) the whole day comes from the Open-Meteo weather model, labeled as such. */
(function (root) {
  'use strict';
  const KEY = 'grantg-hydro-weather-place';
  const NWS = 'https://api.weather.gov', GEO = 'https://geocoding-api.open-meteo.com/v1/search', MODEL = 'https://api.open-meteo.com/v1/forecast';
  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain',
    65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms, hail', 99: 'Thunderstorms, hail' };
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: url.startsWith(NWS) ? 'application/geo+json' : 'application/json' } });
    if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
    return response.json();
  }

  // ---- Place search: "Godley Texas", "Godley, TX", "Cleburne" ----
  function splitPlace(text) {
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    let name = clean, state = '';
    const comma = clean.split(',').map((s) => s.trim()).filter(Boolean);
    if (comma.length > 1) { name = comma[0]; state = comma.slice(1).join(' '); }
    else {
      const words = clean.split(' ');
      for (let n = Math.min(2, words.length - 1); n >= 1; n--) {
        const tail = words.slice(-n).join(' '), full = STATES[tail.toUpperCase()] || Object.values(STATES).find((s) => s.toLowerCase() === tail.toLowerCase());
        if (full) { name = words.slice(0, -n).join(' '); state = full; break; }
      }
    }
    if (state) state = STATES[state.toUpperCase()] || state;
    return { name, state };
  }

  async function findPlace(text) {
    const { name, state } = splitPlace(text);
    if (!name) throw new Error('Type a town, e.g. Godley, Texas.');
    const data = await getJson(`${GEO}?${new URLSearchParams({ name, count: '20', language: 'en', format: 'json' })}`);
    const results = data.results || [];
    if (!results.length) throw new Error(`No place called "${name}" was found. Check the spelling, or try a nearby town.`);
    const pick = (state && results.find((r) => String(r.admin1 || '').toLowerCase() === state.toLowerCase())) || (state ? null : results.find((r) => r.country_code === 'US') || results[0]);
    if (!pick) throw new Error(`No "${name}" was found in ${state}.`);
    return { name: pick.name, region: [pick.admin1, pick.country_code === 'US' ? '' : pick.country].filter(Boolean).join(', '), lat: pick.latitude, lon: pick.longitude, us: pick.country_code === 'US', timeZone: pick.timezone };
  }

  // ---- Time in the place's own time zone ----
  function zoneOffset(ms, timeZone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
  }
  // Midnight that starts the place's current day, and the next midnight.
  function dayBounds(now, timeZone) {
    const offset = zoneOffset(now, timeZone), local = new Date(now + offset);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()), next = midnight + 86400000;
    // Wall-clock midnight minus the zone's offset at that moment (checked there, for daylight-saving days).
    return { start: midnight - zoneOffset(midnight - offset, timeZone), end: next - zoneOffset(next - offset, timeZone) };
  }
  const clock = (ms, timeZone, withMinutes = true) => new Date(ms).toLocaleTimeString([], { timeZone, hour: 'numeric', ...(withMinutes ? { minute: '2-digit' } : {}) });

  // ---- National Weather Service: recorded today, then the hourly forecast ----
  async function nwsDay(place, now) {
    const point = await getJson(`${NWS}/points/${place.lat.toFixed(4)},${place.lon.toFixed(4)}`);
    const props = point.properties || {}, timeZone = props.timeZone || place.timeZone;
    const { start, end } = dayBounds(now, timeZone);
    const stations = await getJson(props.observationStations);
    const station = stations.features?.[0]?.properties;
    const observed = [];
    if (station?.stationIdentifier) {
      const obs = await getJson(`${NWS}/stations/${station.stationIdentifier}/observations?${new URLSearchParams({ start: new Date(start).toISOString() })}`);
      for (const f of obs.features || []) {
        const p = f.properties || {}, at = Date.parse(p.timestamp), c = num(p.temperature?.value);
        if (!Number.isFinite(at) || at < start || at > now || c === null) continue;
        const kmh = num(p.windSpeed?.value), deg = num(p.windDirection?.value);
        observed.push({ at, temp: c * 9 / 5 + 32, text: p.textDescription || '', wind: kmh === null ? '' : Math.round(kmh / 1.609344) === 0 ? 'Calm' : `${deg === null ? '' : `${COMPASS[Math.round(deg / 22.5) % 16]} `}${Math.round(kmh / 1.609344)} mph`,
          humidity: num(p.relativeHumidity?.value) });
      }
      observed.sort((a, b) => a.at - b.at);
    }
    const hourly = await getJson(props.forecastHourly);
    const forecast = (hourly.properties?.periods || []).map((p) => ({ at: Date.parse(p.startTime), temp: num(p.temperature), text: p.shortForecast || '',
      wind: [p.windDirection, p.windSpeed].filter(Boolean).join(' '), humidity: num(p.relativeHumidity?.value), rain: num(p.probabilityOfPrecipitation?.value) }))
      .filter((p) => Number.isFinite(p.at) && p.temp !== null && p.at > now && p.at < end);
    const city = props.relativeLocation?.properties;
    return { timeZone, start, end, observed, forecast, source: 'nws',
      station: station ? `${station.name || station.stationIdentifier} (${station.stationIdentifier})` : '', area: city ? `${city.city}, ${city.state}` : '' };
  }

  // ---- Outside the US: the Open-Meteo weather model for the whole day ----
  async function modelDay(place, now) {
    const data = await getJson(`${MODEL}?${new URLSearchParams({ latitude: place.lat, longitude: place.lon, hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m',
      temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'GMT', forecast_days: '2', past_days: '1' })}`);
    const timeZone = place.timeZone || 'UTC', { start, end } = dayBounds(now, timeZone), h = data.hourly || {};
    const rows = (h.time || []).map((t, i) => ({ at: Date.parse(`${t}Z`), temp: num(h.temperature_2m?.[i]), text: WMO[h.weather_code?.[i]] || '', humidity: num(h.relative_humidity_2m?.[i]),
      rain: num(h.precipitation_probability?.[i]), wind: num(h.wind_speed_10m?.[i]) === null ? '' : `${COMPASS[Math.round((h.wind_direction_10m?.[i] || 0) / 22.5) % 16]} ${Math.round(h.wind_speed_10m[i])} mph` }))
      .filter((r) => r.temp !== null && r.at >= start && r.at < end);
    return { timeZone, start, end, observed: rows.filter((r) => r.at <= now), forecast: rows.filter((r) => r.at > now), source: 'model', station: '', area: '' };
  }

  async function load(text, now = Date.now()) {
    const place = await findPlace(text);
    let day = null, note = '';
    if (place.us) { try { day = await nwsDay(place, now); } catch (error) { note = `The National Weather Service did not answer (${error.message}); showing the weather model instead.`; } }
    if (!day) day = await modelDay(place, now);
    return { place, ...day, now, note };
  }

  // ---- Drawing ----
  function drawChart(canvas, day) {
    const box = canvas.getBoundingClientRect(), dpr = root.devicePixelRatio || 1, W = Math.max(320, box.width || 800), H = Math.max(200, box.height || 260);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const all = [...day.observed, ...day.forecast];
    if (!all.length) return;
    const css = getComputedStyle(canvas), ink = css.getPropertyValue('--muted').trim() || '#5d6b78', grid = '#e3e8ec';
    const L = 44, R = 12, T = 14, B = 28;
    let low = Math.floor(Math.min(...all.map((p) => p.temp)) / 5) * 5 - 5, high = Math.ceil(Math.max(...all.map((p) => p.temp)) / 5) * 5 + 5;
    const step = high - low > 40 ? 10 : 5;
    const x = (at) => L + (at - day.start) / (day.end - day.start) * (W - L - R), y = (t) => T + (high - t) / (high - low) * (H - T - B);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    for (let t = low; t <= high; t += step) { ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(L, y(t)); ctx.lineTo(W - R, y(t)); ctx.stroke(); ctx.fillText(`${t}°`, L - 6, y(t)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= 8; i++) { const at = day.start + (day.end - day.start) * i / 8; ctx.fillText(clock(at, day.timeZone, false), x(at), H - B + 8); }
    // Now line.
    if (day.now > day.start && day.now < day.end) { ctx.strokeStyle = '#9aa7b2'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(day.now), T); ctx.lineTo(x(day.now), H - B); ctx.stroke(); ctx.setLineDash([]); ctx.textBaseline = 'top'; ctx.fillText('Now', x(day.now), T); }
    const line = (points, color, dashed) => {
      if (!points.length) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.setLineDash(dashed ? [6, 4] : []); ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(x(p.at), y(p.temp)) : ctx.moveTo(x(p.at), y(p.temp)))); ctx.stroke(); ctx.setLineDash([]);
    };
    const recorded = day.source === 'nws' ? '#d4572a' : '#7d8a96';
    line(day.observed, recorded, false);
    line([...day.observed.slice(-1), ...day.forecast], '#2a78d6', true);
  }

  function render(panel, day) {
    const tz = day.timeZone, temps = (list) => list.map((p) => p.temp);
    const high = (list) => (list.length ? Math.round(Math.max(...temps(list))) : null), low = (list) => (list.length ? Math.round(Math.min(...temps(list))) : null);
    const latest = day.observed.at(-1), recordedWord = day.source === 'nws' ? 'Recorded' : 'Model';
    panel.querySelector('.weather-title').textContent = `${day.place.name}${day.place.region ? `, ${day.place.region}` : ''}`;
    panel.querySelector('.weather-source').textContent = day.source === 'nws'
      ? `Recorded at ${day.station || 'the nearest NWS station'} · forecast from the National Weather Service${day.area ? ` for ${day.area}` : ''} · times in ${tz}`
      : `Weather model (Open-Meteo), not station readings · times in ${tz}`;
    const tile = (label, value) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    panel.querySelector('.weather-tiles').innerHTML = [
      tile(latest ? `${recordedWord} at ${clock(latest.at, tz)}` : 'Now', latest ? `${Math.round(latest.temp)}°F` : '—'),
      tile(`${recordedWord} high / low so far`, day.observed.length ? `${high(day.observed)}° / ${low(day.observed)}°` : '—'),
      tile('Forecast rest of day', day.forecast.length ? `${high(day.forecast)}° / ${low(day.forecast)}°` : '—'),
      tile('Conditions', latest?.text || day.forecast[0]?.text || '—'),
      tile('Wind', latest?.wind || day.forecast[0]?.wind || '—'),
    ].join('');
    // One row an hour: the reading nearest the top of each past hour, then each forecast hour.
    const rows = [];
    for (let at = day.start; at < day.end; at += 3600000) {
      if (at <= day.now) {
        const near = day.observed.reduce((best, p) => (Math.abs(p.at - at) < Math.abs((best?.at ?? Infinity) - at) ? p : best), null);
        if (near && Math.abs(near.at - at) <= 1800000) rows.push({ ...near, kind: recordedWord });
      }
    }
    day.forecast.forEach((p) => rows.push({ ...p, kind: 'Forecast' }));
    // A divider row where the readings stop and the forecast starts.
    const firstForecast = rows.findIndex((r) => r.kind === 'Forecast');
    const divider = (i) => (i === firstForecast && i > 0 ? `<tr class="weather-divider"><td colspan="7">Forecast from ${esc(clock(rows[i].at, tz))}</td></tr>` : '');
    panel.querySelector('.weather-table tbody').innerHTML = rows.map((r, i) => `${divider(i)}<tr class="${r.kind === 'Forecast' ? 'forecast' : 'recorded'}"><td>${esc(clock(r.at, tz))}</td><td><b>${Math.round(r.temp)}°F</b></td><td>${esc(r.text)}</td><td>${esc(r.wind)}</td><td>${r.humidity === null || r.humidity === undefined ? '—' : `${Math.round(r.humidity)}%`}</td><td>${r.rain === null || r.rain === undefined ? '—' : `${Math.round(r.rain)}%`}</td><td>${esc(r.kind)}</td></tr>`).join('');
    panel.querySelector('.weather-legend-recorded').textContent = day.source === 'nws' ? 'Recorded' : 'Weather model (past hours)';
    panel.classList.toggle('weather-model', day.source !== 'nws');
    panel.querySelector('.weather-result').hidden = false;
    drawChart(panel.querySelector('.weather-chart'), day);
    panel._weatherDay = day;
  }

  function init(panel) {
    if (!panel) return;
    const form = panel.querySelector('.weather-search'), input = panel.querySelector('.weather-place'), status = panel.querySelector('.weather-status');
    let busy = false, loadedAt = 0;
    const show = async (text) => {
      if (busy || !text.trim()) return;
      busy = true; status.textContent = 'Getting the weather…';
      try {
        const day = await load(text);
        render(panel, day);
        loadedAt = Date.now();
        status.textContent = `${day.note ? `${day.note} ` : ''}Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
        try { root.localStorage.setItem(KEY, text.trim()); } catch (_) {}
      } catch (error) { status.textContent = error.message || String(error); }
      finally { busy = false; }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); show(input.value); });
    let saved = ''; try { saved = root.localStorage.getItem(KEY) || ''; } catch (_) {}
    if (saved) input.value = saved;
    // Load (or refresh after 15 minutes) when the Weather tab is opened.
    panel.refreshIfStale = () => { if (input.value.trim() && Date.now() - loadedAt > 15 * 60000) show(input.value); };
    root.addEventListener('resize', () => { if (panel._weatherDay && !panel.closest('.hidden')) drawChart(panel.querySelector('.weather-chart'), panel._weatherDay); });
  }

  root.HydroWeather = { init, load, splitPlace, dayBounds, findPlace };
})(window);
