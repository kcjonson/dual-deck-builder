# ddb-184-ab-branch-4

Captured 2026-09-28 from http://localhost:9182/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 16.0, 23.6, 35.9 at the start, 15.5, 23.4, 35.7 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 453 | 2.21 | 7.71 | 8.18 | 0.09 | 6.81 | 1.75 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 541 | 1.85 | 9.24 | 10.78 | 0.02 | 10.18 | 0.25 | n/a | n/a | n/a | 0 | n/a | 57 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 613 | 1.63 | 6.97 | 8.00 | 0.02 | 6.18 | 7.18 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
