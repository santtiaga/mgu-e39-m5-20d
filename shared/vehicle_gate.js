'use strict';

function evaluate(data) {
    const d = data || {};
    const c = d.condition;
    const known = d.conditionKnown !== false;
    const off = known && typeof c === 'number' && isFinite(c) && (c <= 5 || c === 12);
    return {
        condition: c,
        off: off,
        hold: d.conditionKnown === false ||
            (typeof c === 'number' && isFinite(c) && (c <= 5 || c === 8 || c === 12)),
    };
}

/** Release active panel content while the live vehicle state is unsafe or unknown. */
function hold(app, vehicle) {
    app.deferredRebuild = true;
    app.activeName = null;
    app.problem = 'waiting for a safe vehicle state';
    if (vehicle.off) app.vehicleOff = true;
    const hasLayout = !!(app.build || app.widgets.size || app.sheets.length);
    if (hasLayout) app._dropLayoutLayers();
    if (!app.vehicleOffLogged) {
        app.vehicleOffLogged = true;
        app.log.info('vehicle state ' + (vehicle.condition === undefined ? 'unknown' : vehicle.condition) +
            ': cluster layers ' + (hasLayout ? 'dropped' : 'held') + '; waiting for a safe vehicle state');
        app._status();
    }
}

module.exports = { evaluate: evaluate, hold: hold };
