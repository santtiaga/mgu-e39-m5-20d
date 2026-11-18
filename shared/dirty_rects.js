'use strict';

/**
 * Changed RGBA pixels as up to 16 packed rectangles, vertically coalesced when adjacent rows
 * have the same run. A single bounding rectangle is the safe fallback when fragmentation is high.
 * null means identical. The renderer client retains the complete image and applies these patches.
 */
function changes(was, now, w, h) {
    const rowBytes = w * 4;
    const rects = [];
    let active = new Map();
    let left = w, right = -1, top = h, bottom = -1;

    for (let y = 0; y < h; y++) {
        const row = y * rowBytes;
        const next = new Map();
        let x = 0;
        while (x < w) {
            const o = row + x * 4;
            if (now[o] === was[o] && now[o + 1] === was[o + 1] &&
                now[o + 2] === was[o + 2] && now[o + 3] === was[o + 3]) {
                x++;
                continue;
            }
            const start = x++;
            while (x < w) {
                const p = row + x * 4;
                if (now[p] === was[p] && now[p + 1] === was[p + 1] &&
                    now[p + 2] === was[p + 2] && now[p + 3] === was[p + 3]) break;
                x++;
            }
            const width = x - start;
            const key = start + ':' + width;
            const prior = active.get(key);
            if (prior) {
                prior.h++;
                next.set(key, prior);
            } else {
                next.set(key, { x: start, y: y, w: width, h: 1 });
            }
            if (start < left) left = start;
            if (x - 1 > right) right = x - 1;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
        active.forEach((r, key) => { if (!next.has(key)) rects.push(r); });
        active = next;
    }
    active.forEach((r) => rects.push(r));
    if (right < left) return null;

    // The cluster-render client accepts at most 16 dirty rectangles.
    if (rects.length > 16) rects.splice(0, rects.length, { x: left, y: top, w: right - left + 1, h: bottom - top + 1 });

    let bytes = 0;
    rects.forEach((r) => { bytes += r.w * r.h * 4; });
    const px = Buffer.allocUnsafe(bytes);
    let offset = 0;
    rects.forEach((r) => {
        for (let y = 0; y < r.h; y++) {
            const start = (r.y + y) * rowBytes + r.x * 4;
            const end = start + r.w * 4;
            now.copy(px, offset, start, end);
            offset += r.w * 4;
        }
    });
    return { rects, px };
}

module.exports = changes;
