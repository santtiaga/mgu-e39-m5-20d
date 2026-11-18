'use strict';

const assert = require('assert');
const createRegistry = require('../shared/layout_generation').createRegistry;

const registry = createRegistry();
const first = registry.begin({ layout: 'e39_m5_v2' });
assert.strictEqual(first.state, 'building');
assert.strictEqual(registry.track(first, 0, 11), true);
assert.strictEqual(registry.track(first, 1, 7), true);
assert.strictEqual(registry.track(first, 0, 11), true, 'same layer ref is tracked once');
assert.strictEqual(registry.ready(first), true);
assert.strictEqual(registry.activate(first).activated, true);
assert.strictEqual(registry.current().id, first.id);
assert.strictEqual(registry.track(first, 0, 12), false, 'active generations are immutable');

const second = registry.begin({ layout: 'e39_m5_v2_night' });
assert.strictEqual(registry.track(second, 0, 21), true);
assert.strictEqual(registry.activate(second).activated, false, 'building generation cannot activate');
assert.strictEqual(registry.ready(second), true);
const swap = registry.activate(second);
assert.strictEqual(swap.activated, true);
assert.strictEqual(swap.previous.id, first.id);
assert.strictEqual(first.state, 'retiring');
assert.strictEqual(registry.current().id, second.id);

const retired = registry.release(first);
assert.deepStrictEqual(retired, [{ ci: 0, ref: 11 }, { ci: 1, ref: 7 }]);
assert.strictEqual(first.state, 'released');
assert.deepStrictEqual(registry.release(first), [], 'release is idempotent');
assert.strictEqual(registry.current().id, second.id);

const candidate = registry.begin({ layout: 'broken' });
assert.strictEqual(registry.track(candidate, 2, 31), true);
assert.deepStrictEqual(registry.release(candidate), [{ ci: 2, ref: 31 }]);
assert.strictEqual(candidate.state, 'released');
assert.strictEqual(registry.current().id, second.id, 'aborting candidate leaves active generation unchanged');
assert.strictEqual(registry.activate(candidate).activated, false);

console.log('layout_generation_lifecycle: all tests passed');
