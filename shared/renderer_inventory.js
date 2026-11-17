'use strict';

/* Parse the renderer's human-readable status snapshot. It is useful for
 * global layer/asset counts, but deliberately does not infer image, video,
 * mesh or pre-installed scene allocation sizes that the protocol omits. */

function assetBytes(format, width, height) {
    const pixels = width * height;
    if (format === 'rgba8') return pixels * 8;
    if (format === 'r8') return pixels * 2;
    if (format === 'etc2rgba') return pixels;
    if (format === 'etc2rgb') return pixels / 2;
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
        unmeasuredPixelResources: 0,
        pixelMemoryComplete: false
    };
    if (typeof statusText !== 'string' || !/^upload:\\s/m.test(statusText)) return result;

    const lines = statusText.split(/\\r?\\n/);
    let targets = 0;
    let malformedInventoryLine = false;
    lines.forEach((line) => {
        if (/^target\\s+/.test(line)) targets++;
        if (/^layer\\s+/.test(line)) {
            const match = /^layer\\s+\\d+\\s+([a-z]+)\\s+of\\s+.+?\\s+on\\s+[^,]+,/.exec(line);
            if (!match) {
                malformedInventoryLine = true;
                return;
            }
            const kind = match[1];
            result.layerCount++;
            result.layerKinds[kind] = (result.layerKinds[kind] || 0) + 1;
            if (kind === 'image' || kind === 'video' || kind === 'mesh') result.unmeasuredPixelResources++;
        } else if (/^scene\\s+/.test(line)) {
            result.unmeasuredPixelResources++;
        } else if (/^asset\\s+/.test(line)) {
            const match = /^asset\\s+\\d+\\s+([a-z0-9]+)\\s+(\\d+)x(\\d+)\\s+of\\s+.+?\\s+on\\s+[^:]+:/.exec(line);
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

    result.complete = targets > 0 && !malformedInventoryLine;
    result.pixelMemoryComplete = result.complete &&
        result.unmeasuredPixelResources === 0 && result.unknownAssetFormats === 0;
    return result;
}

module.exports = { parseStatus: parseStatus, assetBytes: assetBytes };
