'use strict';
// Fictional public fixtures. Production-derived designs remain local.
const assert = require('node:assert/strict');
require('../assets/test-design-parser.js');
const parse = globalThis.AtmosTestDesignParser.parse;
function design(name, number, line) {
  return `
Pressure Test Design
Project Name Project Number Line Name Desired MAOP (psig)
${name} ${number} ${line} 500
Project Location County, State Current Class Location Desired Test Class Location
From Sta. 0+00 To Sta. 2+00 Example County, TX 1 2
Test Pressure Ratio 1.50 Test Medium Water
Max Re-Assessment 4 Years Section Length (ft) 200
Pressure Buffer (psig) 50 Test Duration (hrs) 8
Estimated Fill (gal) 150
Recorder 2+00 100 30.000001 -100.000001 750 800 #VALUE! #VALUE! 50% #VALUE! 775
Beginning 0+00 100 30.000002 -100.000002 750 800 #VALUE! #VALUE! 50% #VALUE! 775
End 2+00 100 30.000001 -100.000001 750 800 #VALUE! #VALUE! 50% #VALUE! 775
Limiting Pipe Determination
0+00 1+00 100.00 4.500 42,000 0.237 1 4,424 9
1+00 1+80 80.00 4.500 52,000 0.337 1 7,788 4
1+80 2+00 20.00 4.500 52,000 0.337 1 7,788 4
`;
}
for (const [name, number, line, expectedNumber] of [
  ['DEMO-101 & DEMO-102 Hydrotest', '999.10001', 'DEMO-101', '999.10001'],
  ['Line Q DEMO Hydrotest - Test Section 2', '999.10002/999.10003', 'Q', '999.10002/999.10003'],
  ['Hydrotest Line Z1-2', '999.10004', 'Z1-2', '999.10004'],
  ['999.111.2222.HYDRO.DEMO', '999.10005', 'Z99', '999.10005'],
  ['Line Q DEMO Hydrotest - Test Section 1', '999.10003 / 999.10002', 'Q', '999.10003/999.10002'],
  ['Z9-8 (EXP) Hydrotest', '999.10006', 'Z9-8 (EXP)', '999.10006'],
]) {
  const {data, warnings} = parse(design(name, number, line));
  assert.deepEqual(warnings, []);
  for (const [key, expected] of Object.entries({
    projectName: name, projectNumber: expectedNumber, lineName: line,
    countyState: 'Example County, TX', desiredMaop: '500',
    beginGps: '30.000002, -100.000002', recorderGps: '30.000001, -100.000001',
    windowBottom: '750', windowTop: '800', targetPressure: '775',
    testDurationHours: '8', estimatedFillGallons: '150', sectionLengthFt: '200',
    testMedium: 'Water'
  })) assert.equal(data[key], expected, key);
  assert.equal(data.pipeSegments.length, 2);
  assert.equal(data.pipeSegments[0].grade, 'X42');
  assert.equal(data.pipeSegments[1].grade, 'X52');
  assert.equal(data.pipeSegments[1].lengthFt, '100');
  assert.equal(data.pipeSegments[1].sourceCount, 2);
}
const noGps = parse(design('Demo no GPS', '999.10007', 'Z0').replace(/30\.00000[12] -100\.00000[12] /g, ''));
assert.equal(noGps.data.beginGps, '');
assert.equal(noGps.data.recorderGps, '');
assert.equal(noGps.data.windowBottom, '750');
console.log('Atmos test design parser: synthetic public fixtures passed.');
