'use strict';
/**
 * Cluster Themes: redraws the iDrive 7 instrument cluster through cluster-render.
 * The Logs screen provides an on-device view of the rotating app log.
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const mgu = require('./kit/mgu');
const HudApp = require('./hud');
const isPanelTarget = require('../../shared/panel_target_guard');

const LOG_LINES = 16;
const LOG_SCROLL_MS = 750;
const LOG_BUFFER_LINES = 80;
const LOG_TAIL_BYTES = 96 * 1024;

function diagnosticText(value) {
    if (value instanceof Error) return value.stack || (value.name + ': ' + value.message);
    if (typeof value === 'string') return value;
    try { return util.inspect(value, { depth: 6, breakLength: 160, maxArrayLength: 100 }); }
    catch (e) { try { return JSON.stringify(value); } catch (ignored) { return String(value); } }
}

mgu.run({
    start(ctx) {
        if (!isPanelTarget(ctx.spec)) {
            const configuredTarget = ctx.spec && ctx.spec.config && ctx.spec.config.target;
            const message = 'Apex Dash safety stop: target must be exactly "panel" (configured: ' + String(configuredTarget) + '). Renderer was not started.';
            ctx.log.error(message);
            ctx.ui.text('STATUS', message);
            return;
        }
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            ctx.log.error('Cluster failed to start: ' + (e && e.stack || e));
            ctx.ui.text('STATUS', 'Cluster failed to start: ' + (e && e.message || e));
            return;
        }

        hud.onStatus((s) => { ctx.ui.text('STATUS', s); });
        const onUnhandledRejection = (reason) => {
            if (hud.stopped) return;
            const detail = diagnosticText(reason);
            ctx.log.error('[process] unhandledRejection: ' + detail);
            // The process-level listener keeps Node 8 alive; also count the fault
            // so repeated unhandled async failures reach the latched safety stop.
            hud.safety.record('process unhandledRejection', reason instanceof Error ? reason : new Error(detail));
        };
        process.on('unhandledRejection', onUnhandledRejection);
        // Install shutdown cleanup before start(): a synchronous renderer/UI
        // startup failure must not leave partially-created timers or sockets.
        const stopHudOnExit = () => {
            try { hud.stop(); } catch (e) { /* process is exiting */ }
            process.removeListener('unhandledRejection', onUnhandledRejection);
        };
        // MainApp's shutdown event precedes the runtime's 200 ms exit delay;
        // start async TASU/native cleanup while that grace period is available.
        ctx.app.on('shutdown', stopHudOnExit);
        process.on('exit', stopHudOnExit);
        try {
            hud.start();
        } catch (e) {
            const detail = e && (e.stack || e.message) || String(e);
            ctx.log.error('Cluster failed to start: ' + detail);
            try { hud.stop(); } catch (stopError) {
                ctx.log.warn('Cluster startup cleanup: ' + (stopError && stopError.message || stopError));
            }
            ctx.ui.text('STATUS', 'Cluster failed to start: ' + (e && e.message || e));
            return;
        }

        const logFile = path.join(ctx.dataDir, 'apex_dash.log');
        const logFiles = [
            { source: 'APEX', file: logFile + '.1' },
            { source: 'APEX', file: logFile },
            { source: 'CR', file: '/var/opt/cluster-render/log/cluster-render.log.1' },
            { source: 'CR', file: '/var/opt/cluster-render/log/cluster-render.log' },
        ];
        let logBuffer = [];
        let logCursor = 0;
        let lastDisplayed = [];
        let logTimer = null;

        const readTailLines = (file) => {
            let fd = null;
            try {
                fd = fs.openSync(file, 'r');
                const size = fs.fstatSync(fd).size;
                const length = Math.min(size, LOG_TAIL_BYTES);
                if (!length) return [];
                const data = Buffer.alloc(length);
                const bytesRead = fs.readSync(fd, data, 0, length, size - length);
                let offset = 0;
                if (size > length) {
                    while (offset < bytesRead && (data[offset] & 0xC0) === 0x80) offset++;
                }
                return data.slice(offset, bytesRead).toString('utf8').split(/\\r?\\n/).filter(Boolean);
            } catch (e) {
                return [];
            } finally {
                if (fd !== null) {
                    try { fs.closeSync(fd); } catch (e) {}
                }
            }
        };

        const readLogBuffer = () => {
            const records = [];
            let order = 0;
            logFiles.forEach(({ source, file }) => {
                readTailLines(file).forEach((line) => {
                    const stamp = (line.match(/^(\\d{4}-\\d{2}-\\d{2}[T ][^ ]+)/) || [])[1] || '';
                    records.push({ source, line, stamp, order: order++ });
                });
            });
            records.sort((a, b) => {
                if (a.stamp && b.stamp) return a.stamp.localeCompare(b.stamp) || a.order - b.order;
                if (a.stamp) return -1;
                if (b.stamp) return 1;
                return a.order - b.order;
            });
            return records.slice(-LOG_BUFFER_LINES).map((r) => {
                const clean = r.line.replace(/[\\r\\t]/g, ' ').replace(/\\s+/g, ' ').trim();
                return '[' + r.source + '] ' + clean;
            });
        };

        const refreshLogs = () => {
            logBuffer = readLogBuffer();
            if (!logBuffer.length) logBuffer = ['Waiting for Apex Dash / cluster-render log entries...'];
            const maxStart = Math.max(0, logBuffer.length - LOG_LINES);
            logCursor = Math.min(logCursor, maxStart);
            const visible = logBuffer.slice(logCursor, logCursor + LOG_LINES);
            while (visible.length < LOG_LINES) visible.push('');
            const updates = [];
            visible.forEach((line, i) => {
                if (lastDisplayed[i] !== line) {
                    lastDisplayed[i] = line;
                    updates.push(ctx.ui.text('LOG_LINE_' + String(i + 1).padStart(2, '0'), line));
                }
            });
            logCursor = Math.min(maxStart, logCursor + 1);
            return Promise.all(updates);
        };

        ctx.ui.onClick('OPEN_LOGS', () => {
            logCursor = 0;
            lastDisplayed = [];
            refreshLogs();
            return ctx.ui.open('LOGS');
        });
        ctx.ui.onClick('LOG_REFRESH', () => {
            logCursor = 0;
            lastDisplayed = [];
            return refreshLogs();
        });
        ctx.ui.onClick('LOG_BACK', () => ctx.ui.open('MAIN'));

        const setLogRefresh = (visible) => {
            if (visible && logTimer === null) {
                logCursor = 0;
                lastDisplayed = [];
                refreshLogs();
                logTimer = setInterval(refreshLogs, LOG_SCROLL_MS);
            } else if (!visible && logTimer !== null) {
                clearInterval(logTimer);
                logTimer = null;
            }
        };
        ctx.ui.onVisible((name, visible) => {
            if (name === 'LOGS') setLogRefresh(visible);
        });
        process.on('exit', () => {
            if (logTimer !== null) clearInterval(logTimer);
            process.removeListener('unhandledRejection', onUnhandledRejection);
            process.removeListener('exit', stopHudOnExit);
        });;
    },
});
