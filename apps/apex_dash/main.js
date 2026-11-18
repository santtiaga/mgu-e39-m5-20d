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
const isPanelTarget = require('../../shared/panel_target_guard');

const LOG_LINES = 16;
const LOG_REFRESH_MS = 2000;
const LOG_HTTP_PORT = 18765;
const LOG_HTTP_MAX_BYTES = 512 * 1024;
// Reserve space for all four log sources so a large renderer log cannot crowd out Apex Dash diagnostics.
const LOG_HTTP_FILE_MAX_BYTES = 112 * 1024;

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
        const previousLogFile = logFile + '.1';
        const logToken = crypto.randomBytes(16).toString('hex');
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
            const readTail = (file, maxBytes) => {
                let fd = null;
                try {
                    fd = fs.openSync(file, 'r');
                    const size = fs.fstatSync(fd).size;
                    const length = Math.min(size, maxBytes || LOG_HTTP_MAX_BYTES);
                    const data = Buffer.alloc(length);
                    const bytesRead = length ? fs.readSync(fd, data, 0, length, size - length) : 0;
                    let start = 0;
                    if (size > length) {
                        // Start at a UTF-8 code-point boundary after slicing the file tail.
                        while (start < bytesRead && (data[start] & 0xC0) === 0x80) start++;
                    }
                    return data.slice(start, bytesRead).toString('utf8');
                } finally {
                    if (fd !== null) fs.closeSync(fd);
                }
            };
            const appendFiles = (heading, files) => {
                content += '\n===== ' + heading + ' =====\n';
                files.forEach((file) => {
                    try {
                        content += '\n--- ' + file + ' ---\n' + readTail(file, LOG_HTTP_FILE_MAX_BYTES) + '\n';
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
            const bytes = Buffer.from(content, 'utf8');
            if (bytes.length <= LOG_HTTP_MAX_BYTES) return content;
            let start = bytes.length - LOG_HTTP_MAX_BYTES;
            while (start < bytes.length && (bytes[start] & 0xC0) === 0x80) start++;
            return bytes.slice(start).toString('utf8');
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
            process.removeListener('exit', stopHudOnExit);
        });
    },
});
