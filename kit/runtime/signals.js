'use strict';
/**
 * signals.js - read live vehicle signals over SOME/IP.
 *
 * Interface configs come from the app's own oap_<uid>/someipInterfaces/,
 * which the installer generates from the app's manifest.json with BMW's own
 * generator (kit/tools/oapgen) against the unit's master catalog
 * /etc/oap/someip/someip-interfaces.json - exactly what MainApp does when it
 * installs an app. So any interface/field listed in app.json "signals" is
 * reachable, not just the trimmed MainApp subset.
 *
 *   const sub = await signals.watch('de.bmw.infotainment.vehicle.CDS', '1', {
 *       statusEngineSpeed2: (v) => rpm = v.actualValueRPMEngineCrankshaft,
 *   });
 *   sub.available  // true once the provider (the car) answers
 */
const fs = require('fs');
const path = require('path');
const { linkQueue } = require('./link_queue');

let someip = null;
try { someip = require('someip'); } catch (e) { /* host preview / not installed */ }

const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIRS = [path.join(APP_ROOT, 'someipInterfaces'), path.join(__dirname, '..', '..', 'someipdefs')];

// The native binding deadlocks (main thread stuck on a futex) when buildProxy/
// init run inline inside the app's promise chains next to the SDK's own SOME/IP
// traffic. The SDK always calls them from a fresh setImmediate tick, one at a
// time - do the same.
let queueLogger = null;
const nativeQueue = linkQueue({ warn: (message) => { if (queueLogger && queueLogger.warn) queueLogger.warn(message); } });
function nativeTick(fn, urgent, label) {
    return nativeQueue(() => new Promise((resolve, reject) => {
        setImmediate(() => {
            try { Promise.resolve(fn()).then(resolve, reject); }
            catch (error) { reject(error); }
        });
    }), urgent !== false, label || 'native operation');
}

function loadConfig(iface) {
    const f = iface.replace(/\./g, '_') + '.json';
    for (const d of DIRS) {
        try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { /* next */ }
    }
    throw new Error('no SOME/IP config for ' + iface + ' (add it to app.json "signals")');
}

/**
 * Build a proxy and subscribe to fields. handlers = { fieldName: fn(value) }.
 * Also does an initial getValue() for fields that have a getter, so values
 * show up without waiting for the next change.
 * opts.pollMs: also re-read those fields that often while the provider is available - for
 * fields a car may not notify (BMW's x_call only ever reads TPMS, it never subscribes).
 * opts.onAvailability(available): called on provider availability changes when the binding supports it.
 */
async function watch(iface, instance, handlers, log, opts) {
    if (log) queueLogger = log;
    let pollTimer = null;
    let active = true;
    const fetching = Object.create(null);
    let shutdownPromise = null;
    const res = { iface, available: false, availabilityMonitored: false, proxy: null, error: null, shutdown: () => Promise.resolve() };
    if (!someip) { res.error = 'someip native module not available'; return res; }
    try {
        const cfg = loadConfig(iface);
        const p = await nativeTick(() => someip.buildProxy(cfg, String(instance)).then((px) => px.init().then(() => px)), true, 'build/init ' + iface);
        res.proxy = p;
        res.shutdown = () => {
            if (shutdownPromise) return shutdownPromise;
            active = false;
            res.available = false;
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
            // Proxy shutdown is the native binding's subscription teardown:
            // it releases field and availability subscriptions together.
            shutdownPromise = nativeTick(() => p.shutdown && p.shutdown(), true, 'shutdown ' + iface)
                .catch((error) => {
                    if (log) log.warn('signals shutdown ' + iface + ': ' + (error && error.message || error));
                })
                .then(() => { if (res.proxy === p) res.proxy = null; });
            return shutdownPromise;
        };
        const fields = Object.keys(handlers || {});
        const fetchAll = () => {
            if (!active) return;
            fields.forEach((f) => {
                if (!active || !(cfg.fields && cfg.fields[f] && cfg.fields[f].getter) || fetching[f]) return;
                fetching[f] = true;
                nativeTick(() => p.getValue(f, 3000), false, 'get ' + iface + '.' + f).then((v) => { if (active) handlers[f](v); }).catch(() => {}).then(() => { fetching[f] = false; });
            });
        };
        let availabilitySupported = true;
        await nativeTick(() => {
            try {
                return p.subscribeToAvailability((a) => {
                    if (!active) return;
                    res.available = !!a;
                    if (opts && typeof opts.onAvailability === 'function') {
                        try { opts.onAvailability(res.available); }
                        catch (e) { if (log) log.warn(iface + ' availability: ' + e); }
                    }
                    if (a) setImmediate(() => { if (active) fetchAll(); });
                });
            } catch (e) {
                availabilitySupported = false;
                return null; /* older binding */
            }
        }, true, 'availability ' + iface);
        res.availabilityMonitored = availabilitySupported;
        for (const f of fields) {
            try {
                await nativeTick(() => p.subscribe({ name: f, onReceive: (v) => { if (!active) return; try { handlers[f](v); } catch (e) { if (log) log.warn(iface + '.' + f + ': ' + e); } } }), true, 'subscribe ' + iface + '.' + f);
            } catch (e) {
                if (log) log.warn('subscribe ' + iface + '.' + f + ': ' + e);
            }
        }
        const initiallyAvailable = await nativeTick(() => p.isAvailable && p.isAvailable(), true, 'availability check ' + iface);
        if (active && initiallyAvailable) { res.available = true; fetchAll(); }
        if (opts && opts.pollMs) pollTimer = setInterval(() => { if (active && res.available) setImmediate(() => { if (active) fetchAll(); }); }, opts.pollMs);
    } catch (e) {
        res.error = String(e);
        res.available = false;
        if (log) log.warn('signals ' + iface + ': ' + e);
        // A failed async subscription can happen after buildProxy/init already
        // succeeded. Do not leave that partially initialised native proxy alive.
        if (res.proxy && res.shutdown) {
            try { await res.shutdown(); }
            catch (shutdownError) {
                if (log) log.warn('signals shutdown after init failure ' + iface + ': ' + (shutdownError && shutdownError.message || shutdownError));
            }
            res.proxy = null;
        }
    }
    return res;
}

/** Call a method on an interface instance (e.g. UDS over InternalTasu). */
async function proxy(iface, instance) {
    if (!someip) throw new Error('someip native module not available');
    const cfg = loadConfig(iface);
    return nativeTick(() => someip.buildProxy(cfg, String(instance)).then((p) => p.init().then(() => p)), true, 'proxy/init ' + iface);
}

/** Call a method on a proxy from proxy(); params = the method's argument struct. */
function call(p, method, params, timeoutMs) {
    return nativeTick(() => p.callMethod(method, params || {}, timeoutMs || 5000), true, 'call ' + method);
}

/**
 * Write a field that has a setter (e.g. ConditionBasedServicesLegacy.cBSReset) on a proxy from
 * proxy() or watch().proxy, as BMW's SDK does (_someIpProxy.setValue). value = the field's struct;
 * resolves when the provider took it. Needs "w" in the field's app.json flags, or the installer
 * leaves the setter out of the app's interface config.
 */
function set(p, field, value, timeoutMs) {
    return nativeTick(() => p.setValue(field, value, timeoutMs || 5000), true, 'set ' + field);
}

/** Subscribe to a broadcast/event or field on a proxy from proxy(). */
function on(p, name, fn, log) {
    return nativeTick(() => p.subscribe({ name, onReceive: (v) => { try { fn(v); } catch (e) { if (log) log.warn(name + ': ' + e); } } }), true, 'subscribe ' + name);
}

/** Availability of a proxy's provider; fn(bool) on every change. */
function onAvailable(p, fn) {
    return nativeTick(() => { try { return p.subscribeToAvailability((a) => fn(!!a)); } catch (e) { return null; } }, true, 'availability subscribe')
        .then(() => nativeTick(() => p.isAvailable && p.isAvailable(), true, 'availability check'))
        .then((available) => { if (available) fn(true); });
}

module.exports = { watch, proxy, call, set, on, onAvailable, loadConfig, hasNative: () => !!someip };
