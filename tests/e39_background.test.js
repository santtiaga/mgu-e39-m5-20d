'use strict';
const assert = require('assert');
const E39Background = require('../shared/e39_background');

const width = 320, height = 120;
const a = E39Background.render(width, height, false);
const b = E39Background.render(width, height, false);
const night = E39Background.render(width, height, true);
assert(Buffer.isBuffer(a), 'background must be a Buffer for cluster-render pixels');
assert.strictEqual(a.length, width * height * 4, 'RGBA byte count');
assert.deepStrictEqual(a, b, 'grain must be deterministic and baked, not animated');
assert.notDeepStrictEqual(a, night, 'day and night variants must differ');
console.log('e39_background: static RGBA render, deterministic grain and day/night variants passed');
