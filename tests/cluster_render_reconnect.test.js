'use strict';

/* Regression test: the renderer client must restore the complete image/asset
 * pixel buffers and retained layer state after the socket is re-established. */
const assert = require('assert');
const net = require('net');
const fs = require('fs');
const path = '/tmp/apex-dash-reconnect-' + process.pid + '.sock';
const { ClusterRender } = require('../shared/cluster_render_client');

function packet(type, body) {
    const out = Buffer.alloc(5 + body.length);
    out.writeUInt32LE(body.length + 1, 0);
    out[4] = type;
    body.copy(out, 5);
    return out;
}

function jsonPacket(value) {
    return packet(0x4a, Buffer.from(JSON.stringify(value), 'utf8'));
}

function collect(socket, list) {
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let off = 0;
        while (pending.length - off >= 5) {
            const len = pending.readUInt32LE(off);
            if (pending.length - off < 4 + len) break;
            const type = pending[off + 4];
            const body = pending.slice(off + 5, off + 4 + len);
            if (type === 0x4a) {
                try { list.push({ type: 'json', value: JSON.parse(body.toString('utf8')) }); } catch (e) {}
            } else if (type === 0x46) {
                const rectCount = body.readUInt16LE(12);
                list.push({ type: 'frame', rectCount: rectCount, pixels: body.slice(14 + rectCount * 8) });
            }
            off += 4 + len;
        }
        pending = pending.slice(off);
    });
}

const connections = [];
const received = [];
const server = net.createServer((socket) => {
    connections.push(socket);
    const messages = [];
    received.push(messages);
    collect(socket, messages);
    /* The fake renderer completes hello after the client's replay writes. */
    setTimeout(() => {
        if (!socket.destroyed) socket.write(jsonPacket({ ev: 'hello', backend: 'test', targets: 'panel' }));
    }, 20);
});

const client = new ClusterRender('apex_dash_test', path);
const assetPixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
const imagePixels = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
]);
const asset = client.asset({ target: 'panel', format: 'r8', w: 4, h: 2 });
const image = client.image({ target: 'panel', klass: 'overlay', z: 2, x: 0, y: 0, w: 2, h: 2, iw: 2, ih: 2 });
const effect = client.effect({ target: 'panel', x: 10, y: 10, w: 20, h: 20, fs: 'void main(){}' });
assert(asset && image && effect, 'test layers should be accepted locally');
assert.strictEqual(client.pixels(asset, null, assetPixels), true);
assert.strictEqual(client.pixels(image, null, imagePixels), true);
client.set(effect, { visible: false, opacity: 0.5 });
client.uniform(effect, 'u_level', [0.75]);
client.bind(effect, 'u_atlas', asset);
client.animate(effect, { property: 'rotate', keys: '0:0 1000:90', loop: true });

let readyCount = 0;
let finished = false;
let watchdog = null;

function fail(error) {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    client.close();
    server.close(() => {
        try { if (fs.existsSync(path)) fs.unlinkSync(path); } catch (e) {}
        console.error(error && error.stack || error);
        process.exitCode = 1;
    });
}

function finish() {
    if (finished) return;
    try {
        assert.strictEqual(readyCount, 2, 'client should reconnect and complete hello twice');
        assert(received.length >= 2, 'renderer should accept a second socket');
        const replay = received[1];
        const json = replay.filter((m) => m.type === 'json').map((m) => m.value);
        const frames = replay.filter((m) => m.type === 'frame');
        assert(json.some((m) => m.op === 'asset' && m.ref === asset), 'asset definition replayed');
        assert(json.some((m) => m.op === 'layer' && m.ref === image && m.kind === 'image'), 'image layer replayed');
        const effectMsg = json.find((m) => m.op === 'layer' && m.ref === effect);
        assert(effectMsg && effectMsg.visible === 0, 'latest layer settings replayed');
        assert(json.some((m) => m.op === 'uniform' && m.ref === effect && m.name === 'u_level'), 'uniform replayed');
        assert(json.some((m) => m.op === 'bind' && m.ref === effect && m.asset === asset), 'asset binding replayed');
        assert(json.some((m) => m.op === 'animate' && m.ref === effect), 'animation replayed');
        assert.strictEqual(frames.length, 2, 'both image and asset must be sent again');
        assert(frames.every((m) => m.rectCount === 0), 'reconnect must use full-frame pixel uploads');
        const payloads = frames.map((m) => m.pixels);
        assert(payloads.some((p) => p.equals(assetPixels)), 'full glyph/asset pixels restored byte-for-byte');
        assert(payloads.some((p) => p.equals(imagePixels)), 'full sheet pixels restored byte-for-byte');
        finished = true;
        clearTimeout(watchdog);
        client.close();
        server.close(() => {
            try { if (fs.existsSync(path)) fs.unlinkSync(path); } catch (e) {}
            console.log('cluster_render_reconnect: replay and full pixel restoration passed');
        });
    } catch (e) { fail(e); }
}

client.on('ready', () => {
    readyCount++;
    if (readyCount === 1) {
        /* Simulate a renderer restart after the first successful handshake. */
        setTimeout(() => { if (connections[0] && !connections[0].destroyed) connections[0].destroy(); }, 30);
    } else if (readyCount === 2) {
        setTimeout(finish, 100);
    }
});

watchdog = setTimeout(() => fail(new Error('timed out waiting for renderer reconnect')), 5000);
server.listen(path, () => client.connect());
