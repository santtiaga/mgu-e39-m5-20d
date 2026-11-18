'use strict';

/** Apex Dash replaces the instrument panel only; never fall back to the HUD target. */
module.exports = function isPanelTarget(spec) {
    return !!(spec && spec.config && spec.config.target === 'panel');
};
