'use strict';

/* Apex Dash can defer replay visibility until its DCSM2 health check passes. */
const assert = require('assert');
const net = require('net');
const fs = require('fs');
const path = '/tmp/apex-dash-deferred-visibility-' + process.pid + '.sock';
const { ClusterRender } = require('../shared/cluster_render_client');

function jsonPacket(value) {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    const out = Buffer.alloc(5 + body.length);
    out.writeUInt32LE(body.length + 1, 0);
    out[4] = 0x4a;
    body.copy(out, 5);
    return out;
}

function collect(socket, messages) {
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let off = 0;
        while (pending.length - off >= 5) {
            const len = pending.readUInt32LE(off);
            if (pending.length - off < 4 + len) break;
            if (pending[off + 4] === 0x4a) {
                try { messages.push(JSON.parse(pending.slice(off + 5, off + 4 + len).toString('utf8'))); } catch (e) {}
            }
            off += 4 + len;
        }
        pending = pending.slice(off);
    });
}

const messages = [];
const connections = [];
const server = net.createServer((socket) => {
    connections.push(socket);
    const received = [];
    messages.push(received);
    collect(socket, received);
    setTimeout(() => {
        if (!socket.destroyed) socket.write(jsonPacket({ ev: 'hello', backend: 'test', targets: 'panel' }));
    }, 10);
});
const client = new ClusterRender('apex_dash_deferred_test', path);
client.deferReplayVisibility = true;
const image = client.image({ target: 'panel', klass: 'overlay', x: 0, y: 0, w: 4, h: 4, iw: 4, ih: 4, visible: true });
assert(image, 'image layer should be accepted locally');
assert.strictEqual(client.pixels(image, null, Buffer.alloc(4 * 4 * 4, 0x7f)), true);

let finished = false;
let watchdog = null;
function cleanup(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    client.close();
    server.close(() => {
        try { if (fs.existsSync(path)) fs.unlinkSync(path); } catch (e) {}
        if (error) {
            console.error(error && error.stack || error);
            process.exitCode = 1;
        } else {
            console.log('cluster_render_deferred_visibility: health suspension and reconnect visibility gate');
        }
    });
}

let readyCount = 0;
client.on('ready', () => {
    readyCount++;
    try {
        assert.strictEqual(client.replayVisibilityPending, true, 'each replay must leave visibility pending');
        const received = messages[readyCount - 1] || [];
        assert(!received.some((m) => m.op === 'set' && m.ref === image && m.visible === 1),
            'no visible=true command may be sent before the app health check');
        assert.strictEqual(client.restoreVisibility(), true, 'health gate can restore pending visibility');
        if (readyCount === 1) {
            // A same-socket DCSM2 uncertainty must hide the active layer without
            // losing its requested visibility; a reconnect while suspended must
            // keep it hidden until the health gate opens again.
            assert.strictEqual(client.suspendVisibility(), true, 'health uncertainty suspends active visibility');
            assert.strictEqual(client.layers.get(image).opts.visible, true,
                'suspension must not overwrite the caller requested visibility');
            client.set(image, { visible: true });
            assert.strictEqual(messages[0].filter((m) => m.op === 'set' && m.ref === image).slice(-1)[0].visible, 0,
                'ordinary updates cannot reveal a layer while visibility is suspended');
            setTimeout(() => {
                if (connections[0] && !connections[0].destroyed) connections[0].destroy();
            }, 40);
            return;
        }
        setTimeout(() => {
            try {
                assert.strictEqual(readyCount, 2, 'renderer should have reconnected exactly once');
                assert(received.some((m) => m.op === 'set' && m.ref === image && m.visible === 1),
                    'requested visibility is restored after the health gate on reconnect');
                assert.strictEqual(client.replayVisibilityPending, false, 'pending visibility is cleared');
                assert.strictEqual(client.restoreVisibility(), false, 'visibility restoration is one-shot');
                cleanup();
            } catch (e) { cleanup(e); }
        }, 40);
    } catch (e) { cleanup(e); }
});

watchdog = setTimeout(() => cleanup(new Error('timed out waiting for deferred replay and reconnect')), 3000);
server.listen(path, () => client.connect());
