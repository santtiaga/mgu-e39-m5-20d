'use strict';

const assert = require('assert');
const HudApp = require('../shared/hud');
const changes = HudApp._changes;

function pixel(buf, width, x, y, rgba) {
    const off = (y * width + x) * 4;
    for (let i = 0; i < 4; i++) buf[off + i] = rgba[i];
}

(function unchangedFrameProducesNoUpload() {
    const before = Buffer.alloc(12 * 8 * 4, 0);
    const after = Buffer.from(before);
    assert.strictEqual(changes(before, after, 12, 8), null);
})();

(function distantChangesStayAsSeparateRectangles() {
    const before = Buffer.alloc(20 * 10 * 4, 0);
    const after = Buffer.from(before);
    pixel(after, 20, 1, 2, [1, 2, 3, 255]);
    pixel(after, 20, 17, 7, [4, 5, 6, 255]);
    const result = changes(before, after, 20, 10);
    assert.deepStrictEqual(result.rects, [
        { x: 1, y: 2, w: 1, h: 1 },
        { x: 17, y: 7, w: 1, h: 1 }
    ]);
    assert.deepStrictEqual(Array.from(result.px), [1, 2, 3, 255, 4, 5, 6, 255]);
})();

(function identicalRunsOnAdjacentRowsAreMerged() {
    const before = Buffer.alloc(12 * 8 * 4, 0);
    const after = Buffer.from(before);
    pixel(after, 12, 4, 2, [9, 8, 7, 255]);
    pixel(after, 12, 5, 2, [9, 8, 7, 255]);
    pixel(after, 12, 4, 3, [9, 8, 7, 255]);
    pixel(after, 12, 5, 3, [9, 8, 7, 255]);
    const result = changes(before, after, 12, 8);
    assert.deepStrictEqual(result.rects, [{ x: 4, y: 2, w: 2, h: 2 }]);
    assert.strictEqual(result.px.length, 16);
})();

(function fragmentedChangesFallBackToOneBoundedRectangle() {
    const before = Buffer.alloc(40 * 20 * 4, 0);
    const after = Buffer.from(before);
    for (let i = 0; i < 17; i++) pixel(after, 40, i * 2, 1 + (i % 3) * 5, [i + 1, 0, 0, 255]);
    const result = changes(before, after, 40, 20);
    assert.strictEqual(result.rects.length, 1, 'fragmented updates must respect the 16-rect client limit');
    assert.deepStrictEqual(result.rects[0], { x: 0, y: 1, w: 33, h: 11 });
    assert.strictEqual(result.px.length, 33 * 11 * 4);
})();

console.log('dirty_rects: unchanged, sparse, merged and fragmented updates passed');
