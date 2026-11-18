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
const { Canvas } = require('../../kit/runtime/canvas');

const LOG_LINES = 16;
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
        const LOG_W = 1920, LOG_H = 720;
        const LOG_FONT = 15;
        const LOG_LINE_HEIGHT = 34;

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

        const readLogLines = () => {
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
            return records.slice(-LOG_LINES).map((r) => {
                const clean = r.line.replace(/[\\r\\t]/g, ' ').replace(/\\s+/g, ' ').trim();
                return ('[' + r.source + '] ' + clean).slice(0, 220);
            });
        };

        const drawLogs = () => {
            const lines = readLogLines();
            const canvas = new Canvas(LOG_W, LOG_H);
            canvas.clear('#101318');
            canvas.text('APEX DASH  /  DIAGNOSTIC LOG', 48, 48, 25, '#f2f4f7', { literal: true });
            canvas.text('Latest 16 lines  |  Font 15 px', 48, 78, 15, '#8d98a8', { literal: true });
            canvas.fillRect(48, 96, LOG_W - 96, 1, '#3b4654');
            const shown = lines.length ? lines : ['Waiting for Apex Dash / cluster-render log entries...'];
            shown.forEach((line, i) => {
                const y = 126 + i * LOG_LINE_HEIGHT;
                const color = /\\b(FATAL|ERROR|INCIDENT)\\b/i.test(line) ? '#ff7777' :
                    /\\b(WARN|WARNING)\\b|stalled fetch|no answer after a fetch/i.test(line) ? '#f0c36a' : '#d8dee8';
                canvas.text(line, 48, y, LOG_FONT, color, { literal: true });
            });
            ctx.ui.image('LOG_GFX', canvas);
        };

        ctx.ui.onClick('OPEN_LOGS', () => {
            drawLogs();
            return ctx.ui.open('LOGS');
        });
        ctx.ui.onClick('LOG_REFRESH', () => drawLogs());
        ctx.ui.onClick('LOG_BACK', () => ctx.ui.open('MAIN'));

        process.on('exit', () => {
            process.removeListener('unhandledRejection', onUnhandledRejection);
            process.removeListener('exit', stopHudOnExit);
        });
    },
});
