'use strict';

/**
 * Local model of a renderer-side, two-key uniform animation.
 *
 * cluster-render replaces an animation with the same ID, but its new keyframe
 * values are still explicit. Track the expected in-flight value locally so
 * each replacement starts at the interpolated point instead of snapping back.
 */
class RendererNeedleMotion {
    constructor() {
        this.reset();
    }

    reset() {
        this.from = null;
        this.to = null;
        this.startedAt = 0;
        this.duration = 0;
    }

    seed(value, at) {
        if (!Number.isFinite(value) || !Number.isFinite(at)) return false;
        this.from = value;
        this.to = value;
        this.startedAt = at;
        this.duration = 0;
        return true;
    }

    value(at) {
        if (this.from === null || !Number.isFinite(at)) return null;
        if (this.duration <= 0) return this.to;
        const t = Math.max(0, Math.min(1, (at - this.startedAt) / this.duration));
        return this.from + (this.to - this.from) * t;
    }

    retarget(target, at, duration) {
        if (!Number.isFinite(target) || !Number.isFinite(at) ||
            !Number.isFinite(duration) || duration <= 0) return null;
        if (this.from === null) {
            this.seed(target, at);
            return null;
        }
        if (Math.abs(target - this.to) < 0.0001) return null;
        const current = this.value(at);
        this.from = current;
        this.to = target;
        this.startedAt = at;
        this.duration = duration;
        return [[0, current], [duration, target]];
    }
}

module.exports = RendererNeedleMotion;
