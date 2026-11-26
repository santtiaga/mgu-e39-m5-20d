'use strict';
const assert = require('assert');
const { ClusterRender } = require('../shared/cluster_render_client');

const cr = new ClusterRender('animation-test');
const sent = [];
cr._send = (message) => sent.push(message);
const ref = cr._add('effect', { target: 'panel', x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' });
assert(ref > 0);

assert.strictEqual(cr.animate(ref, {
    anim: 41, property: 'uniform', name: 'u_rpm', keys: [[0, 0.2], [100, 0.8]]
}), 41);
assert.strictEqual(cr.animate(ref, {
    anim: 41, property: 'uniform', name: 'u_rpm', keys: [[0, 0.5], [100, 0.1]]
}), 41);
assert.strictEqual(cr.layers.get(ref).anims.size, 1, 'same animation ID must replace the retained client record');
assert.strictEqual(cr.layers.get(ref).anims.get(41).keys, '0:0.5 100:0.1');
assert.strictEqual(sent.filter((m) => m.op === 'animate').length, 2);
assert(sent.every((m) => m.op !== 'animate' || m.anim === 41), 'replacement must reuse the ID');

const next = cr.animate(ref, { property: 'uniform', name: 'u_speed', keys: [[0, 0], [100, 1]] });
assert.strictEqual(next, 42, 'automatic IDs must remain unique after an explicit ID');
assert.strictEqual(cr.animate(ref, { anim: 0, property: 'uniform', name: 'u_speed', keys: [[0, 0], [1, 1]] }), 0);
console.log('cluster_render_client: stable animation IDs and replacement passed');
