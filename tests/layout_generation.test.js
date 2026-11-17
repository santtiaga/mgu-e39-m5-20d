'use strict';

const assert = require('assert');
const generation = require('../shared/layout_generation');
const imageTypes = { text: true, icon: true };
const plan = [
    { kind: 'sheet', conn: 0, w: 100, h: 50 },
    { kind: 'layer', conn: 0, w: { type: 'text', w: 20, h: 10 } },
    { kind: 'layer', conn: 1, w: { type: 'shiftbar', w: 80, h: 20 } },
    { kind: 'layer', conn: 1, w: { type: 'icon', w: 8, h: 8 } },
];
const candidate = generation.measurePlan(plan, imageTypes);
assert.deepStrictEqual(candidate.counts, [2, 2]);
assert.strictEqual(candidate.layers, 4);
assert.strictEqual(candidate.imageBytes, (100 * 50 + 20 * 10 + 8 * 8) * 8);
const active = generation.measureRefs([
    { ci: 0, imageBytes: 4000 }, { ci: 0, imageBytes: 0 }, { ci: 1, imageBytes: 8000 },
]);
assert.deepStrictEqual(active.counts, [2, 1]);
assert.strictEqual(active.imageBytes, 12000);
let result = generation.assessOverlap(active, candidate, { rendererInventoryComplete: false, perClient: 8, totalLayers: 32, pixelBytes: 16 * 1024 * 1024 });
assert.strictEqual(result.allowed, false, 'unknown global renderer inventory must fail closed');
assert(/layer inventory is unavailable/.test(result.reason));

result = generation.assessOverlap(active, candidate, {
    layerInventoryComplete: true, rendererInventoryComplete: false,
    externalLayers: 27, perClient: 8, totalLayers: 32, pixelBytes: 16 * 1024 * 1024
});
assert.strictEqual(result.allowed, false, 'known global layer count must reject an over-budget overlap');
assert(/34\/32/.test(result.reason));

result = generation.assessOverlap(active, candidate, {
    layerInventoryComplete: true, rendererInventoryComplete: false,
    externalLayers: 2, perClient: 8, totalLayers: 32, pixelBytes: 16 * 1024 * 1024
});
assert.strictEqual(result.allowed, false, 'known layer count alone must not imply known pixel memory');
assert(/pixel-memory inventory is incomplete/.test(result.reason));
const knownLimits = { rendererInventoryComplete: true, perClient: 8, totalLayers: 32, pixelBytes: 16 * 1024 * 1024, sharedAssetBytes: 1024, externalLayers: 4, externalPixelBytes: 2048 };
result = generation.assessOverlap(active, candidate, knownLimits);
assert.strictEqual(result.allowed, true, 'known headroom permits overlap');
assert.strictEqual(result.layers, 11);
assert.strictEqual(result.pixelBytes, 57184);
result = generation.assessOverlap(active, candidate, Object.assign({}, knownLimits, { externalLayers: 30 }));
assert.strictEqual(result.allowed, false, 'service-wide layer ceiling must be enforced');
assert(/total layers/.test(result.reason));
result = generation.assessOverlap(active, candidate, Object.assign({}, knownLimits, { externalPixelBytes: 16 * 1024 * 1024 }));
assert.strictEqual(result.allowed, false, 'shared pixel-memory ceiling must be enforced');
assert(/pixel bytes/.test(result.reason));
const tooManyOnOneConnection = generation.measurePlan([
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
    { kind: 'layer', conn: 0, w: { type: 'shiftbar', w: 1, h: 1 } },
]);
result = generation.assessOverlap(active, tooManyOnOneConnection, knownLimits);
assert.strictEqual(result.allowed, false, 'per-connection ceiling must be enforced');
assert(/connection 1/.test(result.reason));
console.log('layout_generation: all tests passed');
