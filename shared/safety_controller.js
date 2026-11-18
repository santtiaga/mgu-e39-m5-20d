'use strict';

/**
 * Central error budget for the Apex Dash runtime.
 *
 * Guards both synchronous callbacks and rejected promises. A burst of errors
 * trips one latched safety stop; callers must deliberately restart the app
 * before rendering can resume. The controller never throws from its handlers.
 */
function createSafetyController(options) {
    const o = options || {};
    const log = o.log || { error: function () {}, warn: function () {} };
    const now = typeof o.now === 'function' ? o.now : Date.now;
    const limit = Number.isInteger(o.errorLimit) && o.errorLimit > 0 ? o.errorLimit : 5;
    const windowMs = Number.isFinite(o.errorWindowMs) && o.errorWindowMs > 0 ? o.errorWindowMs : 10000;
    const onTrip = typeof o.onTrip === 'function' ? o.onTrip : function () {};
    let errors = [];
    let tripped = false;
    let lastError = null;
    const lastLog = Object.create(null);

    function record(name, error) {
        const at = now();
        const label = String(name || 'unknown');
        const detail = error && (error.stack || error.message) || String(error);
        lastError = { name: label, message: detail, at: at };
        try {
            if (!(lastLog[label] > at - windowMs)) {
                lastLog[label] = at;
                log.error('[safety] ' + label + ': ' + detail);
            }
        } catch (ignored) { /* logging must not break the safety path */ }
        errors = errors.filter(function (t) { return t > at - windowMs; });
        errors.push(at);
        if (!tripped && errors.length >= limit) {
            tripped = true;
            const incident = { count: errors.length, windowMs: windowMs, lastError: lastError };
            try { log.error('[safety] latched stop after ' + errors.length + ' errors in ' + windowMs + ' ms'); } catch (ignored2) {}
            try { onTrip(incident); } catch (tripError) {
                try { log.error('[safety] stop handler failed: ' + (tripError && tripError.stack || tripError)); } catch (ignored3) {}
            }
        }
    }

    function guard(name, fn) {
        if (typeof fn !== 'function') throw new TypeError('guard requires a function');
        return function guarded() {
            if (tripped) return undefined;
            try {
                const result = fn.apply(this, arguments);
                if (result && typeof result.then === 'function') {
                    return result.then(function (value) { return value; }, function (error) {
                        record(name, error);
                        return undefined;
                    });
                }
                return result;
            } catch (error) {
                record(name, error);
                return undefined;
            }
        };
    }

    return {
        guard: guard,
        record: record,
        tripped: function () { return tripped; },
        lastError: function () { return lastError; },
        errorCount: function () { return errors.length; },
        reset: function () { errors = []; tripped = false; lastError = null; },
    };
}

module.exports = createSafetyController;
