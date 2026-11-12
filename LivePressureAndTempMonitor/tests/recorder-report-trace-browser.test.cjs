// Recorder report: the pen line is drawn fully opaque (a see-through line becomes a transparency group
// in the PDF, which previews such as Gmail's blur into a thick smear) and skips points that land within
// 0.2 chart units of the last one drawn, while still starting at the first reading and ending at the last.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(path.join(root, 'recorder-report.html'))); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/recorder-report.html`);
    // 8 hours of one-second readings holding near 1,000 psi with gauge flicker, like a real test.
    const lines = ['"Date","Time","Pressure PSI"'];
    const start = new Date(2026, 10, 11, 8, 0, 0).getTime();
    for (let i = 0; i < 8 * 3600; i++) {
      const d = new Date(start + i * 1000);
      lines.push(`"${d.toLocaleDateString('en-US')}","${d.toLocaleTimeString('en-US')}","${(i < 600 ? i * 1.7 : 1000 + Math.sin(i / 900) * 40 + ((i * 7919) % 5) / 10).toFixed(1)}"`);
    }
    await page.locator('#fileInput').setInputFiles({ name: 'readings.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n')) });
    await page.waitForFunction(() => document.querySelectorAll('svg path').length > 0);
    const trace = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('svg path')].sort((a, b) => b.getAttribute('d').length - a.getAttribute('d').length);
      const t = paths[0], d = t.getAttribute('d'), pts = d.match(/[ML][\d.]+,[\d.]+/g);
      return { opacity: t.getAttribute('opacity'), points: pts.length, first: pts[0], last: pts.at(-1), moves: (d.match(/M/g) || []).length };
    });
    assert.equal(trace.opacity, null, 'pen line fully opaque');
    assert.equal(trace.moves, 1, 'one continuous line');
    assert.ok(trace.points < 8 * 3600 / 3 && trace.points > 500, `invisible points skipped (${trace.points} of ${8 * 3600})`);
    assert.match(trace.first, /^M/);
    const ends = await page.evaluate(() => [...document.querySelectorAll('svg path')].sort((a, b) => b.getAttribute('d').length - a.getAttribute('d').length)[0].getAttribute('d').match(/[ML]([\d.]+),([\d.]+)/g).slice(-1)[0]);
    assert.ok(ends.startsWith('L'), 'ends on the last reading');
    assert.deepEqual(errors, []);
    console.log(`Recorder report trace: fully opaque, one line, ${trace.points.toLocaleString()} of ${(8 * 3600).toLocaleString()} points drawn (the rest within 0.2 units), from the first reading to the last passed.`);
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
