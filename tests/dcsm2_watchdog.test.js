'use strict';

const assert = require('assert');
const DCSM2Watchdog = require('../shared/dcsm2_watchdog');

const parse = DCSM2Watchdog.parseStatus;

assert.strictEqual(parse('dcsm: Dcsm2 available for 3 s; subscription: ok'), 'available');
assert.strictEqual(parse('dcsm: Dcsm2 not available for 2 s; subscription: no answer yet'), 'unavailable');
assert.strictEqual(parse('dcsm: Dcsm2 not available yet; subscription: no answer yet'), 'unknown');
assert.strictEqual(parse('dcsm: DCSM provider available'), 'available');
assert.strictEqual(parse('dcsm: DCSM provider not available'), 'unavailable');
assert.strictEqual(parse('cluster-render status: panel idle'), null);
assert.strictEqual(parse(''), null);


{
    const changes = [];
    const client = { ready: false, status: function () {} };
    const watchdog = new DCSM2Watchdog(client, (state, reason, previous) => {
        changes.push({ state, previous });
    });
    watchdog.status('dcsm: Dcsm2 available for 3 s; subscription: ok');
    watchdog.status('dcsm: Dcsm2 not available for 2 s; subscription: no answer yet');
    assert.deepStrictEqual(changes, [
        { state: 'available', previous: 'unknown' },
        { state: 'unavailable', previous: 'available' },
    ], 'confirmed provider loss must be observable as an availability transition');
    watchdog.disconnected();
    assert.deepStrictEqual(changes[2], { state: 'unknown', previous: 'unavailable' },
        'a socket disconnect returns health to unknown, not unavailable');
    watchdog.stop();
}


{
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let queued = null;
    let calls = 0;
    const warnings = [];
    global.setTimeout = function (fn) { queued = fn; return 123; };
    global.clearTimeout = function () {};
    try {
        const client = { ready: true, status: function () { calls++; throw new Error('temporary write failure'); } };
        const watchdog = new DCSM2Watchdog(client, function () {}, {
            info: function () {}, warn: function (message) { warnings.push(message); }
        });
        watchdog.connected();
        assert.strictEqual(typeof queued, 'function');
        const firstPoll = queued;
        queued = null;
        firstPoll();
        assert.strictEqual(calls, 1, 'failed status request is attempted once');
        assert.strictEqual(typeof queued, 'function', 'watchdog schedules another poll after a write failure');
        assert(warnings.some((message) => message.indexOf('temporary write failure') >= 0),
            'write failure is logged');
        watchdog.stop();
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
}


{
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let queued = null, calls = 0;
    global.setTimeout = function (fn) { queued = fn; return 456; };
    global.clearTimeout = function () {};
    try {
        const client = { ready: true, blocked: true, status: function () { calls++; } };
        const watchdog = new DCSM2Watchdog(client, function () {});
        watchdog.connected();
        const poll = queued;
        queued = null;
        poll();
        assert.strictEqual(calls, 0, 'status polling must not add writes during socket backpressure');
        assert.strictEqual(typeof queued, 'function', 'polling resumes after a later drain');
        watchdog.stop();
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
}


{
    const changes = [];
    const watchdog = new DCSM2Watchdog({ ready: false, status: function () {} }, (state) => changes.push(state));
    watchdog.stop();
    watchdog.status('dcsm: Dcsm2 available for 3 s; subscription: ok');
    watchdog.disconnected();
    assert.deepStrictEqual(changes, [], 'late status and disconnect events are ignored after stop');
    assert.strictEqual(watchdog.state, 'unknown', 'stopped watchdog state is not mutated by late events');
}


{
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const originalNow = Date.now;
    let queued = null, now = 1000, calls = 0;
    global.setTimeout = function (fn) { queued = fn; return 789; };
    global.clearTimeout = function () {};
    Date.now = function () { return now; };
    try {
        const changes = [];
        const client = { ready: true, blocked: false, status: function () { calls++; } };
        const watchdog = new DCSM2Watchdog(client, (state, reason, previous) => {
            changes.push({ state, reason, previous });
        });
        watchdog.connected();
        let poll = queued;
        queued = null;
        poll();
        watchdog.status('dcsm: Dcsm2 available for 3 s; subscription: ok');
        now += 1500;
        poll = queued;
        queued = null;
        poll();
        now += 5000;
        poll = queued;
        queued = null;
        poll();
        now += 5000;
        poll = queued;
        queued = null;
        poll();
        now += 5000;
        poll = queued;
        queued = null;
        poll();
        assert.strictEqual(watchdog.state, 'unknown',
            'a connected renderer with no fresh DCSM2 status must fail closed');
        assert(changes.some((change) => change.state === 'unknown' && change.previous === 'available' &&
            /stale/.test(change.reason)), 'stale health is exposed as an availability transition');
        assert(calls >= 5, 'watchdog continues requesting status while health is stale');
        watchdog.stop();
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
        Date.now = originalNow;
    }
}

console.log('DCSM2 watchdog status parsing, stale-response fail-closed, transitions and retry: OK');
