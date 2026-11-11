// Tools > Weather: a place's day, midnight to midnight: what the nearest National Weather Service
// station recorded up to now, then the NWS hourly forecast; the weather model when NWS is down.
// The weather services are stood in for with fixed answers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

// "Now" is 2:20 PM in Godley (CST, UTC-6) on Nov 11 2026.
const NOW = Date.UTC(2026, 10, 11, 20, 20);
const MIDNIGHT = Date.UTC(2026, 10, 11, 6, 0);
const iso = (ms) => new Date(ms).toISOString();
function answers(nwsDown) {
  const observations = [];
  for (let h = 0; h <= 14; h++) observations.push({ properties: { timestamp: iso(MIDNIGHT + h * 3600000 + 55 * 60000 - (h === 14 ? 3600000 : 0)), temperature: { value: (h < 8 ? 15 : 15 + (h - 8) * 1.5) }, textDescription: h === 7 ? 'Fog/Mist' : 'Clear', windSpeed: { value: h === 3 ? 0 : 11.1 }, windDirection: { value: 180 }, relativeHumidity: { value: 90 - h * 2 } } });
  observations.push({ properties: { timestamp: iso(MIDNIGHT - 600000), temperature: { value: 30 } } }); // yesterday: left out
  const periods = [];
  for (let h = 14; h < 30; h++) periods.push({ startTime: iso(MIDNIGHT + h * 3600000), temperature: 78 - (h - 14), shortForecast: 'Sunny', windSpeed: '5 mph', windDirection: 'N', relativeHumidity: { value: 50 }, probabilityOfPrecipitation: { value: 10 } });
  return [
    [/geocoding-api\.open-meteo\.com/, { results: [
      { name: 'Godley', latitude: 41.2367, longitude: -88.2437, country_code: 'US', admin1: 'Illinois', timezone: 'America/Chicago' },
      { name: 'Godley', latitude: 32.44903, longitude: -97.52669, country_code: 'US', admin1: 'Texas', timezone: 'America/Chicago' }] }],
    [/api\.weather\.gov\/points\/32\.4490,-97\.5267$/, nwsDown ? 500 : { properties: { timeZone: 'America/Chicago', observationStations: 'https://api.weather.gov/gridpoints/FWD/70,90/stations',
      forecastHourly: 'https://api.weather.gov/gridpoints/FWD/70,90/forecast/hourly', relativeLocation: { properties: { city: 'Godley', state: 'TX' } } } }],
    [/stations$/, { features: [{ properties: { stationIdentifier: 'KCPT', name: 'Cleburne, Cleburne Municipal Airport' } }] }],
    [/stations\/KCPT\/observations\?start=2026-11-11T06%3A00%3A00\.000Z$/, { features: observations }],
    [/forecast\/hourly$/, { properties: { periods } }],
    [/api\.open-meteo\.com\/v1\/forecast/, { hourly: { time: Array.from({ length: 72 }, (_, i) => iso(MIDNIGHT - 86400000 + i * 3600000).slice(0, 16)),
      temperature_2m: Array.from({ length: 72 }, (_, i) => 50 + (i % 24)), relative_humidity_2m: Array(72).fill(60), precipitation_probability: Array(72).fill(5),
      weather_code: Array(72).fill(2), wind_speed_10m: Array(72).fill(4), wind_direction_10m: Array(72).fill(90) } }],
  ];
}

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/host.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture()); }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"offline fixture"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const nwsDown of [false, true]) {
      const context = await browser.newContext({ timezoneId: 'America/Chicago', viewport: { width: 1280, height: 1200 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((now) => { const RealDate = Date; Date.now = () => now; }, NOW);
      const asked = [];
      await page.route(/open-meteo\.com|api\.weather\.gov/, (route) => {
        const url = route.request().url(); asked.push(url);
        const hit = answers(nwsDown).find(([pattern]) => pattern.test(url));
        if (!hit) return route.fulfill({ status: 404, body: '{}' });
        const [, body] = hit;
        return typeof body === 'number' ? route.fulfill({ status: body, body: '{}' }) : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/host.php`);
      await page.locator('[data-dashboard-tab="tools"]').click();
      await page.locator('[data-tool-tab="weather"]').click();
      await page.locator('.weather-place').fill('Godley Texas');
      await page.locator('.weather-search button').click();
      await page.waitForFunction(() => !document.querySelector('.weather-result').hidden);
      assert.equal(await page.locator('.weather-title').innerText(), 'Godley, Texas', 'Texas, not Illinois');
      const rows = await page.locator('.weather-table tbody tr:not(.weather-divider)').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.textContent)));
      if (!nwsDown) {
        assert.match(await page.locator('.weather-source').innerText(), /Recorded at Cleburne, Cleburne Municipal Airport \(KCPT\).*National Weather Service for Godley, TX/);
        assert.equal(rows[0][0], '12:55 AM'); assert.equal(rows[0][1], '59°F'); assert.equal(rows[0][6], 'Recorded');
        assert.equal(rows[3][3], 'Calm', 'still air reads Calm');
        assert.equal(rows[0][3], 'S 7 mph', 'km/h converted to mph');
        const recorded = rows.filter((r) => r[6] === 'Recorded'), forecast = rows.filter((r) => r[6] === 'Forecast');
        assert.equal(recorded.at(-1)[0], '1:55 PM', 'recorded up to now');
        assert.equal(forecast[0][0], '3:00 PM', 'forecast from the next hour');
        assert.equal(await page.locator('.weather-divider').innerText(), 'FORECAST FROM 3:00 PM', 'divider where the forecast starts');
        assert.equal(await page.locator('tr.forecast td').first().evaluate((td) => getComputedStyle(td).backgroundColor), 'rgb(234, 242, 253)', 'forecast rows tinted');
        assert.equal(forecast.at(-1)[0], '11:00 PM', 'forecast stops at midnight');
        assert.ok(!rows.some((r) => r[1] === '86°F'), "yesterday's reading left out");
        assert.match(await page.locator('.weather-tiles').innerText(), /Recorded at 1:55 PM\s+75°F/);
        assert.ok(await page.locator('.weather-chart').evaluate((c) => c.width > 300), 'chart drawn');
        assert.equal(await page.evaluate(() => localStorage.getItem('grantg-hydro-weather-place')), 'Godley Texas', 'place remembered');
      } else {
        assert.match(await page.locator('.weather-status').innerText(), /National Weather Service did not answer/);
        assert.match(await page.locator('.weather-source').innerText(), /Weather model \(Open-Meteo\), not station readings/);
        assert.ok(rows.length === 24 && rows.every((r) => r[6] === 'Model' || r[6] === 'Forecast'), 'model hours, never labeled Recorded');
        assert.equal(await page.locator('.weather-legend-recorded').innerText(), 'Weather model (past hours)');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Weather: place search picks the right state, NWS station readings midnight to now (mph, Calm, yesterday left out), hourly forecast to midnight, chart, remembered place, weather model when NWS is down (never called recorded) passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
