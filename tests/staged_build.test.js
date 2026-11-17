'use strict';

const assert = require('assert');
const staged = require('../shared/staged_build');
const transition = staged.transition;

function build() {
    return { index: 0, current: { ref: 17, ci: 0, phase: 'hidden' } };
}

{
    const b = build();
    assert.deepStrictEqual(transition(b, 0, 17, 'hidden'), { type: 'reveal' });
    assert.strictEqual(b.current.phase, 'revealing');
}
{
    const b = build();
    b.current.phase = 'revealing';
    assert.deepStrictEqual(transition(b, 0, 17, 'shown'), { type: 'shown' });
}
{
    const b = build();
    assert.deepStrictEqual(transition(b, 0, 17, 'error', 'shader rejected'),
        { type: 'abort', reason: 'shader rejected' });
}
{
    const b = build();
    assert.deepStrictEqual(transition(b, 0, 17, 'stalled'), { type: 'wait' });
    assert.strictEqual(transition(b, 1, 17, 'hidden'), null);
    assert.strictEqual(transition(b, 0, 99, 'hidden'), null);
}
{
    const b = { deadlineAt: 15000, remainingMs: 45000 };
    assert.strictEqual(staged.pause(b, 12000), 3000, 'pause preserves only the remaining budget');
    assert.strictEqual(b.deadlineAt, 0, 'paused deadline is inactive');
    assert.strictEqual(staged.resume(b, 50000), 3000, 'resume does not reset the full timeout');
    assert.strictEqual(b.deadlineAt, 53000, 'resume creates a new deadline from now');
    assert.strictEqual(staged.resume(b, 51000), null, 'double resume must not extend the deadline');
}
{
    const b = { deadlineAt: 0, remainingMs: 45000 };
    assert.strictEqual(staged.pause(b, 1000), 45000, 'pause before timer arm preserves full budget');
    assert.strictEqual(staged.resume(b, 1000), 45000, 'initial ready gets full budget');
}
console.log('staged_build: all tests passed');
