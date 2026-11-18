'use strict';

/*
 * DCSM2 availability is reported by cluster-render's status response.
 * This deliberately does not open a second SOME/IP/DCSM client: cluster-render
 * owns the display connection and exposes its availability to app clients.
 */
const POLL_WAITING_MS = 1500;
const POLL_AVAILABLE_MS = 5000;

function parseStatus(text) {
    const match = /(?:^|\n)\s*dcsm:\s*(?:Dcsm2|DCSM provider)\s+(not available yet|not available|available)\b/i.exec(String(text || ''));
    if (!match) return null;
    const state = match[1].toLowerCase();
    if (state === 'available') return 'available';
    if (state === 'not available yet') return 'unknown';
    return 'unavailable';
}

class DCSM2Watchdog {
    constructor(client, onChange, log) {
        this.client = client;
        this.onChange = typeof onChange === 'function' ? onChange : function () {};
        this.log = log || null;
        this.state = 'unknown';
        this.reason = 'waiting for cluster-render status';
        this.timer = null;
        this.stopped = false;
    }

    connected() {
        if (this.stopped) return;
        this._schedule(0);
    }

    disconnected() {
        if (this.stopped) return;
        this._cancel();
        this._set('unknown', 'cluster-render disconnected');
    }

    status(text) {
        if (this.stopped) return;
        const state = parseStatus(text);
        if (state === null) return;
        const reason = state === 'available' ? 'cluster-render reports DCSM2 available'
            : state === 'unavailable' ? 'cluster-render reports DCSM2 not available'
                : 'cluster-render has not received DCSM2 availability yet';
        this._set(state, reason);
    }

    _set(state, reason) {
        if (this.stopped) return;
        const previous = this.state;
        const changed = state !== previous || reason !== this.reason;
        if (!changed) return;
        this.state = state;
        this.reason = reason;
        if (this.log) {
            const message = 'DCSM2 watchdog: ' + state + (reason ? ' (' + reason + ')' : '');
            if (state === 'unavailable') this.log.warn(message);
            else this.log.info(message);
        }
        this.onChange(state, reason, previous);
    }

    _schedule(ms) {
        if (this.stopped) return;
        this._cancel();
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.stopped || !this.client.ready) return;
            try {
                this.client.status();
            } catch (error) {
                // A transient socket write failure must not kill the timer or
                // leave DCSM2 monitoring permanently stopped.
                if (this.log) this.log.warn('DCSM2 watchdog: status request failed: ' +
                    (error && error.message || error));
            }
            this._schedule(this.state === 'available' ? POLL_AVAILABLE_MS : POLL_WAITING_MS);
        }, ms);
    }

    _cancel() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    stop() {
        this.stopped = true;
        this._cancel();
    }
}

DCSM2Watchdog.parseStatus = parseStatus;
module.exports = DCSM2Watchdog;
