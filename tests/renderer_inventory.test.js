'use strict';

const assert = require('assert');
const inventory = require('../shared/renderer_inventory');

const status = [
    'upload: cap 5500 KB/s (ceiling 5500, floor 2000): normal',
    'target panel: slot 0x203 scene 0x123 1920x720: shown',
    'target hud: slot 0x323 scene 0x124 800x480: idle',
    'layer 10 effect of apex_dash on panel, overlay z 10: shown',
    'layer 11 image of other_app on panel, content z 0: shown',
    'asset 20 r8 256x128 of apex_dash on panel: 1 writes',
    'asset 21 etc2rgba 64x64 of other_app on panel: 1 writes',\n    'scene 31 of scene_app sample: shown',
    ''
].join('\n');

const parsed = inventory.parseStatus(status);
assert.strictEqual(parsed.complete, true);
assert.strictEqual(parsed.layerCount, 2);
assert.deepStrictEqual(parsed.layerKinds, { effect: 1, image: 1 });
assert.strictEqual(parsed.assetCount, 2);
assert.strictEqual(parsed.assetBytes, (256 * 128 * 2) + (64 * 64));
assert.strictEqual(parsed.unmeasuredPixelResources, 2);
assert.strictEqual(parsed.pixelMemoryComplete, false);

assert.strictEqual(inventory.assetBytes('rgba8', 10, 5), 400);
assert.strictEqual(inventory.assetBytes('r8', 10, 5), 100);
assert.strictEqual(inventory.assetBytes('etc2rgb', 10, 5), 25);
assert.strictEqual(inventory.assetBytes('unknown', 10, 5), null);

const malformed = inventory.parseStatus([
    'upload: cap 5500 KB/s: normal',
    'target panel: shown',
    'layer record is truncated'
].join('\n'));
assert.strictEqual(malformed.complete, false);
assert.strictEqual(malformed.pixelMemoryComplete, false);

const unknownFormat = inventory.parseStatus([
    'upload: cap 5500 KB/s: normal',
    'target panel: shown',
    'asset 30 futurefmt 10x10 of app on panel: 0 writes'
].join('\n'));
assert.strictEqual(unknownFormat.complete, true);
assert.strictEqual(unknownFormat.unknownAssetFormats, 1);
assert.strictEqual(unknownFormat.pixelMemoryComplete, false);

assert.strictEqual(inventory.parseStatus('not a renderer status').complete, false);
console.log('renderer_inventory: all tests passed');
