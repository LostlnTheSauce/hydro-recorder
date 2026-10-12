const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

const existing = [
  [new Date('2026-09-12T12:30:00-05:00'), 983, 72.5, 74, 70, 'Existing row'],
  ['', '', 73, 75, 71, ''],
];
let written = null;
const range = {
  getValues: () => existing.map((row) => [...row]),
  setValues: (values) => { written = values.map((row) => [...row]); },
};
const sheet = { getRange: () => range };

context.hydroWriteBlock_(sheet, 27, 2, [{
  at: new Date('2026-09-12T12:45:00-05:00').getTime(),
  pressure: 983.9,
  ambient: '',
  pipe: '',
  ground: '',
  comments: 'Automatic pressure row',
}]);

assert.equal(written[0][1], 984, 'pressure is rounded to whole PSI');
assert.deepEqual(written[0].slice(2, 5), [72.5, 74, 70], 'existing temperatures on generated rows are preserved');
assert.deepEqual(written[1].slice(2, 5), [73, 75, 71], 'temperatures on future rows are preserved');
assert.equal(written[1][0], '', 'unused future timestamp remains blank');
assert.equal(written[1][1], '', 'unused future pressure remains blank');

console.log('Google Sheet bridge: temperature preservation assertions passed.');
