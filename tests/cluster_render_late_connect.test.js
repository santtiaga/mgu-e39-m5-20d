'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const net = require('net');
const { ClusterRender } = require('../shared/cluster_render_client');

const originalConnect = net.connect;
const socket = new EventEmitter();
const writes = [];
socket.write = function (data) { writes.push(data); return true; };
socket.destroy = function () { this.destroyed = true; };

try {
    net.connect = function () { return socket; };
    const client = new ClusterRender('apex_dash_late_connect_test', '/tmp/unused.sock');
    client.connect();
    assert.strictEqual(client.sock, socket, 'fake socket is attached');

    client.close();
    assert.strictEqual(socket.destroyed, true, 'close destroys the socket');

    /* Simulate connect being delivered after close() won the race. */
    socket.emit('connect');

    assert.strictEqual(client.sock, null, 'late event cannot reattach the socket');
    assert.strictEqual(client.connected, false, 'late event cannot restore connected state');
    assert.strictEqual(client.ready, false, 'late event cannot restore ready state');
    assert.strictEqual(client.replaying, false, 'late event cannot restart replay');
    assert.strictEqual(writes.length, 0, 'late event cannot send a hello or replay data');
    process.stdout.write('cluster_render_late_connect: stale connect ignored after close\\n');
} finally {
    net.connect = originalConnect;
}
