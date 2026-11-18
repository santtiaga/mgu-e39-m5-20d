'use strict';

const assert = require('assert');
const VehicleGate = require('../shared/vehicle_gate');

assert.deepStrictEqual(VehicleGate.evaluate({ conditionKnown: false }), {
    condition: undefined, off: false, hold: true,
}, 'unknown live vehicle state must fail closed');
assert.strictEqual(VehicleGate.evaluate({ conditionKnown: true, condition: 8 }).hold, true,
    'drive-readiness startup state must hold the panel');
assert.strictEqual(VehicleGate.evaluate({ conditionKnown: true, condition: 7 }).hold, false,
    'ignition-on state remains eligible for the panel');
assert.strictEqual(VehicleGate.evaluate({ conditionKnown: true, condition: 10 }).hold, false,
    'drive-ready state permits the panel');

let dropped = 0, statuses = 0, logs = 0;
const gate = {};
gate.build = { current: {} };
gate.widgets = new Map([['speed', {}]]);
gate.sheets = [{}];
gate.deferredRebuild = false;
gate.vehicleOff = false;
gate.vehicleOffLogged = false;
gate.log = { info: function () { logs++; } };
gate._dropLayoutLayers = function () {
    dropped++;
    this.build = null;
    this.widgets.clear();
    this.sheets = [];
};
gate._status = function () { statuses++; };

VehicleGate.hold(gate, { condition: 8, off: false, hold: true });
assert.strictEqual(dropped, 1, 'an unsafe transition must release an already active layout');
assert.strictEqual(gate.deferredRebuild, true, 'the next build is deferred');
assert.strictEqual(gate.vehicleOff, false, 'a starting state is not mislabeled as vehicle off');
assert.strictEqual(statuses, 1);
assert.strictEqual(logs, 1);

VehicleGate.hold(gate, { condition: 8, off: false, hold: true });
assert.strictEqual(dropped, 1, 'repeated unsafe samples do not repeatedly drop layers');
assert.strictEqual(statuses, 1, 'the hold transition is logged once');

VehicleGate.hold(gate, { condition: undefined, off: false, hold: true });
assert.strictEqual(dropped, 1, 'unknown state with no active layout remains safely held');

VehicleGate.hold(gate, { condition: 5, off: true, hold: true });
assert.strictEqual(gate.vehicleOff, true, 'parked/off state is tracked separately');
console.log('Vehicle-state gate: unknown/startup states hold and release active panel layers');
