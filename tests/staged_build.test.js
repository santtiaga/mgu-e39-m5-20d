'use strict';

const assert = require('assert');
const HudApp = require('../shared/hud');

function harness() {
    const calls = [];
    const h = Object.create(HudApp.prototype);
    h.log = { info: (s) => calls.push(s), error: (s) => calls.push(s) };
    h.build = {
        plan: [{}, {}], index: 0,
        current: { ref: 17, ci: 0, phase: 'hidden', c: { set: (ref, v) => calls.push(['set', ref, v]) } },
        timer: setTimeout(() => {}, 60000)
    };
    h._buildNext = () => calls.push('next');
    h._abortBuild = (why) => calls.push(['abort', why]);
    h._status = () => calls.push('status');
    return { h, calls };
}

{
    const { h, calls } = harness();
    h._buildLayerEvent(0, 17, 'hidden');
    assert.strictEqual(h.build.current.phase, 'revealing');
    assert(calls.some((x) => Array.isArray(x) && x[0] === 'set' && x[1] === 17 && x[2].visible === true));
    clearTimeout(h.build.timer);
}
{
    const { h, calls } = harness();
    h.build.current.phase = 'revealing';
    h._buildLayerEvent(0, 17, 'shown');
    assert.strictEqual(h.build.index, 1);
    assert.strictEqual(h.build.current, null);
    assert(calls.includes('next'));
    clearTimeout(h.build.timer);
}
{
    const { h, calls } = harness();
    h._buildLayerEvent(0, 17, 'error', 'shader rejected');
    assert(calls.some((x) => Array.isArray(x) && x[0] === 'abort' && /shader rejected/.test(x[1])));
    clearTimeout(h.build.timer);
}
{
    const { h, calls } = harness();
    h._buildLayerEvent(1, 17, 'hidden');
    assert.strictEqual(h.build.current.phase, 'hidden');
    assert.strictEqual(calls.length, 0);
    clearTimeout(h.build.timer);
}
console.log('staged_build: all tests passed');
