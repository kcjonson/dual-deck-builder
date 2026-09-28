# ddb-184-ab-main-4

Captured 2026-09-28 from http://localhost:9183/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 16.0, 23.7, 36.0 at the start, 16.0, 23.6, 35.9 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 401 | 2.50 | 8.21 | 8.33 | 0.03 | 6.95 | 1.66 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 714 | 1.40 | 8.74 | 11.94 | 0.03 | 8.65 | 0.29 | n/a | n/a | n/a | 0 | n/a | 58 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 545 | 1.84 | 7.29 | 9.28 | 0.03 | 6.53 | 8.66 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
