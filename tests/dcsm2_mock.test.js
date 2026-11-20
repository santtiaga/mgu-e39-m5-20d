'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Mock = require('../bench/dcsm2_mock');
const parse = require('../shared/dcsm2_watchdog').parseStatus;

function run() {
    assert.strictEqual(Mock.normalize('available'), 'available');
    assert.strictEqual(Mock.normalize('unavailable'), 'unavailable');
    assert.strictEqual(Mock.normalize('unknown'), 'unknown');
    assert.strictEqual(Mock.normalize('invalid'), 'available', 'invalid bench setting falls back to safe test default');
    assert.strictEqual(parse(Mock.statusLine('available')), 'available');
    assert.strictEqual(parse(Mock.statusLine('unavailable')), 'unavailable');
    assert.strictEqual(parse(Mock.statusLine('unknown')), 'unknown');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-dcsm2-'));
    const statePath = path.join(dir, 'dcsm2_quarantine.json');
    let now = 1000;
    const recovery = Mock.createRecovery(statePath, { warn: function () {} }, function () { return now; });

    recovery.noteShown('e39_m5_v2', now);
    now = 4000;
    const first = recovery.onLoss('e39_m5_v2', now);
    assert.strictEqual(first.rapid, true, 'loss within six seconds is a strike');
    assert.strictEqual(first.strikes, 1);
    assert.strictEqual(first.delayMs, 3000);
    assert.strictEqual(first.quarantined, false);

    recovery.noteShown('e39_m5_v2', 7000);
    now = 10000;
    const second = recovery.onLoss('e39_m5_v2', now);
    assert.strictEqual(second.rapid, true);
    assert.strictEqual(second.strikes, 2);
    assert.strictEqual(second.quarantined, true, 'two rapid losses in one minute quarantine the layout');
    assert.strictEqual(recovery.isQuarantined('e39_m5_v2'), true);

    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(persisted.version, 1);
    assert.ok(persisted.quarantined.e39_m5_v2);
    const reloaded = Mock.createRecovery(statePath, { warn: function () {} }, function () { return now; });
    assert.strictEqual(reloaded.isQuarantined('e39_m5_v2'), true, 'quarantine survives process restart');
    assert.strictEqual(fs.existsSync(statePath + '.tmp'), false, 'atomic rename leaves no temporary file');

    const backoff = Mock.createRecovery(null, null, function () { return now; });
    backoff.noteShown('layout_a', 1000);
    assert.strictEqual(backoff.onLoss('layout_a', 8000).delayMs, 3000, 'first retry waits 3 seconds');
    backoff.noteShown('layout_a', 12000);
    assert.strictEqual(backoff.onLoss('layout_a', 19000).delayMs, 10000, 'second retry waits 10 seconds');
    backoff.noteShown('layout_a', 22000);
    assert.strictEqual(backoff.onLoss('layout_a', 29000).delayMs, 30000, 'later retries cap at 30 seconds');

    const outsideWindow = Mock.createRecovery(null, null, function () { return now; });
    outsideWindow.noteShown('layout_b', 1000);
    assert.strictEqual(outsideWindow.onLoss('layout_b', 8001).rapid, false, 'loss after six seconds is not a strike');
    outsideWindow.noteShown('layout_b', 62000);
    assert.strictEqual(outsideWindow.onLoss('layout_b', 68001).strikes, 0, 'strikes expire after one minute');

    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    fs.rmdirSync(dir);
    process.stdout.write('Bench DCSM2 mock + rapid-loss quarantine/backoff: OK\\n');
}

try { run(); }
catch (error) {
    process.stderr.write((error && error.stack) || String(error));
    process.exitCode = 1;
}
