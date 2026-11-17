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

module.exports = { transition: transition };
