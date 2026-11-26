'use strict';
const assert = require('assert');
const RendererNeedleMotion = require('../shared/renderer_needle_motion');

const m = new RendererNeedleMotion();
assert.strictEqual(m.retarget(0.5, 1000, 100), null, 'first target must seed rather than animate');
m.seed(0.2, 1000);
assert.deepStrictEqual(m.retarget(0.8, 1050, 100), [[0, 0.3], [100, 0.8]]);
assert(Math.abs(m.value(1100) - 0.55) < 1e-9, 'value should interpolate linearly');
const replacement = m.retarget(0.1, 1100, 100);
assert.deepStrictEqual(replacement, [[0, 0.55], [100, 0.1]], 'replacement must start at the in-flight value');
assert.strictEqual(m.retarget(0.1, 1150, 100), null, 'unchanged target must not create another animation');
assert.strictEqual(m.value(1300), 0.1, 'animation must clamp at its target');
console.log('renderer_needle_motion: continuous bounded retargeting passed');
