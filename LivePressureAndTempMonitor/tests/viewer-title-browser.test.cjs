// Viewer sign-in shows the shared test's title before the password; nothing when the site has none.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fixture } = require('./workflow-browser.test.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  let title = 'Alanreed to Merten hydrotest';
  const asked = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/viewer.php') { res.setHeader('content-type', 'text/html'); return res.end(fixture('viewer.php').replace('data-session-id=""', 'data-session-id="0123456789abcdef"')); }
    if (url.pathname === '/api.php') {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      return req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        res.setHeader('content-type', 'application/json');
        if (url.searchParams.get('action') === 'viewer_title') { asked.push(body); return res.end(JSON.stringify({ title })); }
        res.writeHead(403); res.end(JSON.stringify({ error: 'That viewer password is not correct.' }));
      });
    }
    const file = path.join(root, url.pathname);
    if (url.pathname.startsWith('/assets/') && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    res.writeHead(404); res.end('');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 860 }, isMobile: true });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const id = '0123456789abcdef';
    await page.goto(`http://127.0.0.1:${server.address().port}/viewer.php?id=${id}`);
    const shown = page.locator('#viewerLockTitle');
    await shown.waitFor();
    assert.equal(await shown.innerText(), 'Alanreed to Merten hydrotest');
    assert.equal(asked[0].session_id, id, 'asks only with the link\'s session id');
    assert.equal('viewer_password' in asked[0], false);
    assert.match(await page.locator('#viewerLogin').innerText(), /Grant G Solutions\s+Live pressure test\s+Alanreed to Merten hydrotest/);
    // No shared title: nothing extra on the page.
    title = null;
    await page.reload();
    await page.waitForTimeout(400);
    assert.equal(await shown.isHidden(), true);
    assert.deepEqual(errors, []);
    console.log('Viewer sign-in title: shown before the password from the shared title, hidden when none passed.');
  } finally { await browser.close(); server.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
