# ddb-191-ab-branch-2

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 29.5, 35.4, 35.2 at the start, 26.7, 34.6, 34.9 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 630 | 1.59 | 5.30 | 31.41 | 0.05 | 0.08 | 4.69 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 186 | 5.39 | 6.95 | 7.07 | 0.03 | 3.00 | 6.06 | n/a | n/a | n/a | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 468 | 2.14 | 15.16 | 22.49 | 0.02 | 1.24 | 21.34 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 797 | 1.26 | 3.16 | 3.25 | 0.01 | 2.35 | 0.61 | n/a | n/a | n/a | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 811 | 1.23 | 2.82 | 5.34 | 0.01 | 2.08 | 0.56 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
