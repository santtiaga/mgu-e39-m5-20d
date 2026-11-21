'use strict';

/**
 * Static E39 M5 panel + dial faces. Rasterized once when the layout is built;
 * the renderer receives one immutable RGBA image layer. Live needles remain
 * a separate GLSL effect layer.
 */
function makeCanvas(width, height) {
    // In the installed app the kit exposes ./kit/canvas; source-tree tests use kit/runtime/canvas.
    let Canvas;
    try { Canvas = require('./kit/canvas').Canvas; }
    catch (e) { Canvas = require('./kit/runtime/canvas').Canvas; }
    return new Canvas(width, height);
}

function noise(x, y) {
    let n = (Math.imul(x + 1, 0x1f123bb5) ^ Math.imul(y + 7, 0x5f356495)) | 0;
    n ^= n >>> 16; n = Math.imul(n, 0x7feb352d);
    n ^= n >>> 15; n = Math.imul(n, 0x846ca68b);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
}

function render(width, height, night) {
    const c = makeCanvas(width, height);
    const n = !!night;
    c.gradientRect(0, 0, width, height, n
        ? [[0, '#171719'], [0.48, '#111214'], [1, '#090a0b']]
        : [[0, '#262a30'], [0.52, '#1c2026'], [1, '#111419']]);

    // Fine fixed grain: this loop runs once per layout creation, never per frame.
    const d = c.d;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const g = (noise(x, y) - 0.5) * (n ? 5 : 8);
            d[i] = Math.max(0, Math.min(255, d[i] + g));
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
            d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g));
            d[i + 3] = 255;
        }
    }

    // Subtle inner panel bevel.
    c.strokeRoundRect(1, 1, width - 2, height - 2, 3, 2, n ? '#080809' : '#090b0e');
    c.line(0, 42, width, 42, 1, n ? '#292321' : '#454b54');
    c.line(0, height - 42, width, height - 42, 1, n ? '#08090a' : '#0b0e12');

    const dials = [
        [245, 398, 118],
        [1735, 398, 118],
        [625, 295, 214],
        [1155, 295, 214]
    ];
    dials.forEach((a) => {
        const x = a[0], y = a[1], r = a[2];
        // Machined outer ring: dark shoulder, satin metal, bright upper edge, inner shadow.
        c.arc(x, y, r - 2, r + 8, 0, 360, '#070809');
        c.arc(x, y, r - 1, r + 5, 0, 360, n ? '#55504b' : '#aeb3b9');
        c.arc(x, y, r + 1, r + 4, 0, 360, n ? '#777067' : '#d7dbe0');
        c.arc(x, y, r - 3, r - 1, 0, 360, '#25282c');
        c.arc(x, y, r - 7, r - 4, 0, 360, '#08090a');
        c.circle(x, y, r - 8, n ? '#151311' : '#252a31');
        c.arc(x, y, r - 12, r - 10, 0, 360, n ? '#30251d' : '#414850');
        c.arc(x, y, r - 17, r - 16, 0, 360, n ? '#090909' : '#111419');

        // Very restrained directional sheen on the metal ring.
        c.arc(x, y, r + 2, r + 4, 300, 415, n ? '#8d6d50' : '#f0f1f2');
        c.arc(x, y, r - 2, r - 1, 120, 235, n ? '#090909' : '#525963');
    });

    // Add finer, deterministic face grain without changing the machined rings.
    dials.forEach((a) => {
        const cx = a[0], cy = a[1], r = a[2] - 18;
        const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(width, Math.ceil(cx + r));
        const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height, Math.ceil(cy + r));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            if (dx * dx + dy * dy > r * r) continue;
            const i = (y * width + x) * 4;
            const g = (noise(x * 3 + 17, y * 3 + 31) - 0.5) * (n ? 5 : 8);
            d[i] = Math.max(0, Math.min(255, d[i] + g));
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
            d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g));
        }
    });
    return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
}

module.exports = { render };
