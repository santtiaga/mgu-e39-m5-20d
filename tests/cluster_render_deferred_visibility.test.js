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
const server = net.createServer((socket) => {
    collect(socket, messages);
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
            console.log('cluster_render_deferred_visibility: visibility waits for health gate');
        }
    });
}

client.on('ready', () => {
    try {
        assert.strictEqual(client.replayVisibilityPending, true, 'replay must leave visibility pending');
        assert(!messages.some((m) => m.op === 'set' && m.ref === image && m.visible === 1),
            'no visible=true command may be sent before the app health check');
        assert.strictEqual(client.restoreVisibility(), true, 'health gate can restore pending visibility');
        setTimeout(() => {
            try {
                assert(messages.some((m) => m.op === 'set' && m.ref === image && m.visible === 1),
                    'requested visibility is restored after the health gate');
                assert.strictEqual(client.replayVisibilityPending, false, 'pending visibility is cleared');
                assert.strictEqual(client.restoreVisibility(), false, 'visibility restoration is one-shot');
                cleanup();
            } catch (e) { cleanup(e); }
        }, 40);
    } catch (e) { cleanup(e); }
});

watchdog = setTimeout(() => cleanup(new Error('timed out waiting for deferred replay')), 3000);
server.listen(path, () => client.connect());
