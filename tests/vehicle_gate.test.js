'use strict';

const assert = require('assert');
const HudApp = require('../shared/hud');

const gate = Object.create(HudApp.prototype);
assert.deepStrictEqual(gate._vehicleGate({ conditionKnown: false }), {
    condition: undefined, off: false, hold: true,
}, 'unknown live vehicle state must fail closed');
assert.strictEqual(gate._vehicleGate({ conditionKnown: true, condition: 8 }).hold, true,
    'drive-readiness startup state must hold the panel');
assert.strictEqual(gate._vehicleGate({ conditionKnown: true, condition: 7 }).hold, false,
    'ignition-on state remains eligible for the panel');
assert.strictEqual(gate._vehicleGate({ conditionKnown: true, condition: 10 }).hold, false,
    'drive-ready state permits the panel');

let dropped = 0, statuses = 0, logs = 0;
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

gate._holdForVehicle({ condition: 8, off: false, hold: true });
assert.strictEqual(dropped, 1, 'an unsafe transition must release an already active layout');
assert.strictEqual(gate.deferredRebuild, true, 'the next build is deferred');
assert.strictEqual(gate.vehicleOff, false, 'a starting state is not mislabeled as vehicle off');
assert.strictEqual(statuses, 1);
assert.strictEqual(logs, 1);

gate._holdForVehicle({ condition: 8, off: false, hold: true });
assert.strictEqual(dropped, 1, 'repeated unsafe samples do not repeatedly drop layers');
assert.strictEqual(statuses, 1, 'the hold transition is logged once');

gate._holdForVehicle({ condition: undefined, off: false, hold: true });
assert.strictEqual(dropped, 1, 'unknown state with no active layout remains safely held');

gate._holdForVehicle({ condition: 5, off: true, hold: true });
assert.strictEqual(gate.vehicleOff, true, 'parked/off state is tracked separately');
console.log('Vehicle-state gate: unknown/startup states hold and release active panel layers');
