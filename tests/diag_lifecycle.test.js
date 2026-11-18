'use strict';

const assert = require('assert');
const { Diag } = require('../kit/runtime/diag');

function logger() {
    return { info: function () {}, warn: function () {} };
}

async function run() {
    let shutdowns = 0;
    const proxy = { shutdown: async function () { shutdowns++; } };
    const signals = {
        proxy: async function () { return proxy; },
        on: async function () {},
        onAvailable: async function () {},
    };
    const diag = new Diag(signals, logger());
    await diag.init();
    assert.strictEqual(diag.p, proxy);
    await diag.stop();
    assert.strictEqual(shutdowns, 1, 'stop shuts down the native TASU proxy');
    assert.strictEqual(diag.p, null);
    assert.strictEqual(diag.available, false);
    await diag.stop();
    assert.strictEqual(shutdowns, 1, 'stop is idempotent');
    let stoppedSendRejected = false;
    try { await diag.send(0x12, 0x22, [0xF4, 0x70]); }
    catch (e) { stoppedSendRejected = /stopped/.test(e.message); }
    assert.strictEqual(stoppedSendRejected, true, 'requests are rejected after stop');

    let releaseProxy;
    let lateShutdowns = 0;
    const lateProxy = { shutdown: async function () { lateShutdowns++; } };
    const pending = new Diag({
        proxy: function () { return new Promise(function (resolve) { releaseProxy = resolve; }); },
        on: async function () {},
        onAvailable: async function () {},
    }, logger());
    const initializing = pending.init();
    await pending.stop();
    releaseProxy(lateProxy);
    await initializing;
    assert.strictEqual(lateShutdowns, 1, 'a proxy resolving after stop is immediately released');
    assert.strictEqual(pending.p, null);
    // Stop must settle an in-flight physical request without waiting for its timeout.
    let callStarted;
    const started = new Promise(function (resolve) { callStarted = resolve; });
    const inFlight = new Diag({
        proxy: async function () { return {}; }, on: async function () {}, onAvailable: async function () {},
        call: function () { callStarted(); return new Promise(function () {}); },
    }, logger());
    await inFlight.init();
    const physical = inFlight.physical(0x12, 0x22, [0xF4, 0x70], 30000);
    await started;
    await inFlight.stop();
    const physicalResult = await Promise.race([physical, new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, 50); })]);
    assert.strictEqual(physicalResult, null, 'stop resolves an in-flight physical request immediately');

    // Stop must cancel a pending busy retry instead of sending again.
    let calls = 0;
    const busy = new Diag({
        proxy: async function () { return {}; }, on: async function () {}, onAvailable: async function () {},
        call: async function () { calls++; return 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED'; },
    }, logger());
    await busy.init();
    const sending = busy.send(0x12, 0x22, [], { retryBaseMs: 1000 });
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    await busy.stop();
    let sendStopped = false;
    try { await sending; } catch (e) { sendStopped = /stopped/.test(e.message); }
    assert.strictEqual(sendStopped, true, 'stop cancels the busy retry wait');
    assert.strictEqual(calls, 1, 'no retry is sent after stop');
    process.stdout.write('diag_lifecycle: TASU proxy shutdown and init race passed\n');
}

run().catch(function (error) {
    process.stderr.write((error && error.stack) || String(error));
    process.exitCode = 1;
});
