'use strict';
const assert = require('assert');
const E39Background = require('../shared/e39_background');

const width = 640, height = 400;
const a = E39Background.render(width, height, false);
const b = E39Background.render(width, height, false);
const night = E39Background.render(width, height, true);
assert(Buffer.isBuffer(a), 'background must be a Buffer for cluster-render pixels');
assert.strictEqual(a.length, width * height * 4, 'RGBA byte count');
assert.deepStrictEqual(a, b, 'grain must be deterministic and baked, not animated');
assert.notDeepStrictEqual(a, night, 'day and night variants must differ');
for (let i = 3; i < a.length; i += 4) assert.strictEqual(a[i], 255, 'opaque background layer');
const full = E39Background.render(1920, 720, false);
assert.strictEqual(full.length, 1920 * 720 * 4, 'full MGU panel RGBA byte count');
assert.strictEqual(full[3], 255, 'full panel alpha');
assert.strictEqual(full[full.length - 1], 255, 'last panel pixel alpha');
console.log('e39_background: static RGBA render, deterministic grain and day/night variants passed');
