'use strict';

const BOOST_INVALID = 255;
const BOOST_FRESH_MS = 2000;

/** Convert BMW's FES sport-display pressure step to bar in the car's selected unit. */
function boostBar(raw, pressureUnit) {
    if (typeof raw !== 'number' || !isFinite(raw) || raw < 0 || raw >= BOOST_INVALID) return null;
    return pressureUnit === 'PSI' ? raw * 0.1 / 14.5038 : raw * 0.01;
}

/** The sport display's first sample may be an uninitialised placeholder. */
function boostFresh(moved, at, now) {
    return moved === true && typeof at === 'number' && isFinite(at) &&
        at > 0 && now >= at && now - at < BOOST_FRESH_MS;
}

module.exports = { BOOST_INVALID, BOOST_FRESH_MS, boostBar, boostFresh };
