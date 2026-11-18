'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const net = require('net');
const { ClusterRender } = require('../shared/cluster_render_client');

const originalConnect = net.connect;
const socket = new EventEmitter();
const writes = [];
socket.write = function (data) { writes.push(Buffer.from(data)); return true; };
socket.destroy = function () { this.destroyed = true; };

try {
    net.connect = function () { return socket; };
    const client = new ClusterRender('apex_dash_069_compat', '/tmp/unused-069.sock');
    const targets = [], layers = [];
    client.on('target', function () { targets.push(Array.prototype.slice.call(arguments)); });
    client.on('layer', function () { layers.push(Array.prototype.slice.call(arguments)); });
    client.connect();
    socket.emit('connect');

    assert(writes.length > 0, 'client sends hello after TCP connect');
    const hello = writes[0];
    assert.strictEqual(hello[4], 0x4a, 'hello uses JSON protocol frame');
    const body = JSON.parse(hello.slice(5).toString('utf8'));
    assert.deepStrictEqual(body, { op: 'hello', app: 'apex_dash_069_compat', proto: 1 },
        'client remains compatible with cluster-render protocol v1');

    // 0.6.9 adds richer target diagnostics; the local client must retain all
    // fields without adopting upstream's less defensive replay implementation.
    client._event({
        ev: 'target', target: 'panel', state: 'waiting', holder: 'stock',
        reason: 'fetch accepted, never completed', guide_disabled: 1,
        rendering: 'none', retry_in_ms: 1250, disabled: 0,
    });
    assert.deepStrictEqual(targets[0], [
        'panel', 'waiting', 'stock', 'fetch accepted, never completed',
        true, 'none', 1250, false,
    ]);

    client._event({ ev: 'layer', ref: 17, state: 'stalled', reason: 'upload timed out' });
    assert.deepStrictEqual(layers[0], [17, 'stalled', 'upload timed out']);

    client.close();
    console.log('cluster_render_069_compat: protocol v1 and 0.6.9 diagnostics passed');
} finally {
    net.connect = originalConnect;
}
