'use strict';

const assert = require('assert');
const isPanelTarget = require('../shared/panel_target_guard');

assert.strictEqual(isPanelTarget({ config: { target: 'panel' } }), true);
assert.strictEqual(isPanelTarget({ config: { target: 'hud' } }), false);
assert.strictEqual(isPanelTarget({ config: {} }), false);
assert.strictEqual(isPanelTarget({}), false);
assert.strictEqual(isPanelTarget(null), false);

console.log('panel_target_guard: fail-closed panel-only startup passed');
