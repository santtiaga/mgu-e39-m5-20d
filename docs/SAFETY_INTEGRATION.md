# Apex Dash safety integration

This branch introduces the first safety-integration slice, based on the failure-handling ideas in pinguinooo/idrive7-apps M Track.

## Implemented

- `shared/safety_controller.js` provides one rolling error budget for synchronous callbacks and rejected promises.
- `shared/staged_build.js` isolates renderer-confirmed stage transitions and deterministic timeout pause/resume accounting; both are covered by a standalone Node 8 unit test.
- Active stage deadlines pause when that stage's renderer connection disconnects and resume with only the remaining budget after reconnect. Other connections do not pause the active stage.
- Five errors in a ten-second rolling window latch a safety stop.
- The stop handler drops all currently tracked Apex Dash layers, clears the active layout state, requests fresh renderer status from ready connections, and exposes a persistent status-line warning.
- Renderer event handlers are guarded. Renderer layer errors and refused operations count toward the same error budget; diagnostic events are logged without double-counting the corresponding renderer event.
- Layer drops are attempted independently, so one failed drop command does not prevent attempts for the remaining layers.
- `tests/safety_controller.test.js` covers synchronous errors, rolling-window expiry, one-shot trip behavior, latched suppression, reset, and rejected promises.

## Runtime renderer reconnect

The existing `ClusterRender` client already owns the runtime replay contract; Apex Dash does not rebuild the active layout on every reconnect. The client retains image and asset pixel buffers independently of the HUD's temporary sheet buffers. After a socket reconnect it replays asset definitions first, then layer definitions and retained layer state (settings, uniforms, mesh parts/geometry/transforms, scene edits, binds and animations). Image and asset layers with pixel data are marked for a full upload again. The client does not emit the app's `ready` event on `hello` alone: it first pumps every retained full pixel buffer and waits through socket `drain` events until no image/asset upload remains queued. Drawable layer definitions are sent with `visible: 0` during the reconnect replay; after all retained pixel buffers have been written, the client sends each layer's original visibility (including the protocol default of visible) and waits for any resulting socket backpressure to drain before emitting `ready`. This prevents effect layers and other immediately drawable layers from flashing with incomplete or stale dependencies. The current Apex Dash HUD uses image/effect layers, not scene-file layers; the protocol's separate `scene` operation has no visibility field and is outside this hidden-layer barrier. A forced-backpressure regression test pauses the fake renderer's receive side and verifies that `ready` remains withheld until the uploads drain. This preserves packed E39 image sheets and R8 glyph atlases without creating duplicate layers.

A reconnect regression test uses a local fake renderer, forces the first socket closed, then checks the second connection for replayed definitions/state and byte-identical full image/asset uploads: `tests/cluster_render_reconnect.test.js`. This test exercises the client protocol replay, not the BMW renderer or the instrument cluster itself. Video frames are transient and are not replayed from a retained frame buffer; Apex Dash's current E39 layout is based on image/effect layers and live HUD ticks rather than a persistent video frame.

## Deliberate safety behavior

A trip is latched for the lifetime of the app process. Apex Dash does not automatically rebuild the overlay after a safety stop; restart the app after collecting logs and resolving the underlying fault. This avoids an automatic render/restart loop on the instrument cluster.

The safety controller does not alter the E39 graphics, shaders, diesel warm-up thresholds, shift logic, or vehicle telemetry.

## Staged build and remaining limits

The HUD builder now creates one planned layer at a time with `visible: false`. It advances only after a renderer `layer` event confirms `hidden`, then reveals that layer and waits for `shown` before creating the next stage. Image sheets are populated before reveal; layers sampling glyph assets remain stalled until the renderer can draw them. A 45-second per-stage timeout aborts the build, drops the partial layout, and does not automatically retry. The timeout is armed only while the stage's renderer connection is ready; on disconnect, the remaining budget is preserved and resumed after the client's hello/replay handshake. This prevents renderer restarts and initial connection delays from being misclassified as a hung layer. This is a conservative staged transaction, not a full atomic swap: already confirmed stages can be visible while later stages are being built.

Release verification remains limited by the documented protocol: `drop` has no acknowledgement event, and `status` reports target slot state rather than a per-app layer inventory. The code therefore sends independent drops, records local release requests, and can request status after the target linger, but it does not claim renderer-confirmed removal. A closed renderer connection is the protocol's definitive cleanup boundary; the shared HUD connection is deliberately kept open.

## Local checks

```sh
node tests/safety_controller.test.js
node tests/staged_build.test.js
node tests/cluster_render_reconnect.test.js
node --check shared/safety_controller.js
node --check tests/safety_controller.test.js
node --check tests/staged_build.test.js
python kit/tools/build.py apex_dash
```

A successful local build does not prove on-car renderer behavior. The final validation still requires checking the MGU logs and confirming that the panel returns to BMW's native display after a forced safety stop.
