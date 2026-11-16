'use strict';

const assert = require('assert');
const Car = require('../kit/runtime/car');

// The B47 MHEV can keep reporting a low residual crank speed after the ICE stops.
assert.strictEqual(Car.engineRpm(0, 400), 0);
assert.strictEqual(Car.engineRpm(160, 400), 0);
assert.strictEqual(Car.engineRpm(399.75, 400), 0);
assert.strictEqual(Car.engineRpm(400, 400), 400);
assert.strictEqual(Car.engineRpm(800, 400), 800);

// The cutoff is opt-in so other engine profiles retain their original rpm values.
assert.strictEqual(Car.engineRpm(160, 0), 160);
assert.strictEqual(Car.engineRpm(160), 160);
assert.strictEqual(Car.engineRpm(null, 400), null);
assert.strictEqual(Car.engineRpm(undefined, 400), undefined);

console.log('Car MHEV engine-speed cutoff: OK');
