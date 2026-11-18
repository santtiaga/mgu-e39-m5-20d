# Renderer and engine-signal port review (18 Nov 2026)

## cluster-render 0.6.5–0.6.9

The upstream 0.6.9 Node client and the local Apex Dash client both speak protocol v1. The 0.6.9 native service changes do not add a new wire operation or require a client-side protocol bump.

| Version | Upstream change | Apex Dash action |
|---|---|---|
| 0.6.5 | Remembered upload ceiling between drives; INCIDENT records and upload trace | No client change required. Apex Dash already records pixel bytes, dirty/full frames, backpressure and renderer events. |
| 0.6.6 | Keep fetched scenes through slot locks and remap on unlock; preserve slot/target state and count parked video buffers | Service-side slot and compositor logic. Do not duplicate it in the app. |
| 0.6.7–0.6.8 | Opt-in packed video blocks and hosted VPP scaling | Not enabled: Apex Dash sends image/asset RGBA and effect uniforms, not video layers or hosted VPP. |
| 0.6.9 | Detect a KOMBI fetch accepted but never completed; retry after 5 s, republish on the second consecutive stall, reconnect RAMSES on the third (rate-limited); count a no-answer following a stall; reset the count when the display service goes away; wait for stock HMI mapping at startup; report the wait reason | Native service responsibility. The app cannot safely reproduce RAMSES/Dcsm2 recovery from JavaScript. The on-device LOGS view now highlights INCIDENT and stalled-fetch messages. |

### Client compatibility

The local `shared/cluster_render_client.js` is intentionally not replaced with upstream's 639-line copy. The local 752-line client retains:

- hidden-first staged replay and waits for retained pixel uploads and socket drain before `ready`;
- app-controlled deferred visibility and suspend/restore, used by the DCSM2 health gate;
- stale-socket event guards and explicit socket-error forwarding;
- pending-frame coalescing and per-image upload/backpressure telemetry.

The 0.6.9 target event's `rendering`, `retry_in_ms` and `disabled` fields, plus `stalled` layer state/reason, are already parsed by the local client. A regression test now verifies protocol-v1 hello and those diagnostics. The panel-only guard and no-HUD policy remain unchanged.

**Deployment note:** 0.6.9's native recovery only takes effect if the MGU's separately installed cluster-render service is actually updated to 0.6.9. Shipping an OAP app cannot replace that system service. Confirm the installed service version on the vehicle; do not infer it from the client version bundled in Apex Dash.

## Redline 2.0.45 review

### Rendering

Redline's `hud-draw.js` caches its static Canvas background and draws moving foreground elements over it. That implementation is specific to Redline's 400x130 HUD bitmap and is not a safe drop-in for Apex Dash's 1920x720 panel renderer.

Apex Dash already uses the corresponding optimisations for its own pipeline:

- static image widgets and scales are painted at layout build, not every frame;
- glyphs are cached in R8 atlases;
- text and badges are rasterised only when their resolved value/style changes;
- raster diffs upload only changed rectangles;
- image widgets are packed into sheets and sheet updates are dirty rectangles;
- effect widgets update quantised uniforms only when their value changes;
- the 20 Hz update loop skips unchanged widgets and pauses while renderer sockets are backpressured.

No Redline HUD target, layer, call-card or navigation behaviour was copied.

### Engine signals applicable to B47 MHEV

Ported only behaviours with a defensible mapping to the existing B47 signal set:

- The existing MHEV low-crank-speed floor (configured at 400 rpm) remains in place; the residual ~160 rpm after ICE stop is not displayed as an engine-running speed.
- Torque samples now carry a timestamp and expire after 2 s. An old torque value is not paired indefinitely with fresh RPM/speed to calculate power or torque percentage.
- Sport-display boost is trusted only after the value has changed from its initial sample, and only for 2 s. Pressure conversion follows the car's selected unit (bar/kPa/psi).
- DME boost fallback now uses the read-only UDS scheduler, checks provider readiness/availability, polls at 1 s, and after three failed reads wakes the ECU and backs off for 60 s. The existing DME candidate list and pressure plausibility bounds are retained.

Not ported: twin-engine V8 support, bank-2 DIDs, knock-control DIDs and experimental fuel-flow scalings. Those are either V8-specific or not verified on this B47 DDE. No new hybrid-battery DID is guessed; the 48 V MHEV battery is not equivalent to a plug-in hybrid's HV battery.

## Safety invariants

- Renderer target remains exactly `panel`; no HUD layers or HUD target are created.
- Local deferred visibility, DCSM2 watchdog, staged build, vehicle gate, error budget, socket lifecycle guards and dirty-rect pipeline are retained.
- Read-only engine diagnostics are stopped on app shutdown; queued/in-flight reads are cancelled and the native TASU proxy is released.
