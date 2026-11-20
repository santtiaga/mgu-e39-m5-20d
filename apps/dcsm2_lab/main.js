'use strict';

const path = require('path');
const mgu = require('./kit/mgu');
const { ClusterRender } = require('./cluster_render_client');
const Benchmark = require('./dcsm2_lab_benchmark');

mgu.run({
    start(ctx) {
        const configuredTarget = ctx.spec && ctx.spec.config && ctx.spec.config.target;
        if (configuredTarget !== 'panel') {
            const message = 'DCSM2 Lab safety stop: config.target must be exactly "panel"; renderer not started.';
            ctx.log.error(message);
            ctx.ui.text('STATUS', message);
            return;
        }

        const logPath = path.join(ctx.dataDir, 'dcsm2_lab.log');
        const client = new ClusterRender('dcsm2_lab');
        const bench = new Benchmark(client, {
            logPath: logPath,
            log: ctx.log,
            status: (message) => ctx.ui.text('STATUS', message)
        });

        client.on('ready', () => {
            bench.write('CLIENT ready backend=' + client.backend + ' targets=' + client.targets);
            ctx.ui.text('STATUS', 'Connected to cluster-render; ready for benchmark');
            client.status();
        });
        client.on('disconnected', () => {
            bench.write('CLIENT disconnected');
            ctx.ui.text('STATUS', 'Renderer disconnected; waiting for reconnect');
        });
        client.on('socket-error', (error) => {
            bench.write('SOCKET_ERROR ' + (error && error.stack || error));
            ctx.ui.text('STATUS', 'Socket error: ' + (error && error.message || error));
        });
        client.on('diagnostic', (event) => bench.onDiagnostic(event));
        client.on('pixels-written', (event) => bench.write('PIXELS_WRITTEN ' + JSON.stringify(event)));
        client.on('status', (text) => bench.write('RENDERER_STATUS ' + text));
        client.on('layer', (ref, state, reason) => bench.onLayer(ref, state, reason));
        client.on('target', (name, state, holder, reason, guideDisabled, rendering, retryInMs, disabled) => {
            bench.write('TARGET ' + JSON.stringify({
                name: name, state: state, holder: holder, reason: reason,
                guideDisabled: guideDisabled, rendering: rendering,
                retryInMs: retryInMs, disabled: disabled
            }));
        });
        client.on('budget', (cap, max, reason) => {
            bench.write('BUDGET cap_kb_s=' + cap + ' max_kb_s=' + max + ' reason=' + reason);
        });
        client.on('refused', (op, ref, reason, line) => {
            bench.write('REFUSED op=' + op + ' ref=' + ref + ' reason=' + reason + ' line=' + line);
        });

        ctx.ui.onClick('RUN_FULL', async () => {
            try { await bench.runFull(); }
            catch (error) { bench.write('FATAL full benchmark: ' + (error && error.stack || error)); }
        });
        ctx.ui.onClick('RUN_BASE', async () => {
            try { await bench.runBasic(); }
            catch (error) { bench.write('FATAL basic benchmark: ' + (error && error.stack || error)); }
        });
        ctx.ui.onClick('RUN_SOAK', async () => {
            try { await bench.runSoak(30 * 60 * 1000); }
            catch (error) { bench.write('FATAL soak: ' + (error && error.stack || error)); }
        });
        ctx.ui.onClick('STOP', () => bench.stop());
        ctx.ui.onClick('RECONNECT', async () => {
            try { await bench.reconnect(); }
            catch (error) { bench.write('FATAL reconnect: ' + (error && error.stack || error)); }
        });
        ctx.ui.onClick('SHOW_LOG', () => {
            const message = 'Log: ' + logPath;
            bench.write('LOG_PATH ' + logPath);
            ctx.ui.text('STATUS', message);
            ctx.log.info(message);
        });

        const shutdown = () => {
            bench.stop();
            client.close();
        };
        ctx.app.on('shutdown', shutdown);
        process.on('exit', shutdown);

        bench.write('START app=dcsm2_lab target=panel socket=' + client.path + ' pid=' + process.pid + ' node=' + process.version);
        bench.write('NOTE independent of Apex Dash HUD/layout/watchdog; tests cluster-render effect API.');
        client.connect();
        ctx.ui.text('STATUS', 'Connecting to cluster-render...');
    }
});
