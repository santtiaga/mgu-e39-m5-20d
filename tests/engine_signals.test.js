'use strict';

const assert = require('assert');
const EngineSignals = require('../kit/runtime/engine_signals');

assert.strictEqual(EngineSignals.boostBar(100, 'BAR'), 1);
assert(Math.abs(EngineSignals.boostBar(145, 'PSI') - 1) < 0.001,
    '0.1 psi per step is converted to bar');
assert.strictEqual(EngineSignals.boostBar(100, 'KPA'), 1,
    'the sport-display metric raw step is 1 kPa');
assert.strictEqual(EngineSignals.boostBar(255, 'BAR'), null, 'BMW no-value sentinel is rejected');
assert.strictEqual(EngineSignals.boostBar(65535, 'BAR'), null, 'out-of-range signal is rejected');
assert.strictEqual(EngineSignals.boostBar(-1, 'BAR'), null, 'negative raw values are rejected');

assert.strictEqual(EngineSignals.boostFresh(false, 1000, 1200), false,
    'a static first sample is never trusted');
assert.strictEqual(EngineSignals.boostFresh(true, 1000, 1500), true);
assert.strictEqual(EngineSignals.boostFresh(true, 1000, 3000), false,
    'boost signal expires after two seconds');
assert.strictEqual(EngineSignals.boostFresh(true, 3000, 2000), false,
    'future timestamps are rejected');

console.log('engine_signals: boost validation, PSI conversion and freshness passed');
