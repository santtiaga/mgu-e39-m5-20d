'use strict';

const assert = require('assert');
const createSafetyController = require('../shared/safety_controller');

function run() {
    let clock = 1000, trips = 0, errors = 0;
    const safety = createSafetyController({
        now: function () { return clock; },
        errorLimit: 3,
        errorWindowMs: 1000,
        log: { error: function () { errors++; } },
        onTrip: function (incident) { trips++; assert.strictEqual(incident.count, 3); },
    });
    const guarded = safety.guard('unit', function (n) { if (n) throw new Error('expected'); return 42; });
    assert.strictEqual(guarded(false), 42);
    guarded(true);
    clock += 100;
    guarded(true);
    assert.strictEqual(safety.tripped(), false);
    clock += 100;
    guarded(true);
    assert.strictEqual(safety.tripped(), true);
    assert.strictEqual(trips, 1);
    assert.strictEqual(guarded(false), undefined, 'latched controller must suppress callbacks');
    assert.strictEqual(trips, 1, 'trip handler runs once');
    safety.reset();
    assert.strictEqual(safety.tripped(), false);
    clock += 1100;
    guarded(true);
    assert.strictEqual(safety.tripped(), false, 'errors outside the rolling window expire');

    const asyncSafety = createSafetyController({
        now: function () { return clock; },
        errorLimit: 1,
        log: { error: function () {} },
    });
    return asyncSafety.guard('async', function () { return Promise.reject(new Error('async failure')); })()
        .then(function (value) {
            assert.strictEqual(value, undefined);
            assert.strictEqual(asyncSafety.tripped(), true);
            assert.strictEqual(errors >= 3, true);
            process.stdout.write('safety_controller: all tests passed\n');
        });
}

run().catch(function (error) {
    process.stderr.write((error && error.stack) || String(error));
    process.exitCode = 1;
});
