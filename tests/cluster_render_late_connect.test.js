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

/* Events queued by an old socket must not tear down a newer connection. */
{
    const oldSocket = new EventEmitter();
    const newSocket = new EventEmitter();
    const sockets = [oldSocket, newSocket];
    oldSocket.write = newSocket.write = function () { return true; };
    oldSocket.destroy = newSocket.destroy = function () { this.destroyed = true; };
    net.connect = function () { return sockets.shift(); };
    const client = new ClusterRender('apex_dash_stale_socket_test', '/tmp/unused.sock');
    client.connect();
    client.close();
    client.connect();
    assert.strictEqual(client.sock, newSocket, 'second connection is attached');
    client.blocked = true;
    let socketErrors = 0;
    client.on('socket-error', function () { socketErrors++; });
    oldSocket.emit('error', new Error('stale socket error'));
    oldSocket.emit('drain');
    oldSocket.emit('close');
    oldSocket.emit('connect');
    assert.strictEqual(client.sock, newSocket, 'stale close cannot detach the replacement socket');
    assert.strictEqual(client.blocked, true, 'stale drain cannot clear replacement backpressure');
    assert.strictEqual(client.timer, null, 'stale close cannot schedule a reconnect timer');
    assert.strictEqual(socketErrors, 0, 'stale socket errors are ignored');
    newSocket.emit('error', new Error('active socket error'));
    assert.strictEqual(socketErrors, 1, 'active socket errors are exposed to app diagnostics');
    client.close();
}

process.stdout.write('cluster_render_late_connect: stale socket events ignored\n');
} finally {
    net.connect = originalConnect;
}
