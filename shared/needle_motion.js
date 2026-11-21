'use strict';

const LIMITS = {
    rpm: { rate: 16000, value: 6500 },
    speed: { rate: 180, value: 320 }
};

/**
 * Low-latency needle prediction for the E39 analog overlay.
 * BMW speed/RPM notifications arrive asynchronously (about 20 Hz); the HUD
 * paints at 40 Hz. A short, bounded velocity lead fills the gaps between
 * notifications without allowing stale samples to run away.
 */
class NeedleMotion {
    constructor() { this.reset(); }

    reset() {
        this.samples = {
            rpm: { value: null, at: 0, rate: 0 },
            speed: { value: null, at: 0, rate: 0 }
        };
    }

    sample(data, at) {
        if (!data || !isFinite(at)) return;
        ['rpm', 'speed'].forEach((key) => {
            const value = data[key], s = this.samples[key], limit = LIMITS[key];
            if (typeof value !== 'number' || !isFinite(value) || value < 0) return;
            if (s.value !== null) {
                const dt = at - s.at;
                if (dt >= 20 && dt <= 250) {
                    const rate = Math.max(-limit.rate, Math.min(limit.rate, (value - s.value) * 1000 / dt));
                    // Smooth only the derivative, not the measured value. This damps
                    // telemetry quantisation while preserving fast gear-change response.
                    s.rate += (rate - s.rate) * 0.55;
                } else if (dt > 250 || dt <= 0) {
                    s.rate = 0;
                }
            } else {
                s.rate = 0;
            }
            s.value = value;
            s.at = at;
        });
    }

    value(key, fallback, now) {
        const s = this.samples[key], limit = LIMITS[key];
        if (!s || s.value === null) return fallback;
        const age = now - s.at;
        if (age < 0 || age > 125) return fallback;
        const leadMs = Math.min(age, 35);
        return Math.max(0, Math.min(limit.value, s.value + s.rate * leadMs / 1000));
    }
}

module.exports = NeedleMotion;
