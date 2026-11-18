'use strict';

/*
 * Fair serial lane for the native SOME/IP binding.
 * Native buildProxy/init/subscribe/shutdown calls must not overlap: the BMW
 * binding can deadlock when entered concurrently or outside setImmediate.
 */
const URGENT_RUN = 3;
const STALL_MS = 1500;
const MAX_QUEUE = 128;

function linkQueue(log) {
    const queue = [];
    let pumping = false;
    let urgentRun = 0;
    let closed = false;
    let running = null;
    let stalls = 0;

    async function pump() {
        if (pumping || closed) return;
        pumping = true;
        while (queue.length && !closed) {
            const waiting = urgentRun >= URGENT_RUN ? queue.findIndex((item) => !item.urgent) : -1;
            const index = waiting >= 0 ? waiting : 0;
            const item = queue.splice(index, 1)[0];
            const started = Date.now();
            running = item;
            urgentRun = item.urgent ? urgentRun + 1 : 0;
            try {
                item.resolve(await item.fn());
            } catch (error) {
                item.reject(error);
            } finally {
                const elapsed = Date.now() - started;
                if (elapsed > STALL_MS) {
                    stalls++;
                    try {
                        if (log && log.warn) log.warn('SOME/IP native lane held ' + elapsed +
                            ' ms by ' + item.label + (queue.length ? ' (' + queue.length + ' waiting)' : ''));
                    } catch (ignored) {}
                }
                running = null;
            }
        }
        pumping = false;
        // A close may be reversed only by creating a new queue; never silently
        // resume work that was explicitly rejected during shutdown.
    }

    function exclusive(fn, urgent, label) {
        if (typeof fn !== 'function') return Promise.reject(new TypeError('SOME/IP queue requires a function'));
        if (closed) return Promise.reject(new Error('SOME/IP native lane is closed'));
        if (queue.length >= MAX_QUEUE) return Promise.reject(new Error('SOME/IP native queue is full'));
        return new Promise((resolve, reject) => {
            const item = { fn, resolve, reject, urgent: !!urgent, label: label || (urgent ? 'urgent' : 'read') };
            if (item.urgent) {
                const firstRead = queue.findIndex((entry) => !entry.urgent);
                queue.splice(firstRead < 0 ? queue.length : firstRead, 0, item);
            } else queue.push(item);
            pump();
        });
    }

    exclusive.close = (reason) => {
        if (closed) return;
        closed = true;
        const error = new Error(reason || 'SOME/IP native lane closed');
        while (queue.length) queue.shift().reject(error);
    };
    Object.defineProperties(exclusive, {
        stalls: { get: () => stalls },
        queued: { get: () => queue.length },
        running: { get: () => running && running.label || null },
    });
    return exclusive;
}

module.exports = { linkQueue, URGENT_RUN, STALL_MS, MAX_QUEUE };
