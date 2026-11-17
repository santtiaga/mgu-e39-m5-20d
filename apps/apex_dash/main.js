'use strict';
/**
 * Cluster Themes: redraws the iDrive 7 instrument cluster through cluster-render.
 * The Logs screen provides an on-device view of the rotating app log.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const util = require('util');
const mgu = require('./kit/mgu');
const HudApp = require('./hud');

const LOG_LINES = 16;
const LOG_REFRESH_MS = 2000;
const LOG_HTTP_PORT = 18765;
const LOG_HTTP_MAX_BYTES = 512 * 1024;

function diagnosticText(value) {
    if (value instanceof Error) return value.stack || (value.name + ': ' + value.message);
    if (typeof value === 'string') return value;
    try { return util.inspect(value, { depth: 6, breakLength: 160, maxArrayLength: 100 }); }
    catch (e) { try { return JSON.stringify(value); } catch (ignored) { return String(value); } }
}

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
        const onUnhandledRejection = (reason) => {
            ctx.log.error('[process] unhandledRejection: ' + diagnosticText(reason));
        };
        process.on('unhandledRejection', onUnhandledRejection);
        hud.start();

        const logFile = path.join(ctx.dataDir, 'apex_dash.log');
        const previousLogFile = logFile + '.1';
        const logToken = crypto.randomBytes(4).toString('hex');
        const logPath = '/apex-log-' + logToken;
        let logServer = null;
        const localIPv4 = () => {
            const interfaces = os.networkInterfaces();
            const addresses = [];
            Object.keys(interfaces).forEach((name) => (interfaces[name] || []).forEach((entry) => {
                if (entry && entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
            }));
            return addresses;
        };
        const readFullLog = () => {
            let content = '';
            const appendFiles = (heading, files) => {
                content += '\n===== ' + heading + ' =====\n';
                files.forEach((file) => {
                    try {
                        const data = fs.readFileSync(file, 'utf8');
                        content += '\n--- ' + file + ' ---\n' + data + '\n';
                    } catch (e) {
                        const code = e && e.code || 'UNKNOWN';
                        const message = e && e.message || String(e);
                        content += '\n--- ' + file + ' ---\n[READ FAILED: ' + code + '] ' + message + '\n';
                        ctx.log.warn('Could not read ' + file + ': ' + message);
                    }
                });
            };
            appendFiles('APEX DASH APPLICATION LOG', [previousLogFile, logFile]);
            // cluster-render 0.6.8 documents these system log paths. Reading is
            // best-effort: the app may not have permission to access /var/opt.
            appendFiles('CLUSTER-RENDER SYSTEM LOG', [
                '/var/opt/cluster-render/log/cluster-render.log.1',
                '/var/opt/cluster-render/log/cluster-render.log',
            ]);
            return content.slice(-LOG_HTTP_MAX_BYTES);
        };
        const startLogServer = () => {
            logServer = http.createServer((req, res) => {
                if (req.method !== 'GET' || req.url !== logPath) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    return res.end('Not found');
                }
                const body = readFullLog();
                res.writeHead(200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Content-Disposition': 'attachment; filename="apex_dash.log"',
                    'Cache-Control': 'no-store',
                    'Content-Length': Buffer.byteLength(body, 'utf8'),
                });
                res.end(body);
            });
            logServer.on('error', (e) => {
                ctx.log.warn('Log transfer server: ' + (e && e.message || e));
                ctx.ui.text('TRANSFER_STATUS', 'Unavailable: ' + (e && e.code || 'server error'));
            });
            logServer.listen(LOG_HTTP_PORT, '0.0.0.0', () => {
                const addresses = localIPv4();
                ctx.ui.text('TRANSFER_HOST', addresses.length ? 'http://' + addresses[0] + ':' + LOG_HTTP_PORT : 'No LAN IPv4 address');
                ctx.ui.text('TRANSFER_PATH', logPath);
                ctx.ui.text('TRANSFER_STATUS', addresses.length > 1 ? 'Use this address; other interfaces: ' + addresses.slice(1).join(', ') : 'Open this address on a phone on the same network');
                ctx.log.info('Log transfer ready on port ' + LOG_HTTP_PORT + ' path ' + logPath + ' addresses=' + addresses.join(','));
            });
        };
        startLogServer();
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
        ctx.ui.onClick('OPEN_TRANSFER', () => {
            const addresses = localIPv4();
            ctx.ui.text('TRANSFER_HOST', addresses.length ? 'http://' + addresses[0] + ':' + LOG_HTTP_PORT : 'No LAN IPv4 address');
            ctx.ui.text('TRANSFER_PATH', logPath);
            ctx.ui.text('TRANSFER_STATUS', logServer && logServer.listening ? 'Open on a phone on the same network' : 'Transfer server is not available');
            return ctx.ui.open('TRANSFER');
        });
        ctx.ui.onClick('TRANSFER_REFRESH', () => {
            const addresses = localIPv4();
            ctx.ui.text('TRANSFER_HOST', addresses.length ? 'http://' + addresses[0] + ':' + LOG_HTTP_PORT : 'No LAN IPv4 address');
            ctx.ui.text('TRANSFER_PATH', logPath);
            ctx.ui.text('TRANSFER_STATUS', logServer && logServer.listening ? 'Open on a phone on the same network' : 'Transfer server is not available');
        });
        ctx.ui.onClick('TRANSFER_BACK', () => ctx.ui.open('MAIN'));

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
            if (logServer) { try { logServer.close(); } catch (e) {} }
            process.removeListener('unhandledRejection', onUnhandledRejection);
            try { hud.stop(); } catch (e) { /* exiting anyway */ }
        });
    },
});
