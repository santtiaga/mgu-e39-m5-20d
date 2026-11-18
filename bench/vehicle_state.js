'use strict';

// BMW VehicleCondition.statusConditionVehicle values, taken from kit/runtime/car.js.
const STATES = { unknown: 15, safe: 10, off: 5 };

function normalize(value) {
    return Object.prototype.hasOwnProperty.call(STATES, value) ? value : 'unknown';
}

function condition(value) {
    return STATES[normalize(value)];
}

module.exports = { normalize, condition, STATES };
