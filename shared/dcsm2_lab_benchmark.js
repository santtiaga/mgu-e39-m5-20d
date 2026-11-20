'use strict';

const fs = require('fs');
const shaders = require('./shaders');

const SOLID_FS = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'void main() { gl_FragColor = vec4(0.08, 0.85, 0.22, 0.08); }'
].join('\n');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function loopShader(iterations) {
    return [
        'precision mediump float;',
        'varying vec2 v_uv;',
        'uniform float u_phase;',
        'void main() {',
        '  float v = v_uv.x * 0.37 + v_uv.y * 0.61 + u_phase;',
        '  for (int i = 0; i < ' + iterations + '; ++i) {',
        '    v = fract(v * 1.6180339 + sin(float(i) * 0.071 + u_phase));',
        '  }',
        '  gl_FragColor = vec4(v * 0.12, v * 0.08, v * 0.04, 0.035);',
        '}'
    ].join('\n');
}

function e39Shader(mask) {
    const names = [
        'E39_MASK_LOOP_408', 'E39_MASK_LOOP_427',
        'E39_MASK_LOOP_508', 'E39_MASK_LOOP_593',
        'E39_MASK_LOOP_648', 'E39_MASK_LOOP_801',
        'E39_MASK_LOOP_904', 'E39_MASK_LOOP_936'
    ];
    const defines = names.filter((name, bit) => (mask & (1 << bit)) !== 0)
        .map((name) => '#define ' + name).join('\n');
    return shaders.e39dash.replace(
        '// E39_MASK_DEFINES (expanded per widget before shader compilation)',
        defines
    );
}

class Benchmark {
    constructor(client, options) {
        this.client = client;
        this.options = options || {};
        this.logPath = this.options.logPath || '/tmp/dcsm2_lab.log';
        this.running = false;
        this.stopRequested = false;
        this.refs = new Set();
        this.layerStates = new Map();
        this.startedAt = 0;
        this.testCount = 0;
        this.failures = 0;
        this.lastStatusAt = 0;
        this.write('BENCHMARK_ENGINE initialized');
    }

    write(message) {
        const line = new Date().toISOString() + ' ' + message;
        try { fs.appendFileSync(this.logPath, line + '\n'); } catch (e) {}
        if (this.options.log && this.options.log.info) this.options.log.info('[DCSM2 LAB] ' + message);
    }

    status(message) {
        if (this.options.status) this.options.status(message);
        this.write('STATUS ' + message);
    }

    onDiagnostic(event) {
        this.write('DIAGNOSTIC ' + JSON.stringify(event));
    }

    onLayer(ref, state, reason) {
        this.layerStates.set(ref, { state: state, reason: reason, at: Date.now() });
        this.write('LAYER ref=' + ref + ' state=' + state + ' reason=' + reason);
    }

    _assertRunning() {
        if (this.stopRequested) throw new Error('Stopped by user');
    }

    async _wait(ms) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            this._assertRunning();
            await sleep(Math.min(250, end - Date.now()));
        }
    }

    async _waitReady(timeoutMs) {
        const deadline = Date.now() + (timeoutMs || 20000);
        while (!this.client.ready && Date.now() < deadline) {
            this._assertRunning();
            await sleep(200);
        }
        if (!this.client.ready) throw new Error('cluster-render did not become ready before timeout');
    }

    _createEffect(label, width, height, fsSource, uniforms) {
        const ref = this.client.effect({
            target: 'panel',
            klass: 'content',
            z: 90,
            x: 0,
            y: 0,
            w: width,
            h: height,
            visible: true,
            fs: fsSource
        });
        if (!ref) {
            this.failures++;
            this.write('CREATE_REFUSED label=' + label + ' size=' + width + 'x' + height);
            return 0;
        }
        this.refs.add(ref);
        if (uniforms) {
            Object.keys(uniforms).forEach((name) => this.client.uniform(ref, name, uniforms[name]));
        }
        this.write('CREATE label=' + label + ' ref=' + ref + ' size=' + width + 'x' + height);
        return ref;
    }

    async _observe(ref, label, durationMs) {
        await this._wait(durationMs);
        const state = this.layerStates.get(ref);
        this.testCount++;
        if (state && state.state === 'shown') {
            this.passed++;
            this.write('RESULT PASS label=' + label + ' ref=' + ref + ' state=shown rendererReady=' + this.client.ready);
        } else if (state && (state.state === 'error' || state.state === 'stalled')) {
            this.failures++;
            this.write('RESULT FAIL label=' + label + ' ref=' + ref + ' state=' + state.state + ' reason=' + state.reason);
        } else {
            this.inconclusive++;
            this.write('RESULT INCONCLUSIVE label=' + label + ' ref=' + ref +
                ' state=' + (state ? state.state : 'no-layer-event') +
                ' rendererReady=' + this.client.ready +
                ' note="layer shown is not proof of physical pixel visibility"');
        }
    }

    _drop(ref, label) {
        if (!ref) return;
        this.client.drop(ref);
        this.refs.delete(ref);
        this.write('DROP label=' + label + ' ref=' + ref);
    }

    async _singleEffect(label, width, height, fsSource, uniforms, durationMs) {
        this._assertRunning();
        const ref = this._createEffect(label, width, height, fsSource, uniforms);
        if (!ref) return;
        await this._observe(ref, label, durationMs || 1800);
        this._drop(ref, label);
        await this._wait(350);
    }

    async _runBasic() {
        this.status('Basic tests: connection and effect surfaces');
        await this._waitReady(20000);
        this.client.status();
        this.write('TEST connection_handshake PASS ready=true backend=' + this.client.backend + ' targets=' + this.client.targets);

        await this._singleEffect('solid_1x1', 1, 1, SOLID_FS, null, 1500);
        await this._singleEffect('solid_480x180', 480, 180, SOLID_FS, null, 2000);
        await this._singleEffect('solid_1920x720', 1920, 720, SOLID_FS, null, 2500);
        await this._singleImage('image_1x1', 1, 1, 1500);
        await this._singleImage('image_480x180', 480, 180, 2000);
        await this._singleImage('image_960x360', 960, 360, 2500);
    }


    async _singleImage(label, width, height, durationMs) {
        this._assertRunning();
        const ref = this.client.image({
            target: 'panel',
            klass: 'content',
            z: 90,
            x: 0,
            y: 0,
            w: width,
            h: height,
            iw: width,
            ih: height,
            visible: true
        });
        if (!ref) {
            this.failures++;
            this.write('IMAGE_CREATE_REFUSED label=' + label + ' size=' + width + 'x' + height);
            return;
        }
        this.refs.add(ref);
        const pixels = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const off = i * 4;
            pixels[off] = 32;
            pixels[off + 1] = 180;
            pixels[off + 2] = 72;
            pixels[off + 3] = 24;
        }
        const accepted = this.client.pixels(ref, null, pixels);
        this.write('IMAGE_CREATE label=' + label + ' ref=' + ref + ' size=' + width + 'x' + height +
            ' uploadAccepted=' + accepted + ' bytes=' + pixels.length);
        await this._observe(ref, label, durationMs || 1800);
        this._drop(ref, label);
        await this._wait(350);
    }

    async _runLayerScaling() {
        this.status('Layer scaling: 1 / 2 / 4 / 8 / 12 / 16 effects');
        const counts = [1, 2, 4, 8, 12, 16];
        for (let n = 0; n < counts.length; n++) {
            this._assertRunning();
            const count = counts[n];
            const created = [];
            for (let i = 0; i < count; i++) {
                const ref = this._createEffect('layer_count_' + count + '_' + i, 64, 64, SOLID_FS, null);
                if (ref) created.push(ref);
                await this._wait(80);
            }
            await this._wait(2500);
            created.forEach((ref) => this._drop(ref, 'layer_count_' + count));
            await this._wait(700);
            this.write('RESULT layer_count requested=' + count + ' created=' + created.length +
                ' refused=' + (count - created.length) + ' rendererReady=' + this.client.ready);
            this.testCount++;
        }
    }

    async _runShaderLoad() {
        this.status('Shader workload: increasing static GLSL loop counts');
        const sizes = [16, 32, 64, 128];
        for (let i = 0; i < sizes.length; i++) {
            const count = sizes[i];
            await this._singleEffect('glsl_loop_' + count, 960, 360, loopShader(count),
                { u_phase: [0.37] }, 5000);
            this.write('RESULT glsl_loop=' + count + ' rendererReady=' + this.client.ready);
        }
    }

    async _runE39Masks() {
        this.status('E39DASH shader isolation: masks 255 / 107 / 111 / 123 / 235');
        const masks = [255, 107, 111, 123, 235];
        for (let i = 0; i < masks.length; i++) {
            const mask = masks[i];
            const ref = this._createEffect('e39dash_mask_' + mask, 1920, 720, e39Shader(mask), null);
            if (!ref) continue;
            const values = {
                u_size: [1920, 720],
                u_speed: [0.35],
                u_rpm: [0.45],
                u_rpmActual: [0.45],
                u_fuel: [0.72],
                u_oil: [0.48],
                u_coolant: [0.52],
                u_sel: [0],
                u_svc: [5, 0],
                u_ind: [0, 0, 0, 0],
                u_flash: [0],
                u_hole: [0, 0, 0, 0],
                u_holeR: [0],
                u_night: [0],
                u_v2: [1]
            };
            Object.keys(values).forEach((name) => this.client.uniform(ref, name, values[name]));
            await this._observe(ref, 'e39dash_mask_' + mask, 6000);
            this._drop(ref, 'e39dash_mask_' + mask);
            await this._wait(1000);
            this.write('RESULT e39dash_mask=' + mask + ' rendererReady=' + this.client.ready);
        }
    }

    async _runLifecycle() {
        this.status('Lifecycle: 100 create/drop cycles');
        const start = Date.now();
        let created = 0;
        for (let i = 0; i < 100; i++) {
            this._assertRunning();
            const ref = this._createEffect('lifecycle_' + i, 1, 1, SOLID_FS, null);
            if (ref) {
                created++;
                this._drop(ref, 'lifecycle_' + i);
            }
            if (i % 10 === 0) this.status('Lifecycle ' + i + '/100; created=' + created);
            await this._wait(80);
        }
        await this._wait(2000);
        this.write('RESULT lifecycle requested=100 created=' + created +
            ' elapsed_ms=' + (Date.now() - start) + ' rendererReady=' + this.client.ready);
        this.testCount++;
    }

    async _runSoak(durationMs) {
        this.status('Sustained rendering: ' + Math.round(durationMs / 60000) + ' min');
        const refs = [];
        for (let i = 0; i < 4; i++) {
            const ref = this._createEffect('soak_' + i, 480, 180, loopShader(32), { u_phase: [0.11 * (i + 1)] });
            if (ref) refs.push(ref);
        }
        const start = Date.now();
        let nextReport = 0;
        while (Date.now() - start < durationMs) {
            this._assertRunning();
            if (!this.client.ready) {
                this.write('SOAK interruption rendererReady=false elapsed_ms=' + (Date.now() - start));
                break;
            }
            const elapsed = Date.now() - start;
            if (elapsed >= nextReport) {
                this.status('Soak ' + Math.floor(elapsed / 60000) + 'm ' +
                    Math.floor((elapsed % 60000) / 1000) + 's; active effects=' + refs.length);
                nextReport += 15000;
                this.client.status();
            }
            await this._wait(1000);
        }
        refs.forEach((ref) => this._drop(ref, 'soak'));
        await this._wait(1000);
        this.write('RESULT soak duration_ms=' + (Date.now() - start) +
            ' activeEffects=' + refs.length + ' rendererReady=' + this.client.ready);
        this.testCount++;
    }

    async runBasic() {
        if (this.running) return this.status('A benchmark is already running');
        this.running = true;
        this.stopRequested = false;
        try {
            await this._runBasic();
            this.status('Basic tests completed');
        } finally {
            this._cleanup();
            this.running = false;
        }
    }

    async runFull() {
        if (this.running) return this.status('A benchmark is already running');
        this.running = true;
        this.stopRequested = false;
        this.testCount = 0;
        this.failures = 0;
        this.passed = 0;
        this.inconclusive = 0;
        this.startedAt = Date.now();
        this.write('========== FULL BENCHMARK START ==========');
        try {
            await this._runBasic();
            await this._runLayerScaling();
            await this._runShaderLoad();
            await this._runE39Masks();
            await this._runLifecycle();
            await this._runSoak(5 * 60 * 1000);
            this.status('Full benchmark finished: tests=' + this.testCount + ' shown=' + this.passed + ' failures=' + this.failures + ' inconclusive=' + this.inconclusive);
            this.write('========== FULL BENCHMARK END elapsed_ms=' +
                (Date.now() - this.startedAt) + ' tests=' + this.testCount + ' shown=' + this.passed + ' failures=' + this.failures + ' inconclusive=' + this.inconclusive + ' ==========');
        } catch (error) {
            this.write('BENCHMARK_ABORT ' + (error && error.stack || error));
            throw error;
        } finally {
            this._cleanup();
            this.running = false;
        }
    }

    async runSoak(durationMs) {
        if (this.running) return this.status('A benchmark is already running');
        this.running = true;
        this.stopRequested = false;
        try {
            await this._waitReady(20000);
            await this._runSoak(durationMs);
            this.status('Soak completed');
        } catch (error) {
            this.write('SOAK_ABORT ' + (error && error.stack || error));
            throw error;
        } finally {
            this._cleanup();
            this.running = false;
        }
    }

    async reconnect() {
        if (this.running) return this.status('Stop the running benchmark before reconnecting');
        this.status('Closing client and reconnecting');
        this.client.close();
        await sleep(500);
        this.client.connect();
        const deadline = Date.now() + 20000;
        while (!this.client.ready && Date.now() < deadline) await sleep(200);
        this.write('RESULT manual_reconnect ready=' + this.client.ready);
        this.status(this.client.ready ? 'Reconnect successful' : 'Reconnect timeout');
    }

    stop() {
        if (!this.running) {
            this._cleanup();
            this.status('Stopped; all benchmark layers released');
            return;
        }
        this.stopRequested = true;
        this.write('STOP requested by user');
        this.status('Stopping benchmark...');
    }

    _cleanup() {
        Array.from(this.refs).forEach((ref) => this._drop(ref, 'cleanup'));
    }
}

module.exports = Benchmark;
