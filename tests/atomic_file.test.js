'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const atomic = require(path.join(__dirname, '..', 'kit', 'runtime', 'atomic_file'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgu-atomic-'));
const warnings = [];
const log = { warn: (message) => warnings.push(message) };
try {
    const settings = path.join(dir, 'settings.json');
    assert.strictEqual(atomic.writeAtomicFile(settings, '{"theme":"day"}', true, log), true);
    assert.strictEqual(fs.readFileSync(settings, 'utf8'), '{"theme":"day"}');

    // A failed replacement must leave the last complete settings file intact.
    assert.strictEqual(atomic.writeAtomicFile(path.join(dir, 'missing', 'settings.json'), '{}', true, log), false);
    assert.strictEqual(fs.readFileSync(settings, 'utf8'), '{"theme":"day"}');

    const image = path.join(dir, 'frame.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    atomic.writeImageResource(image, png, log);
    assert.deepStrictEqual(fs.readFileSync(image), png);
    assert(fs.readdirSync(dir).indexOf('frame.png') >= 0);
    assert(!fs.readdirSync(dir).some((name) => name.indexOf('.tmp.') >= 0));
    console.log('atomic_file: durable settings, failed-write preservation and complete image publication pass');
} finally {
    fs.readdirSync(dir).forEach((name) => fs.unlinkSync(path.join(dir, name)));
    fs.rmdirSync(dir);
}
