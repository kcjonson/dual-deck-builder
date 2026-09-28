# ddb-184-ab-branch-7

Captured 2026-09-28 from http://localhost:9182/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 13.7, 22.0, 34.8 at the start, 13.7, 22.0, 34.8 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 449 | 2.23 | 2.69 | 2.78 | 0.02 | 0.98 | 1.99 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 866 | 1.16 | 1.51 | 1.65 | 0.01 | 0.98 | 0.34 | n/a | n/a | n/a | 0 | n/a | 57 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 691 | 1.45 | 4.54 | 5.33 | 0.03 | 4.41 | 0.67 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
