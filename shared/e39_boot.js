'use strict';

const fs = require('fs');
const path = require('path');

const DURATION_MS = 2500;
// VehicleCondition: 7 = KL15/ignition on, 8/10 = drive readiness, 12 = drive readiness ending.
const KL15_ON = [7, 8, 10, 12];

class E39Boot {
    constructor(statePath, log) {
        this.statePath = statePath || null;
        this.log = log || null;
        this.layoutReady = false;
        this.mode = 'boot';
        this.state = 'idle';
        this.kind = null;
        this.startedAt = 0;
        this.ignitionKnown = false;
        this.ignitionOn = false;
        this._load();
    }

    _load() {
        if (!this.statePath) return;
        try {
            const saved = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            if (!saved || saved.version !== 1) return;
            this.ignitionKnown = saved.ignitionKnown === true;
            this.ignitionOn = saved.ignitionOn === true;
            if (['pending', 'playing', 'completed'].includes(saved.state) &&
                ['auto', 'test'].includes(saved.kind)) {
                this.state = saved.state;
                this.kind = saved.kind;
                this.startedAt = Number.isFinite(saved.startedAt) ? saved.startedAt : 0;
            }
        } catch (_) { /* first launch: no persisted ignition cycle yet */ }
    }

    _save() {
        if (!this.statePath) return;
        try {
            const dir = path.dirname(this.statePath);
            fs.mkdirSync(dir, { recursive: true });
            const tmp = this.statePath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({
                version: 1, ignitionKnown: this.ignitionKnown, ignitionOn: this.ignitionOn,
                state: this.state, kind: this.kind, startedAt: this.startedAt,
            }));
            fs.renameSync(tmp, this.statePath);
        } catch (error) {
            if (this.log && this.log.warn) this.log.warn('E39 boot state save failed: ' + (error.message || error));
        }
    }

    _request(kind, force) {
        if (!force && (this.state === 'playing' || this.state === 'completed')) return false;
        this.state = 'pending';
        this.kind = kind;
        this.startedAt = 0;
        this._startIfReady();
        this._save();
        return true;
    }

    _startIfReady() {
        if (this.state !== 'pending' || !this.layoutReady) return;
        this.state = 'playing';
        this.startedAt = Date.now();
        this._save();
        if (this.log && this.log.info) this.log.info('E39 boot animation started (' + this.kind + ') after layout readiness');
    }

    setMode(mode) {
        mode = mode === 'test' || mode === 'off' ? mode : 'boot';
        const previous = this.mode;
        if (mode === previous) return;
        this.mode = mode;
        if (mode === 'off') {
            this.state = 'idle'; this.kind = null; this.startedAt = 0;
            this._save();
        } else if (mode === 'test' && previous !== 'test') {
            this._request('test', true);
        }
    }

    setLayoutReady(ready) {
        this.layoutReady = ready === true;
        if (this.layoutReady) this._startIfReady();
    }

    onCondition(condition) {
        if (!Number.isInteger(condition)) return;
        const on = KL15_ON.includes(condition);
        if (!this.ignitionKnown) {
            this.ignitionKnown = true;
            this.ignitionOn = on;
            // On a fresh app install, the first live KL15=ON sample represents startup.
            // A persisted ON state, however, survives process restarts without replay.
            if (on && this.mode === 'boot' && this.state === 'idle') this._request('auto');
            this._save();
            return;
        }
        const rising = on && !this.ignitionOn;
        const falling = !on && this.ignitionOn;
        this.ignitionOn = on;
        if (rising && this.mode === 'boot') this._request('auto');
        if (falling && this.kind === 'auto') {
            this.state = 'idle'; this.kind = null; this.startedAt = 0;
        }
        this._save();
    }

    tick(now) {
        if (this.state === 'pending') this._startIfReady();
        if (this.state !== 'playing') return 0;
        const dt = now - this.startedAt;
        if (dt < 0) return 0;
        if (dt >= DURATION_MS) {
            this.state = 'completed';
            this._save();
            return 0;
        }
        return Math.sin((dt / DURATION_MS) * Math.PI);
    }
}

E39Boot.DURATION_MS = DURATION_MS;
E39Boot.KL15_ON = KL15_ON;
module.exports = E39Boot;
