'use strict';

const assert = require('assert');
const ShiftScore = require('../shared/shift_score');

const car = {
    onSample(fn, reset) { this.sample = fn; this.reset = reset; },
    data() { return { oil: 90 }; },
};
const settings = { redline: 5000, shiftBefore: 500, coldGuard: true, coldLimit: 3000 };
const score = new ShiftScore(car, () => settings, { info() {}, warn() {}, error() {} });

assert.deepStrictEqual(score.shiftPoint(30), { rpm: 3000, cold: true });
assert.deepStrictEqual(score.shiftPoint(55), { rpm: 3750, cold: true });
assert.deepStrictEqual(score.shiftPoint(70), { rpm: 4200, cold: true });
assert.deepStrictEqual(score.shiftPoint(80), { rpm: 4500, cold: false });
assert.deepStrictEqual(score.shiftPoint(null), { rpm: 4500, cold: false });

settings.shiftBefore = 1000;
assert.deepStrictEqual(score.shiftPoint(80), { rpm: 4000, cold: false });
settings.coldGuard = false;
assert.deepStrictEqual(score.shiftPoint(30), { rpm: 4000, cold: false });

console.log('ShiftScore diesel profile: OK');
