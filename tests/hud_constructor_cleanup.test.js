'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// The app build copies these runtime helpers beside shared/hud.js. Stub the
// pack reader for source-tree tests and point the copied Car path at its source.
const packPath = path.resolve(__dirname, '../shared/kit/pack.js');
const packModule = new Module(packPath);
packModule.filename = packPath;
packModule.loaded = true;
packModule.exports = { open: function () { return { json: function () { return {}; } }; } };
require.cache[packPath] = packModule;

const carPath = path.resolve(__dirname, '../shared/kit/car.js');
const carModule = new Module(carPath);
carModule.filename = carPath;
carModule.loaded = true;
carModule.exports = require('../kit/runtime/car');
require.cache[carPath] = carModule;

const HudApp = require('../shared/hud');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-hud-constructor-'));
let watches = 0, shutdowns = 0;
const values = { redline: 5000, shiftBefore: 500, coldGuard: true, demo: 'off' };
const ctx = {
    spec: { id: 'apex_dash_constructor_test', config: { target: 'panel', socketPath: path.join(dataDir, 'render.sock') } },
    dataDir: dataDir,
    log: { info: function () {}, warn: function () {}, error: function () {} },
    settings: {
        get: function (key) { return values[key]; },
        item: function () { return null; },
        onChange: function () { throw new Error('simulated settings listener failure'); },
    },
    signals: {
        watch: function () {
            watches++;
            return Promise.resolve({
                available: false,
                shutdown: function () { shutdowns++; return Promise.resolve(); },
            });
        },
    },
};

assert.throws(() => new HudApp(ctx), /simulated settings listener failure/,
    'constructor errors must still reach the app startup guard');

setImmediate(() => {
    try {
        assert(watches > 0, 'vehicle subscriptions were started before the constructor failed');
        assert.strictEqual(shutdowns, watches,
            'every subscription resolving after the constructor failure is immediately released');
        fs.rmdirSync(path.join(dataDir, 'layouts'));
        fs.rmdirSync(dataDir);
        process.stdout.write('hud_constructor_cleanup: partial constructor resources released\\n');
    } catch (error) {
        try { fs.rmdirSync(path.join(dataDir, 'layouts')); } catch (e) {}
        try { fs.rmdirSync(dataDir); } catch (e) {}
        console.error(error && error.stack || error);
        process.exitCode = 1;
    }
});
