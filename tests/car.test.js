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

// The cutoff is opt-in so other engine profiles retain their original rpm values.
assert.strictEqual(Car.engineRpm(160, 0), 160);
assert.strictEqual(Car.engineRpm(160), 160);
assert.strictEqual(Car.engineRpm(null, 400), null);
assert.strictEqual(Car.engineRpm(undefined, 400), undefined);


/* A live vehicle state is unknown until BMW sends a recognised value. */
{
    let vehicleStateHandler;
    const ctx = {
        spec: { config: {} },
        log: { info: function () {}, warn: function () {} },
        settings: { get: function () { return 'off'; } },
        signals: {
            watch: function (iface, instance, handlers) {
                vehicleStateHandler = handlers.VehicleCondition;
                return Promise.resolve({ available: false, shutdown: function () {} });
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
    vehicleStateHandler({ statusConditionVehicle: 15 });
    assert.strictEqual(car.data().conditionKnown, false,
        'an explicit no-value state closes the vehicle gate again');
    assert.deepStrictEqual(transitions, [
        { condition: 10, known: true },
        { condition: 10, known: false },
    ], 'an explicit no-value state is emitted immediately to close the gate');
    car.stop();
}

console.log('Car MHEV engine-speed cutoff and vehicle-state startup gate: OK');
