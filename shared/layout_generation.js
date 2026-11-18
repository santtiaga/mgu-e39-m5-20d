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

    /* A complete status snapshot includes the active layout already. Add
     * only candidate layers to its global count (externalLayers excludes
     * this app's active refs). The 32-layer limit supplied by HUD is its
     * conservative operating budget, not a protocol-wide renderer limit. */
    const layerInventoryComplete = limits.layerInventoryComplete === true ||
        limits.rendererInventoryComplete === true;
    let projectedLayers = active.layers + candidate.layers;
    if (layerInventoryComplete) {
        projectedLayers += Math.max(0, limits.externalLayers || 0);
        if (projectedLayers > totalLimit) {
            return { allowed: false, reason: 'renderer would need ' + projectedLayers + '/' + totalLimit + ' layers (Apex Dash safety budget)' };
        }
    } else if (limits.rendererInventoryComplete !== true) {
        return { allowed: false, reason: 'renderer layer inventory is unavailable' };
    }

    if (limits.rendererInventoryComplete !== true) {
        return { allowed: false, reason: 'renderer pixel-memory inventory is incomplete' };
    }
    const pixels = active.imageBytes + candidate.imageBytes + Math.max(0, limits.sharedAssetBytes || 0) +
        Math.max(0, limits.externalPixelBytes || 0);
    if (pixels > pixelLimit) return { allowed: false, reason: 'renderer would need ' + pixels + '/' + pixelLimit + ' pixel bytes' };
    return { allowed: true, reason: 'known renderer budgets have sufficient headroom', layers: projectedLayers,
        pixelBytes: pixels };
}

module.exports = { measureRefs: measureRefs, measurePlan: measurePlan, assessOverlap: assessOverlap, createRegistry: createRegistry };

/* Generation ownership model. This is intentionally not wired to HUD yet:
 * the current renderer has no atomic commit or acknowledged drop operation. */
function createRegistry() {
    let nextId = 1;
    const generations = new Map();
    let activeId = null;

    function get(generation) {
        const id = typeof generation === 'object' && generation ? generation.id : generation;
        return generations.get(id) || null;
    }

    function begin(meta) {
        const generation = {
            id: nextId++,
            state: 'building',
            meta: meta || {},
            refs: new Map(),
            createdAt: Date.now()
        };
        generations.set(generation.id, generation);
        return generation;
    }

    function track(generation, ci, ref) {
        const g = get(generation);
        if (!g || g.state !== 'building' || !ref) return false;
        const key = String(Math.max(0, Math.floor(ci || 0))) + ':' + String(ref);
        g.refs.set(key, { ci: Math.max(0, Math.floor(ci || 0)), ref: ref });
        return true;
    }

    function ready(generation) {
        const g = get(generation);
        if (!g || g.state !== 'building') return false;
        g.state = 'ready';
        return true;
    }

    function activate(generation) {
        const g = get(generation);
        if (!g || g.state !== 'ready') return { activated: false, previous: null };
        const previous = activeId === null ? null : get(activeId);
        if (previous && previous.state === 'active') previous.state = 'retiring';
        g.state = 'active';
        activeId = g.id;
        return { activated: true, previous: previous };
    }

    function release(generation) {
        const g = get(generation);
        if (!g || g.state === 'released') return [];
        if (g.state === 'active') activeId = null;
        g.state = 'released';
        const refs = Array.from(g.refs.values());
        g.refs.clear();
        return refs;
    }

    function current() { return activeId === null ? null : get(activeId); }

    return {
        begin: begin,
        track: track,
        ready: ready,
        activate: activate,
        release: release,
        current: current,
        get: get
    };
}

