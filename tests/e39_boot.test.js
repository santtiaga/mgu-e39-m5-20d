'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E39Boot = require('../shared/e39_boot');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e39-boot-'));
const file = path.join(dir, 'state.json');
try {
    let boot = new E39Boot(file);
    boot.setMode('boot');
    boot.onCondition(5);
    assert.strictEqual(boot.state, 'idle', 'KL15 off does not start');
    boot.onCondition(7);
    assert.strictEqual(boot.state, 'pending', 'KL15 rising edge is latched before layout readiness');
    boot.setLayoutReady(true);
    assert.strictEqual(boot.state, 'playing', 'animation starts only after layout readiness');
    const start = boot.startedAt;
    assert.strictEqual(boot.tick(start + 1250), 1, 'sweep reaches its peak halfway through');
    assert.strictEqual(boot.tick(start + E39Boot.DURATION_MS), 0);
    assert.strictEqual(boot.state, 'completed');

    // Process restart with KL15 still on must restore completion, not replay.
    boot = new E39Boot(file);
    boot.setMode('boot');
    boot.onCondition(7);
    boot.setLayoutReady(true);
    assert.strictEqual(boot.state, 'completed', 'persisted ignition cycle prevents replay after app restart');

    // A genuine OFF -> ON cycle permits exactly one new animation.
    boot.onCondition(5);
    assert.strictEqual(boot.state, 'idle');
    boot.onCondition(7);
    assert.strictEqual(boot.state, 'playing');

    // Rebuilds and renderer reconnects only toggle readiness; they never restart playback.
    const originalStart = boot.startedAt;
    boot.setLayoutReady(false);
    boot.setLayoutReady(true);
    assert.strictEqual(boot.startedAt, originalStart);

    // Test mode is a manual edge and also waits for readiness.
    const test = new E39Boot(null);
    test.setMode('boot');
    test.setLayoutReady(false);
    test.setMode('test');
    assert.strictEqual(test.state, 'pending');
    test.setLayoutReady(true);
    assert.strictEqual(test.kind, 'test');
    assert.strictEqual(test.state, 'playing');

    // Off suppresses all startup animation.
    test.setMode('off');
    assert.strictEqual(test.tick(Date.now() + 5000), 0);
    assert.strictEqual(test.state, 'idle');
    console.log('E39 boot controller: ignition edge, readiness latch, persistence, rebuild, test and off passed');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
