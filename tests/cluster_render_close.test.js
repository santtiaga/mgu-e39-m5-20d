'use strict';

const assert = require('assert');
const { ClusterRender } = require('../shared/cluster_render_client');

const client = new ClusterRender('apex_dash_close_test');
let destroyed = false;
client.sock = { destroy: function () { destroyed = true; } };
client.connected = true;
client.ready = true;
client.blocked = true;
client.replaying = true;
client.replayVisibilitySent = true;
client.replayVisibilityPending = true;
client.visibilitySuspended = true;
client.helloReceived = true;
client.inbuf = Buffer.from('partial protocol frame');
client.pendingFrames.set(7, Buffer.from('stale video frame'));
client.close();

assert.strictEqual(destroyed, true, 'close destroys the active socket');
assert.strictEqual(client.sock, null, 'closed socket is detached before destroy');
assert.strictEqual(client.connected, false, 'close clears connected state');
assert.strictEqual(client.ready, false, 'close clears ready state');
assert.strictEqual(client.blocked, false, 'close clears backpressure state');
assert.strictEqual(client.replaying, false, 'close clears replay state');
assert.strictEqual(client.replayVisibilitySent, false, 'close clears replay visibility sent state');
assert.strictEqual(client.replayVisibilityPending, false, 'close clears deferred replay visibility state');
assert.strictEqual(client.visibilitySuspended, false, 'close clears temporary visibility suspension');
assert.strictEqual(client.helloReceived, false, 'close clears handshake state');
assert.strictEqual(client.inbuf.length, 0, 'close drops a partial inbound frame');
assert.strictEqual(client.pendingFrames.size, 0, 'close drops stale queued video frames');
process.stdout.write('cluster_render_close: explicit close clears transient socket and visibility state\n');