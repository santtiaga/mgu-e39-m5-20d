'use strict';
const assert = require('assert');
const path = require('path');
const { linkQueue, URGENT_RUN } = require(path.join(__dirname, '..', 'kit', 'runtime', 'link_queue'));

(async () => {
    const order = [];
    const q = linkQueue({ warn() {} });
    let active = 0, maxActive = 0;
    const task = (name) => () => new Promise((resolve) => setImmediate(() => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(name);
        active--;
        resolve(name);
    }));

    // A waiting read must get a turn after no more than three urgent turns.
    let keepUrgent = true;
    const urgent = () => q(async () => {
        order.push('u');
        if (keepUrgent) urgent();
    }, true, 'urgent');
    urgent();
    const read = q(task('read'), false, 'read');
    const result = await read;
    keepUrgent = false;
    assert.strictEqual(result, 'read');
    assert(order.indexOf('read') >= 0 && order.indexOf('read') <= URGENT_RUN,
        'normal work must run after at most ' + URGENT_RUN + ' urgent turns');

    // Urgent FIFO ordering and serial execution.
    const order2 = [];
    const q2 = linkQueue({ warn() {} });
    const t = (name) => () => new Promise((resolve) => setImmediate(() => { order2.push(name); resolve(name); }));
    await Promise.all([
        q2(t('normal-1'), false, 'normal-1'),
        q2(t('normal-2'), false, 'normal-2'),
        q2(t('urgent-1'), true, 'urgent-1'),
        q2(t('urgent-2'), true, 'urgent-2'),
    ]);
    assert.deepStrictEqual(order2, ['urgent-1', 'urgent-2', 'normal-1', 'normal-2']);

    // A rejected native operation must not poison the lane.
    await assert.rejects(q2(() => Promise.reject(new Error('expected')), true, 'reject'), /expected/);
    assert.strictEqual(await q2(() => Promise.resolve('after-error'), false), 'after-error');

    // Closing rejects queued work but lets an in-flight native operation settle.
    const q3 = linkQueue({ warn() {} });
    let finish;
    const inFlight = q3(() => new Promise((resolve) => { finish = resolve; }), true, 'in-flight');
    const queued = q3(() => Promise.resolve('must-not-run'), false, 'queued');
    q3.close('test close');
    await assert.rejects(queued, /test close/);
    finish('settled');
    assert.strictEqual(await inFlight, 'settled');
    console.log('link_queue: fairness, FIFO, error recovery and shutdown checks pass');
})().catch((error) => { console.error(error); process.exit(1); });
