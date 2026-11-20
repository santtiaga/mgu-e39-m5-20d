'use strict';

const fs = require('fs');
const path = require('path');

const RAPID_LOSS_MS = 6000;
const STRIKE_WINDOW_MS = 60000;
const STRIKE_LIMIT = 2;
const RETRY_DELAYS_MS = [3000, 10000, 30000];

class DCSM2Recovery {
    constructor(statePath, log, now) {
        this.statePath = statePath || null;
        this.log = log || null;
        this.now = typeof now === 'function' ? now : Date.now;
        this.lastShown = null;
        this.lastLossAt = 0;
        this.retryIndex = 0;
        this.strikes = [];
        this.quarantined = Object.create(null);
        this._load();
    }

    _load() {
        if (!this.statePath) return;
        try {
            const saved = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            if (!saved || saved.version !== 1 || !saved.quarantined || typeof saved.quarantined !== 'object') return;
            Object.keys(saved.quarantined).forEach((name) => {
                if (!/^[a-z0-9_-]+$/i.test(name)) return;
                const item = saved.quarantined[name];
                if (item && Number.isFinite(item.at)) {
                    this.quarantined[name] = { at: item.at, reason: String(item.reason || 'repeated rapid DCSM2 loss') };
                }
            });
        } catch (_) { /* first launch or no quarantine file yet */ }
    }

    _save() {
        if (!this.statePath) return false;
        try {
            const dir = path.dirname(this.statePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
            const tmp = this.statePath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, quarantined: this.quarantined }));
            fs.renameSync(tmp, this.statePath);
            return true;
        } catch (error) {
            if (this.log && this.log.warn) this.log.warn('DCSM2 quarantine save failed: ' + (error.message || error));
            return false;
        }
    }

    noteShown(name, at) {
        if (!name || name === 'off') return;
        const now = Number.isFinite(at) ? at : this.now();
        if (this.lastLossAt && now - this.lastLossAt > STRIKE_WINDOW_MS) this.retryIndex = 0;
        this.lastShown = { name: String(name), at: now };
    }

    onLoss(name, at) {
        const now = Number.isFinite(at) ? at : this.now();
        const layout = name || (this.lastShown && this.lastShown.name);
        const rapid = !!(layout && this.lastShown && this.lastShown.name === layout &&
            now >= this.lastShown.at && now - this.lastShown.at <= RAPID_LOSS_MS);
        this.lastShown = null;
        this.lastLossAt = now;
        this.strikes = this.strikes.filter((t) => t > now - STRIKE_WINDOW_MS);
        if (rapid) this.strikes.push(now);

        const delayMs = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
        this.retryIndex++;
        let quarantined = false;
        if (rapid && this.strikes.length >= STRIKE_LIMIT) {
            quarantined = this.quarantine(layout, now, 'DCSM2 lost within ' + RAPID_LOSS_MS + ' ms of layout display twice within ' + STRIKE_WINDOW_MS + ' ms');
        }
        return {
            layout: layout || null,
            rapid: rapid,
            strikes: this.strikes.length,
            delayMs: delayMs,
            quarantined: quarantined,
        };
    }

    quarantine(name, at, reason) {
        if (!name || name === 'off') return false;
        this.quarantined[name] = {
            at: Number.isFinite(at) ? at : this.now(),
            reason: String(reason || 'repeated rapid DCSM2 loss'),
        };
        this._save();
        return true;
    }

    getQuarantine(name) {
        return name && this.quarantined[name] ? this.quarantined[name] : null;
    }

    isQuarantined(name) {
        return !!this.getQuarantine(name);
    }
}

DCSM2Recovery.RAPID_LOSS_MS = RAPID_LOSS_MS;
DCSM2Recovery.STRIKE_WINDOW_MS = STRIKE_WINDOW_MS;
DCSM2Recovery.STRIKE_LIMIT = STRIKE_LIMIT;
DCSM2Recovery.RETRY_DELAYS_MS = RETRY_DELAYS_MS.slice();
module.exports = DCSM2Recovery;
