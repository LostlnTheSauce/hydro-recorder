const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets', 'host.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'host.php'), 'utf8');

assert.match(page, /class="sync-google-sheet"[^>]*>Sync to Sheet<\/button>/);
assert.doesNotMatch(page, /class="(?:finalize-google-sheet|toggle-sheet-sync)"/);
assert.equal((script.match(/this\.syncGoogleSheet\(/g) || []).length, 1, 'only the button handler may call Sheet sync');
assert.match(script, /\.sync-google-sheet'\)\.addEventListener\('click', \(\) => this\.syncGoogleSheet\(\)\)/);
assert.doesNotMatch(script, /queueSheetSync|setInterval\([^\n]*syncGoogleSheet|setTimeout\([^\n]*syncGoogleSheet/);
assert.match(script, /window\.confirm\([`']Sync to Google Sheet now\?/);

console.log('Google Sheet synchronization is manual-only.');
