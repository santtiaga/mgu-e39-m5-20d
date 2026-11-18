'use strict';

const assert = require('assert');
const VehicleState = require('../bench/vehicle_state');

assert.strictEqual(VehicleState.normalize('unknown'), 'unknown');
assert.strictEqual(VehicleState.normalize('safe'), 'safe');
assert.strictEqual(VehicleState.normalize('off'), 'off');
assert.strictEqual(VehicleState.normalize('anything-else'), 'unknown');
assert.strictEqual(VehicleState.condition('unknown'), 15, 'BMW no-value enum keeps the gate closed');
assert.strictEqual(VehicleState.condition('safe'), 10, 'FAHREN / READY permits the panel');
assert.strictEqual(VehicleState.condition('off'), 5, 'WOHNEN represents parked/off');
console.log('Bench vehicle-state mock: OK');
