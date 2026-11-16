'use strict';
/**
 * Cluster Themes: redraws the iDrive 7 instrument cluster through cluster-render.
 * The Logs screen provides an on-device view of the rotating app log.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const HudApp = require('./hud');

const LOG_LINES = 16;
const LOG_REFRESH_MS = 2000;

mgu.run({
    start(ctx) {
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            ctx.log.error('Cluster failed to start: ' + (e && e.stack || e));
            ctx.ui.text('STATUS', 'Cluster failed to start: ' + (e && e.message || e));
            return;
        }

        hud.onStatus((s) => { ctx.ui.text('STATUS', s); });
        hud.start();

        const logFile = path.join(ctx.dataDir, 'apex_dash.log');
        const previousLogFile = logFile + '.1';
        const readLogLines = () => {
            let content = '';
            // The rotated file is older; the active file is newer.
            [previousLogFile, logFile].forEach((file) => {
                try {
                    if (fs.existsSync(file)) content += fs.readFileSync(file, 'utf8') + '\n';
                } catch (e) {
                    ctx.log.warn('Could not read ' + file + ': ' + (e && e.message || e));
                }
            });
            return content.split(/\r?\n/).filter(Boolean).slice(-LOG_LINES);
        };
        const refreshLogs = () => {
            const lines = readLogLines();
            const padding = new Array(Math.max(0, LOG_LINES - lines.length)).fill('');
            const visible = padding.concat(lines);
            return Promise.all(visible.map((line, i) =>
                ctx.ui.text('LOG_LINE_' + String(i + 1).padStart(2, '0'), line)
            ));
        };

        ctx.ui.onClick('OPEN_LOGS', () => {
            refreshLogs();
            return ctx.ui.open('LOGS');
        });
        ctx.ui.onClick('LOG_REFRESH', refreshLogs);
        ctx.ui.onClick('LOG_BACK', () => ctx.ui.open('MAIN'));

        let logTimer = null;
        const setLogRefresh = (visible) => {
            if (visible && logTimer === null) {
                refreshLogs();
                logTimer = setInterval(refreshLogs, LOG_REFRESH_MS);
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
            try { hud.stop(); } catch (e) { /* exiting anyway */ }
        });
    },
});
