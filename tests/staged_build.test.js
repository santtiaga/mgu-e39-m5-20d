'use strict';

const assert = require('assert');
const transition = require('../shared/staged_build').transition;

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
console.log('staged_build: all tests passed');
