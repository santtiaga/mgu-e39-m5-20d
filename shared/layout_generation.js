'use strict';

/* Resource preflight for a future make-before-break HUD lifecycle. */

function measureRefs(refs) {
    const counts = [];
    let imageBytes = 0;
    (refs || []).forEach((ref) => {
        const ci = Math.max(0, Math.floor(ref.ci || 0));
        counts[ci] = (counts[ci] || 0) + 1;
        imageBytes += Math.max(0, ref.imageBytes || 0);
    });
    return { counts: counts, layers: counts.reduce((sum, n) => sum + n, 0), imageBytes: imageBytes };
}

function measurePlan(plan, imageTypes) {
    const counts = [];
    let imageBytes = 0;
    (plan || []).forEach((entry) => {
        const ci = Math.max(0, Math.floor(entry.conn || 0));
        counts[ci] = (counts[ci] || 0) + 1;
        if (entry.kind === 'sheet') imageBytes += entry.w * entry.h * 8;
        else if (entry.w && imageTypes && imageTypes[entry.w.type]) imageBytes += entry.w.w * entry.w.h * 8;
    });
    return { counts: counts, layers: counts.reduce((sum, n) => sum + n, 0), imageBytes: imageBytes };
}

function assessOverlap(active, candidate, limits) {
    active = active || measureRefs([]);
    candidate = candidate || measurePlan([]);
    limits = limits || {};
    if (limits.rendererInventoryComplete !== true) {
        return { allowed: false, reason: 'renderer layer/pixel inventory is unavailable' };
    }
    const perClient = Math.max(1, limits.perClient || 8);
    const totalLimit = Math.max(1, limits.totalLayers || 32);
    const pixelLimit = Math.max(1, limits.pixelBytes || 16 * 1024 * 1024);
    const length = Math.max(active.counts.length, candidate.counts.length);
    for (let ci = 0; ci < length; ci++) {
        const combined = (active.counts[ci] || 0) + (candidate.counts[ci] || 0);
        if (combined > perClient) {
            return { allowed: false, reason: 'connection ' + (ci + 1) + ' would need ' + combined + '/' + perClient + ' layers' };
        }
    }
    const layers = active.layers + candidate.layers + Math.max(0, limits.externalLayers || 0);
    if (layers > totalLimit) return { allowed: false, reason: 'renderer would need ' + layers + '/' + totalLimit + ' total layers' };
    const pixels = active.imageBytes + candidate.imageBytes + Math.max(0, limits.sharedAssetBytes || 0) + Math.max(0, limits.externalPixelBytes || 0);
    if (pixels > pixelLimit) return { allowed: false, reason: 'renderer would need ' + pixels + '/' + pixelLimit + ' pixel bytes' };
    return { allowed: true, reason: 'known renderer budgets have sufficient headroom', layers: layers, pixelBytes: pixels };
}

module.exports = { measureRefs: measureRefs, measurePlan: measurePlan, assessOverlap: assessOverlap };
