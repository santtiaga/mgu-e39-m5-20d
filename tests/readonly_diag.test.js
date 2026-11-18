'use strict';

const assert = require('assert');
const { ReadOnlyDiag } = require('../kit/runtime/readonly-diag');

async function run() {
    let shutdowns = 0;
    const proxy = { shutdown: async function () { shutdowns++; } };
    const signals = {
        proxy: async function () { return proxy; },
        on: async function () {},
        onAvailable: async function () {},
    };
    const link = new ReadOnlyDiag(signals, { info: function () {}, warn: function () {} });
    await link.init();
    assert.strictEqual(link.ready, true);
    await link.stop();
    assert.strictEqual(link.ready, false);
    assert.strictEqual(link.available, false);
    assert.strictEqual(shutdowns, 1, 'read-only link releases its TASU proxy');
    await link.stop();
    assert.strictEqual(shutdowns, 1, 'read-only shutdown is idempotent');

    let callStarted;
    const started = new Promise((resolve) => { callStarted = resolve; });
    const pendingProxy = {};
    const pending = new ReadOnlyDiag({
        proxy: async function () { return pendingProxy; },
        on: async function () {},
        onAvailable: async function () {},
        call: function () {
            callStarted();
            return new Promise(function () {});
        },
    }, { info: function () {}, warn: function () {} });
    await pending.init();
    const read = pending.read(0x12, 0xF470, 30000);
    await started;
    await pending.stop();
    const value = await Promise.race([
        read,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    assert.notStrictEqual(value, 'timeout', 'stop settles a pending read immediately');
    console.log('readonly_diag: cancel and native proxy shutdown passed');
}

run().catch((error) => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
