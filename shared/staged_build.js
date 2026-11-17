'use strict';

/* Renderer-confirmed stage transitions. No client call is treated as an acknowledgement. */
function transition(build, ci, ref, state, reason) {
    const current = build && build.current;
    if (!current || current.ci !== ci || current.ref !== ref) return null;
    if (state === 'error') return { type: 'abort', reason: reason || 'layer error' };
    if (current.phase === 'hidden' && state === 'hidden') {
        current.phase = 'revealing';
        return { type: 'reveal' };
    }
    if (current.phase === 'revealing' && state === 'shown') return { type: 'shown' };
    if (state === 'waiting' || state === 'stalled') return { type: 'wait' };
    return null;
}

/**
 * Preserve a stage's remaining confirmation budget across a renderer disconnect.
 * The caller owns the timer; these helpers only maintain the deadline accounting.
 */
function pause(build, now) {
    if (!build || build.deadlineAt <= 0) return build ? Math.max(1, build.remainingMs || 45000) : 0;
    build.remainingMs = Math.max(1, build.deadlineAt - now);
    build.deadlineAt = 0;
    return build.remainingMs;
}

function resume(build, now) {
    if (!build || build.deadlineAt > 0) return null;
    const ms = Math.max(1, build.remainingMs || 45000);
    build.deadlineAt = now + ms;
    return ms;
}

module.exports = { transition: transition, pause: pause, resume: resume };
