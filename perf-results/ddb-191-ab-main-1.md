# ddb-191-ab-main-1

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 23.6, 31.4, 33.8 at the start, 22.5, 31.0, 33.6 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 346 | 2.89 | 5.87 | 6.51 | 0.02 | 2.31 | 6.00 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 771 | 1.30 | 4.86 | 4.88 | 0.01 | 4.42 | 0.42 | n/a | n/a | n/a | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 459 | 2.18 | 2.78 | 2.81 | 0.03 | 1.23 | 1.59 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 763 | 1.31 | 3.65 | 173.30 | 0.01 | 2.44 | 172.53 | n/a | n/a | n/a | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 1 (max 173.03) |
| combatScreen | 596 | 1.68 | 3.37 | 3.65 | 0.03 | 2.39 | 1.20 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
