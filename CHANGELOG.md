# Changes

## 1.5.6

- Fix flattened MGU runtime module paths that prevented Apex Dash from loading; correct lazy diagnostic Canvas path.


## 1.5.5

- Fix packaged startup imports and make diagnostic logger initialization lazy so a Canvas failure cannot block the cluster GUI.


Newest first. Dates are when the build was pushed.

## Nov 18 2026

## Nov 18 2026

- **Apex Dash 1.5.4:** verify cluster-render 0.6.9 protocol-v1 diagnostics without replacing local replay/safety logic; highlight native renderer INCIDENT/stalled-fetch diagnostics; use Redline's validated boost-unit and freshness rules; expire stale B47 torque samples; move DME boost reads to the paced read-only UDS scheduler with availability checks, ECU wake and bounded retry backoff. Keep GPU/shader, glyph-atlas, sheet-packing and dirty-rectangle rendering optimisations; do not port Redline HUD-only canvas or V8/twin-engine code.

- **Apex Dash 1.5.3:** serialize native SOME/IP operations through a fair urgent/normal queue (a waiting read gets a turn after at most three urgent operations), retain per-operation timeouts and idempotent proxy shutdown/subscription teardown; stage transient RHMI PNGs in RAM when available and atomically publish resource files; durably replace settings files with fsync + rename. Verify the bundled cluster-render client against upstream 0.6.9 without replacing local replay, visibility, reconnect, and socket-lifecycle safety.

## Nov 17 2026

- **Apex Dash 1.4.9:** add a DCSM2 availability watchdog using cluster-render's status protocol. Defer initial panel layers until DCSM2 is confirmed available, pause live widget updates while unavailable, and automatically resume after recovery; expose the wait state in the app status line.

## Nov 17 2026

- **Apex Dash 1.4.8:** include best-effort cluster-render system logs in the phone log export, recording explicit read errors (such as EACCES/ENOENT) when the MGU app cannot access them.

## Nov 17 2026

- **Apex Dash 1.4.7:** preserve raw cluster-render target/layer/error event payloads in diagnostic logs and capture full unhandled-rejection details, including stack traces.

## Nov 17 2026

- **Apex Dash 1.4.5:** reuse text-glow blur scratch buffers instead of allocating intermediate masks on every repaint; replace four needle-layer distance square roots used only for circular bounds checks with equivalent squared-distance tests. Visual geometry and effect parameters are unchanged.

## Nov 17 2026

- **Apex Dash 1.4.4:** add a configurable 400 rpm stopped-engine floor for the B47 MHEV's residual engine-speed signal; prevent pending SOME/IP reads and notifications from updating data after shutdown; release the layouts filesystem watcher and debounce timer on stop; stop DME boost polling when layout layers are dropped; make HUD shutdown idempotent and clear its pending status timer. CI now runs every `tests/*.test.js` file.

## Nov 16 2026

- **Apex Dash 1.4.3:** port Redline's vehicle-state shutdown gate into the panel renderer: defer new layers during ignition transitions, drop active layers when the car switches off, and resume rendering when drive-ready. Add the optional BMW VehicleCondition signal.

## Nov 16 2026

- **Apex Dash 1.4.2:** update the bundled cluster-render client to the current upstream implementation; retain diagnostic target-state and retry telemetry for the in-app logs.

## Nov 16 2026

- **Apex Dash 1.4.0:** restored the pre-refactor codebase; version metadata and package documentation updated.

## Nov 7 2026

- **Cluster Themes 0.8.4:** the M theme fills the panel: taller blades and cards that reach from the top of the screen to the bottom, bigger side groups, and black cards with a grey rim so BMW's black gear box no longer shows as a hole. New Map calibration theme for measuring the map cut-out on a photo.

## Nov 6 2026

- **Cluster Themes 0.8.2:** installs from the Store again. 0.8.1 (and 0.8.0) asked to read the car's M Drive gearbox display, which the car only sends as updates, so the head unit's app manager refused to install the app. It now only listens for those updates; the S or M next to the gear works as before.
- **Cluster Themes 0.8.1:** the M theme traced 1:1 off the M8 photo instead of restyled from it: the cards' curved top edge and big rounded corners, the blades' exact curve, width and ticks, the fuel and oil dials as the M8's thin glass brackets cut from the photo's own circles (a hatched chrome bezel, glass lit from the bottom up to the level, a red streak at the level and at the reserve or hot end), every number and label in a squared bold face like BMW's (Orbitron, open licence; S no longer reads as 8), and every readout at the photo's position and size. The only departures are forced by the X3: the setup rows are split round BMW's black box (two above it, two below), the badge is the M stripes alone, and the rev scale ends at 7.
- **Cluster Themes 0.8.0:** the M theme reworked from the car photos: near-black cards stretched to the panel's full height, round fuel and oil dials in the lower corners, taller rev blades, the gear with its shifter programme (D, S or M), the setup rows for all five drive modes (Individual shows as INDIVIDUAL: the car does not report what each part is set to), and the tyre block reading the car's own units (it showed 32 psi as 464 psi). The layer budget per theme is 24 after the car drew all sixteen probe layers of the calibration grid.
- **Cluster Themes 0.7.5:** the Sport and M rev scales end at 7000 rpm, like the M40i's own cluster (they read to 8 before). The red marks always cover at least the last 500 rpm, with the yellow ones in the 700 rpm before them.
- **Cluster Themes 0.7.4:** the M theme rebuilt against the M8 photo. Bowed glass rev blades with a red marker at the rpm, charcoal cards, white gear and speed, and the tyre pressure and temperature block (from the car's tyre monitor) in place of the G-meter.

## Nov 5 2026

- **Cluster Themes 0.7.3, HUD Widgets 0.5.3:** the calibration grids carry a line of text drawn by a shader from a glyph atlas, a test for a lighter way to draw readouts.
- **Cluster Themes 0.7.2, HUD Widgets 0.5.2:** the drawing engine can use several connections to cluster-render (8 layers each), counts the pixel memory a layout costs, and sends only the pixels of text that changed.
- **Cluster Themes 0.7.1, HUD Widgets 0.5.1:** the shift lights come on from 3000 rpm, so they are not dark when revving parked.
- **Cluster Themes 0.7.0:** the Dials theme is removed after the car test.
- **Cluster Themes 0.6.0, HUD Widgets 0.5.0:** fixes from the second car test. Every theme fits in the car's limit of 8 layers, backdrops are pure black (dark tints show on the panel), and nothing sits under the hood line or BMW's black gear box. The HUD layouts are fitted to the visible window measured from the grid photo.
- **Cluster Themes 0.5.1:** the M and Sport themes match BMW's own clusters.
- **Cluster Themes 0.5.0:** a Dials theme (removed again in 0.7.0), Sport restyled, 200 mph speed scale.

## Nov 4 2026

- **Cluster Themes 0.4.0:** Sport theme, after BMW's Live Cockpit view.
- **Cluster Themes 0.3.0:** M theme.
- **Cluster Themes 0.2.0, HUD Widgets 0.4.0:** fixes from the first car test. Shapes drew upside down, boost did not show (now read from the engine computer as a backup), and the rpm wobbled at idle. Both apps get an Off option and drive mode switching; the calibration grids are added.
- **Cluster Themes 0.1.0:** first release, with the GT3 race dash.
- **HUD Widgets 0.3.0:** Daily, Sport and Redline layouts.
