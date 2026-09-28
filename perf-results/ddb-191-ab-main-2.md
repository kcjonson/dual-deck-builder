# ddb-191-ab-main-2

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 56.0, 40.2, 36.7 at the start, 51.9, 39.6, 36.6 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 1015 | 0.98 | 5.19 | 9.97 | 0.04 | 3.97 | 8.63 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 847 | 1.18 | 3.26 | 3.72 | 0.01 | 2.97 | 0.41 | n/a | n/a | n/a | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 422 | 2.37 | 2.81 | 2.83 | 0.03 | 1.20 | 1.77 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 731 | 1.37 | 2.95 | 3.20 | 0.01 | 2.28 | 0.98 | n/a | n/a | n/a | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 603 | 1.66 | 5.04 | 5.23 | 0.03 | 3.95 | 1.45 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
