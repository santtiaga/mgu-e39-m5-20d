# DCSM2 Lab

Independent benchmark app for the MGU `cluster-render` socket. It does not load Apex Dash HUD, layout planning, vehicle signals, startup animation, watchdog, or recovery controller.

## Tests

- Renderer handshake and target/status events.
- Effect surfaces: 1x1, 480x180, 1920x720.
- Concurrent effect count: 1, 2, 4, 8, 12, 16.
- GLSL loop workloads: 16, 32, 64, 128 iterations.
- Actual E39DASH shader with masks: 255, 107, 111, 123, 235.
- 100 create/drop lifecycle cycles.
- 5-minute sustained rendering in the full suite.
- Optional 30-minute soak and manual client reconnect.

## Safety

The app targets only `panel`. It creates real effect layers on the instrument cluster and may tint or obscure the factory display while a test is active. Run it only while parked. Do not run Apex Dash or another cluster-render app at the same time. Stop the benchmark before leaving the app.

## Log

The app writes `dcsm2_lab.log` under the app's `ctx.dataDir`. It also writes messages to the app log.
