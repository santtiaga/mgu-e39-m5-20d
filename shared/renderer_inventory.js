'use strict';

/* Parse the renderer's human-readable status snapshot. It is useful for
 * global layer/asset counts, but deliberately does not infer image or mesh
 * allocation sizes that the protocol does not report. */

function assetBytes(format, width, height) {
    const pixels = width * height;
    if (format === 'rgba8') return pixels * 8;       // uncompressed asset: 4 B/pixel, charged twice
    if (format === 'r8') return pixels * 2;           // uncompressed asset: 1 B/pixel, charged twice
    if (format === 'etc2rgba') return pixels;         // compressed asset: 1 B/pixel, charged once
    if (format === 'etc2rgb') return pixels / 2;      // compressed asset: 0.5 B/pixel, charged once
    return null;
}

function parseStatus(statusText) {
    const result = {
        complete: false,
        layerCount: 0,
        assetCount: 0,
        layerKinds: {},
        assetBytes: 0,
        unknownAssetFormats: 0,
        unmeasuredPixelLayers: 0,
        pixelMemoryComplete: false
    };
    if (typeof statusText !== 'string' || !/^upload:\s/m.test(statusText)) return result;

    const lines = statusText.split(/\r?\n/);
    let targets = 0;
    let malformedInventoryLine = false;
    lines.forEach((line) => {
        if (/^target\s+/.test(line)) targets++;
        if (/^layer\s+/.test(line)) {
            const match = /^layer\s+\d+\s+([a-z]+)\s+of\s+.+?\s+on\s+[^,]+,/.exec(line);
            if (!match) {
                malformedInventoryLine = true;
                return;
            }
            const kind = match[1];
            result.layerCount++;
            result.layerKinds[kind] = (result.layerKinds[kind] || 0) + 1;
            if (kind === 'image' || kind === 'video' || kind === 'mesh') result.unmeasuredPixelLayers++;
        } else if (/^asset\s+/.test(line)) {
            const match = /^asset\s+\d+\s+([a-z0-9]+)\s+(\d+)x(\d+)\s+of\s+.+?\s+on\s+[^:]+:/.exec(line);
            if (!match) {
                malformedInventoryLine = true;
                return;
            }
            result.assetCount++;
            const bytes = assetBytes(match[1], Number(match[2]), Number(match[3]));
            if (bytes === null) result.unknownAssetFormats++;
            else result.assetBytes += bytes;
        }
    });

    /* A real status response always starts with upload state and lists the
     * renderer's configured targets. Missing target rows or malformed
     * inventory rows are treated as an incomplete snapshot. */
    result.complete = targets > 0 && !malformedInventoryLine;
    result.pixelMemoryComplete = result.complete &&
        result.unmeasuredPixelLayers === 0 && result.unknownAssetFormats === 0;
    return result;
}

module.exports = { parseStatus: parseStatus, assetBytes: assetBytes };
