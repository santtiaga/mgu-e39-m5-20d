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

The existing `ClusterRender` client already owns the runtime replay contract; Apex Dash does not rebuild the active layout on every reconnect. The client retains image and asset pixel buffers independently of the HUD's temporary sheet buffers. After a socket reconnect it replays asset definitions first, then layer definitions and retained layer state (settings, uniforms, mesh parts/geometry/transforms, scene edits, binds and animations). Image and asset layers with pixel data are marked for a full upload again. The client does not emit the app's `ready` event on `hello` alone: it first pumps every retained full pixel buffer and waits through socket `drain` events until no image/asset upload remains queued. Drawable layer definitions are sent with `visible: 0` during reconnect replay. For ordinary clients, after all retained pixel buffers have been written, the client sends each layer's original visibility (including the protocol default of visible) and waits for any resulting socket backpressure to drain before emitting `ready`. Apex Dash sets `deferReplayVisibility` and deliberately takes the stricter path: after pixel replay it emits `ready` while drawable layers remain hidden, then restores their requested visibility only after its DCSM2 watchdog confirms provider availability. A socket reconnect first returns DCSM2 health to unknown, so replayed panel layers remain hidden until a fresh status response confirms availability. This prevents effect layers and other immediately drawable layers from flashing with incomplete pixels or before the app-specific health gate passes. The current Apex Dash HUD uses image/effect layers, not scene-file layers; the protocol's separate `scene` operation has no visibility field and is outside this hidden-layer barrier. A forced-backpressure regression test pauses the fake renderer's receive side and verifies that `ready` remains withheld until the uploads drain. This preserves packed E39 image sheets and R8 glyph atlases without creating duplicate layers.

A reconnect regression test uses a local fake renderer, forces the first socket closed, then checks the second connection for replayed definitions/state and byte-identical full image/asset uploads: `tests/cluster_render_reconnect.test.js`. This test exercises the client protocol replay, not the BMW renderer or the instrument cluster itself. Video frames are transient and are not replayed from a retained frame buffer; Apex Dash's current E39 layout is based on image/effect layers and live HUD ticks rather than a persistent video frame.

## Atomic HUD cutover assessment

The renderer protocol has no group transaction, frame-boundary commit, or atomic layer-set visibility operation. `set` and `drop` address one ref at a time; sending several messages on one TCP stream preserves their order, but does not promise that the renderer presents them as one indivisible frame. Reconnect replay therefore restores each layer's original visibility only after retained image/asset uploads, but the final per-layer visibility changes are still sequential. This avoids drawing incomplete retained pixels; it is not a guaranteed atomic visual swap.

Two protocol features were assessed and deliberately not used as a general-purpose transaction:

- `exclusive` hides every lower layer while that layer is drawn, but it is a layer-stack occlusion feature, not an app-scoped transaction or a commit primitive. A global curtain could suppress other clients' content, and correct stack placement relative to every old and new layer is not guaranteed by Apex Dash's current layout definitions. Do not use it as a reconnect barrier without renderer-level evidence that its scope and ordering are safe.
- A `scene` file can replace a target's scene, but the renderer accepts only trusted root-owned files installed under `/var/opt/`, and a target has at most one scene file. This is a pre-installed RAMSES scene mechanism, not a dynamic transaction for the current JS-generated E39 image/effect layout.

The current `_rebuildInner()` also requests drops for the previous layout before starting a new staged build. Since `drop` has no acknowledgement, a layout/settings change can have a blank or partial interval while the replacement is built. Changing that to keep-old-until-new-ready would require a separate double-buffered layout lifecycle, temporary duplicate layer/memory budget, explicit ownership of old and new refs, and a defined cutover policy. It still would not be frame-atomic with the present protocol. This refactor is intentionally not attempted as part of the reconnect safety work.

Safe guarantees currently made:
- on reconnect, all drawable layers are recreated hidden;
- retained image/asset pixels and socket backpressure complete before original visibility is restored;
- the client waits for renderer `hello` before completing the replay handshake;
- no claim is made that the final visibility restore, a layout rebuild, or a set of drops is atomic at the display-frame level.

A true atomic cutover requires renderer support for an app-scoped layer group/scene transaction (stage a complete generation, then commit it at a render-frame boundary), or equivalent documented semantics. Until such support exists and is verified against the installed MGU renderer, keep the current conservative per-layer behavior.

## Make-before-break resource gate

`shared/layout_generation.js` adds a tested resource preflight for retaining the active generation while a candidate is staged. It accounts for active and planned layer counts per connection, image memory (8 bytes per image pixel), retained glyph-atlas bytes, the conservative 8-layer-per-connection / 32-layer Apex Dash operating budgets, and the 16 MiB shared pixel-memory ceiling.

The status operation does expose a renderer-wide snapshot: it lists every configured target and enumerates connected clients' layers and assets. `shared/renderer_inventory.js` parses that response, counts global layers/assets, and computes the known asset allocation from format and dimensions. `shared/hud.js` uses a fresh snapshot only as a global layer-count lower bound when evaluating the overlap.

The snapshot is not a complete pixel-memory inventory. Layer rows do not report image dimensions, current mesh geometry bytes, or video buffer allocation; pre-installed scene resources are not enumerated as ordinary assets. The preflight therefore still fails closed after the layer-count check, and runtime continues with the existing safe rebuild path. The status parser must not be mistaken for proof that double buffering is safe.

The app's 8-layer-per-connection and 32-layer aggregate limits are conservative Apex Dash operating budgets based on observed car behaviour, not the limits stated by the currently inspected upstream protocol. That protocol revision documents 64 layers per client and 96 across clients, with 16 MiB shared pixel memory and 32 assets across clients. The exact cluster-render build installed on the MGU has not been identified or verified against that upstream revision.

The gate is groundwork, not an enabled double-buffer implementation; it does not duplicate live layouts, change renderer ownership, or claim a frame-atomic swap. `createRegistry()` in `shared/layout_generation.js` now defines and tests the generation ownership contract: a candidate moves through building → ready → active, the previous active generation becomes retiring, layer refs are deduplicated by connection/ref, and release is idempotent. This registry is deliberately not wired into the HUD yet: the live HUD still has shared `widgets` / `sheets` state and the current renderer has no acknowledged per-ref drop. Wiring the registry before splitting those mutable collections and update callbacks would create the appearance of generation isolation without actually providing it. Enabling make-before-break still requires complete, trustworthy pixel-allocation accounting, a generation-owned widget/update lifecycle, and a defined non-atomic cutover policy. Tests cover status parsing, partial-inventory rejection, resource accounting, budget ceilings, and the generation lifecycle contract.

## Deliberate safety behavior

A trip is latched for the lifetime of the app process. Apex Dash does not automatically rebuild the overlay after a safety stop; restart the app after collecting logs and resolving the underlying fault. This avoids an automatic render/restart loop on the instrument cluster.

The safety controller does not alter the E39 graphics, shaders, diesel warm-up thresholds, shift logic, or vehicle telemetry.

## Staged build and remaining limits

The HUD builder now creates one planned layer at a time with `visible: false`. It advances only after a renderer `layer` event confirms `hidden`, then reveals that layer and waits for `shown` before creating the next stage. Image sheets are populated before reveal; layers sampling glyph assets remain stalled until the renderer can draw them. A 45-second per-stage timeout aborts the build, drops the partial layout, and does not automatically retry. The timeout is armed only while the stage's renderer connection is ready; on disconnect, the remaining budget is preserved and resumed after the client's hello/replay handshake. This prevents renderer restarts and initial connection delays from being misclassified as a hung layer. This is a conservative staged transaction, not a full atomic swap: already confirmed stages can be visible while later stages are being built.

Release verification remains limited by the documented protocol: `drop` has no acknowledgement event. A subsequent `status` snapshot can show the global layer/asset inventory after the target linger, but it does not acknowledge a particular drop request or correlate a renderer layer id with an app-local ref. The code therefore sends independent drops, records local release requests, and logs status snapshots, but does not claim renderer-confirmed removal. A closed renderer connection is the protocol's definitive cleanup boundary; the shared HUD connection is deliberately kept open.

## Local checks

```sh
node tests/car.test.js
node tests/cluster_render_close.test.js
node tests/cluster_render_late_connect.test.js
node tests/dcsm2_watchdog.test.js
node tests/diag_lifecycle.test.js
node tests/safety_controller.test.js
node tests/staged_build.test.js
node tests/cluster_render_reconnect.test.js
node --check shared/safety_controller.js
node --check tests/safety_controller.test.js
node --check tests/staged_build.test.js
python kit/tools/build.py apex_dash
```

A successful local build does not prove on-car renderer behavior. The final validation still requires checking the MGU logs and confirming that the panel returns to BMW's native display after a forced safety stop.
