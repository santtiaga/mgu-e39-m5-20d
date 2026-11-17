# Apex Dash safety integration

This branch introduces the first safety-integration slice, based on the failure-handling ideas in pinguinooo/idrive7-apps M Track.

## Implemented

- `shared/safety_controller.js` provides one rolling error budget for synchronous callbacks and rejected promises.
- Five errors in a ten-second rolling window latch a safety stop.
- The stop handler drops all currently tracked Apex Dash layers, clears the active layout state, requests fresh renderer status from ready connections, and exposes a persistent status-line warning.
- Renderer event handlers are guarded. Renderer layer errors, refused operations, and diagnostic error events count toward the same error budget.
- Layer drops are attempted independently, so one failed drop command does not prevent attempts for the remaining layers.
- `tests/safety_controller.test.js` covers synchronous errors, rolling-window expiry, one-shot trip behavior, latched suppression, reset, and rejected promises.

## Deliberate safety behavior

A trip is latched for the lifetime of the app process. Apex Dash does not automatically rebuild the overlay after a safety stop; restart the app after collecting logs and resolving the underlying fault. This avoids an automatic render/restart loop on the instrument cluster.

The safety controller does not alter the E39 graphics, shaders, diesel warm-up thresholds, shift logic, or vehicle telemetry.

## Not yet claimed as implemented

The current HUD builder still creates its planned layers synchronously. It does not yet use M Track's full hidden -> renderer-confirmed -> pixels-written -> bound -> shown staged transaction. Likewise, the release path sends independent drop commands and requests renderer status on a safety trip, but it does not yet parse a renderer-owned layer inventory to prove that every layer has been removed.

Those two changes require a protocol-grounded renderer state machine and separate integration tests. They are intentionally not approximated by treating a successful client call or a `hidden` event as proof of removal.

## Local checks

```sh
node tests/safety_controller.test.js
node --check shared/safety_controller.js
node --check tests/safety_controller.test.js
python kit/tools/build.py apex_dash
```

A successful local build does not prove on-car renderer behavior. The final validation still requires checking the MGU logs and confirming that the panel returns to BMW's native display after a forced safety stop.
