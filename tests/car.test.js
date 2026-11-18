'use strict';

const assert = require('assert');
const Car = require('../kit/runtime/car');

assert.strictEqual(Car.conditionOf('FAHREN'), 10);
assert.strictEqual(Car.conditionOf(7), 7);
assert.strictEqual(Car.conditionOf(6), undefined, 'undocumented enum values fail closed');
assert.strictEqual(Car.conditionOf(9), undefined, 'undocumented enum values fail closed');
assert.strictEqual(Car.conditionOf(15), undefined, 'BMW no-value enum fails closed');

// The B47 MHEV can keep reporting a low residual crank speed after the ICE stops.
assert.strictEqual(Car.engineRpm(0, 400), 0);
assert.strictEqual(Car.engineRpm(160, 400), 0);
assert.strictEqual(Car.engineRpm(399.75, 400), 0);
assert.strictEqual(Car.engineRpm(400, 400), 400);
assert.strictEqual(Car.engineRpm(800, 400), 800);

// Torque values are only current while the engine signal is fresh; stale values
// must not be paired with new RPM samples in power/torque calculations.
assert.strictEqual(Car.freshTorque(500, 1000, 1200), 500);
assert.strictEqual(Car.freshTorque(500, 1000, 3000), 500);
assert.strictEqual(Car.freshTorque(500, 1000, 3001), null);
assert.strictEqual(Car.freshTorque(500, 3000, 2000), null, 'future timestamps are rejected');
assert.strictEqual(Car.freshTorque(null, 1000, 1200), null);

{
    let torqueHandler;
    const ctx = {
        spec: { config: {} },
        log: { info: function () {}, warn: function () {} },
        settings: { get: function () { return 'off'; } },
        signals: {
            watch: function (iface, instance, handlers) {
                torqueHandler = handlers.statusActualValueTorque2;
                return Promise.resolve({ available: true, shutdown: function () {} });
            }
        }
    };
    const car = new Car(ctx, ['torque']);
    torqueHandler({ actualValueTorqueCrankshaft: 3047 }); // 500 Nm at 0.5 Nm/bit, offset -1023.5
    assert.strictEqual(car.data().torque, 500, 'fresh torque signal is exposed');
    car.live.torqueAt = Date.now() - 2001;
    assert.strictEqual(car.data().torque, null, 'stale torque is not reused indefinitely');
    torqueHandler({ actualValueTorqueCrankshaft: 4095 });
    assert.strictEqual(car.data().torque, null, 'invalid torque sentinel clears the value');
    car.stop();
}

// The cutoff is opt-in so other engine profiles retain their original rpm values.
assert.strictEqual(Car.engineRpm(160, 0), 160);
assert.strictEqual(Car.engineRpm(160), 160);
assert.strictEqual(Car.engineRpm(null, 400), null);
assert.strictEqual(Car.engineRpm(undefined, 400), undefined);


/* A live vehicle state is unknown until BMW sends a recognised value. */
{
    let vehicleStateHandler, vehicleStateAvailability;
    const ctx = {
        spec: { config: {} },
        log: { info: function () {}, warn: function () {} },
        settings: { get: function () { return 'off'; } },
        signals: {
            watch: function (iface, instance, handlers, log, options) {
                vehicleStateHandler = handlers.VehicleCondition;
                vehicleStateAvailability = options && options.onAvailability;
                return Promise.resolve({ available: true, availabilityMonitored: true, shutdown: function () {} });
            }
        }
    };
    const car = new Car(ctx, ['condition']);
    assert.strictEqual(car.data().conditionKnown, false,
        'the initial live state must fail closed until BMW reports vehicle condition');
    const transitions = [];
    car.onSample(function (data) { transitions.push({ condition: data.condition, known: data.conditionKnown }); });
    vehicleStateHandler({ statusConditionVehicle: 15 });
    assert.strictEqual(car.carPresent(), true,
        'an explicit no-value response still counts as live data and must suppress demo=auto fallback');
    assert.strictEqual(car.data().conditionKnown, false);
    vehicleStateHandler({ statusConditionVehicle: 'FAHREN' });
    assert.strictEqual(car.data().condition, 10);
    assert.strictEqual(car.data().conditionKnown, true,
        'a recognised drive-ready state unlocks the vehicle gate');
    assert.deepStrictEqual(transitions, [{ condition: 10, known: true }],
        'a recognised vehicle state is emitted immediately without waiting for RPM/speed');
    vehicleStateAvailability(false);
    assert.strictEqual(car.data().conditionKnown, false,
        'provider loss closes the live vehicle-state gate immediately');
    assert.deepStrictEqual(transitions[1], { condition: 10, known: false },
        'provider loss is emitted without waiting for another vehicle signal');
    vehicleStateAvailability(true);
    assert.strictEqual(car.data().conditionKnown, false,
        'provider recovery alone does not reuse a stale vehicle state');
    vehicleStateHandler({ statusConditionVehicle: 'FAHREN' });
    assert.strictEqual(car.data().conditionKnown, true,
        'a fresh vehicle-state event is required to reopen the gate');
    vehicleStateHandler({ statusConditionVehicle: 15 });
    assert.strictEqual(car.data().conditionKnown, false,
        'an explicit no-value state closes the vehicle gate again');
    assert.deepStrictEqual(transitions, [
        { condition: 10, known: true },
        { condition: 10, known: false },
        { condition: 10, known: true },
        { condition: 10, known: false },
    ], 'provider loss and no-value state both emit immediate gate closures');
    car.stop();
}


/* Auto-demo must never put simulated driving data on the real instrument panel. */
{
    const makeContext = (target, mode) => ({
        spec: { config: { target: target } },
        log: { info: function () {}, warn: function () {} },
        settings: { get: function () { return mode; } },
        signals: { watch: function () { return Promise.resolve({ available: false, shutdown: function () {} }); } },
    });
    const panelAuto = new Car(makeContext('panel', 'auto'), []);
    panelAuto.t0 = Date.now() - 6000;
    assert.strictEqual(panelAuto._wantDemo(), false,
        'missing live signals must not trigger simulated driving on the instrument panel');
    panelAuto.stop();

    const panelManual = new Car(makeContext('panel', 'on'), []);
    assert.strictEqual(panelManual._wantDemo(), true,
        'manual demo mode remains available for deliberate bench testing');
    panelManual.stop();

    const hudAuto = new Car(makeContext('hud', 'auto'), []);
    hudAuto.t0 = Date.now() - 6000;
    assert.strictEqual(hudAuto._wantDemo(), true,
        'non-panel targets retain the existing automatic demo fallback');
    hudAuto.stop();
}

console.log('Car MHEV engine-speed cutoff and vehicle-state startup gate: OK');
