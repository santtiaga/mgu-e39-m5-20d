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
    await assert.rejects(diag.send(0x12, 0x22, [0xF4, 0x70]), /stopped/);

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
    process.stdout.write('diag_lifecycle: TASU proxy shutdown and init race passed\\n');
}

run().catch(function (error) {
    process.stderr.write((error && error.stack) || String(error));
    process.exitCode = 1;
});
