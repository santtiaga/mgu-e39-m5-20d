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
    let urgentCount = 0;
    const urgentJobs = [];
    for (let i = 0; i < 6; i++) {
        urgentJobs.push(q(() => new Promise((resolve) => setImmediate(() => {
            order.push('u' + (++urgentCount));
            resolve();
        })), true, 'urgent-' + i));
    }
    const read = q(task('read'), false, 'read');
    const result = await read;
    await Promise.all(urgentJobs);
    assert.strictEqual(result, 'read');
    const readAt = order.indexOf('read');
    assert(readAt >= 0 && readAt <= URGENT_RUN,
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
    let rejected = false;
    try { await q2(() => Promise.reject(new Error('expected')), true, 'reject'); }
    catch (error) { rejected = /expected/.test(error.message); }
    assert(rejected, 'rejected native operation must reject its caller');
    assert.strictEqual(await q2(() => Promise.resolve('after-error'), false), 'after-error');

    // Closing rejects queued work but lets an in-flight native operation settle.
    const q3 = linkQueue({ warn() {} });
    let finish;
    const inFlight = q3(() => new Promise((resolve) => { finish = resolve; }), true, 'in-flight');
    const queued = q3(() => Promise.resolve('must-not-run'), false, 'queued');
    q3.close('test close');
    let queuedRejected = false;
    try { await queued; } catch (error) { queuedRejected = /test close/.test(error.message); }
    assert(queuedRejected, 'closing must reject queued native operations');
    finish('settled');
    assert.strictEqual(await inFlight, 'settled');
    console.log('link_queue: fairness, FIFO, error recovery and shutdown checks pass');
})().catch((error) => { console.error(error); process.exit(1); });
