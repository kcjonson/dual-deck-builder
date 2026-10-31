# ddb-184-ab-branch-6

Captured 2026-09-28 from http://localhost:9182/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 14.2, 22.5, 35.2 at the start, 14.1, 22.4, 35.0 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 432 | 2.31 | 2.65 | 2.78 | 0.02 | 0.95 | 1.63 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 957 | 1.05 | 1.48 | 1.51 | 0.04 | 0.88 | 0.32 | n/a | n/a | n/a | 0 | n/a | 57 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 684 | 1.46 | 4.17 | 4.58 | 0.03 | 3.68 | 0.67 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
