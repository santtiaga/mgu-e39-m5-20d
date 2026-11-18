'use strict';

// Synthetic DCSM2 provider state for the browser bench only. Never import from an app.
function normalize(state) {
    return state === 'unavailable' || state === 'unknown' ? state : 'available';
}

function statusLine(state) {
    const s = normalize(state);
    if (s === 'available') return 'dcsm: Dcsm2 available for 3 s; subscription: ok';
    if (s === 'unavailable') return 'dcsm: Dcsm2 not available for 2 s; subscription: no answer yet';
    return 'dcsm: Dcsm2 not available yet; subscription: no answer yet';
}

module.exports = { normalize, statusLine };
