'use strict';
const assert = require('assert');
const NeedleMotion = require('../shared/needle_motion');

const m = new NeedleMotion();
m.sample({ rpm: 1000, speed: 20 }, 1000);
m.sample({ rpm: 1500, speed: 24 }, 1050);
assert.strictEqual(m.value('rpm', 1500, 1050), 1500);
assert(m.value('rpm', 1500, 1075) > 1500, 'RPM should lead the 20 Hz sample by a bounded amount');
assert(m.value('rpm', 1500, 1075) <= 2060, 'RPM prediction must be capped to a 35 ms lead');
m.sample({ rpm: 1500, speed: 25 }, 1070); // speed-only notification must not erase RPM velocity
assert(m.value('rpm', 1500, 1080) > 1500, 'unchanged RPM on a speed event must preserve the RPM predictor');
assert(m.value('speed', 24, 1075) > 24, 'speed should interpolate between asynchronous samples');
assert.strictEqual(m.value('rpm', 1234, 1200), 1234, 'stale sample must fall back to live value');
m.reset();
assert.strictEqual(m.value('rpm', 987, 1100), 987, 'source reset must clear predictor state');
console.log('needle_motion: bounded RPM/speed prediction and stale fallback passed');
