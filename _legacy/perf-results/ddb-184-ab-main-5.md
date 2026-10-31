# ddb-184-ab-main-5

Captured 2026-09-28 from http://localhost:9183/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 15.5, 23.4, 35.7 at the start, 14.7, 23.1, 35.6 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 445 | 2.25 | 2.78 | 2.85 | 0.01 | 1.43 | 1.41 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 684 | 1.46 | 1.91 | 1.98 | 0.03 | 1.27 | 0.34 | n/a | n/a | n/a | 0 | n/a | 58 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 691 | 1.45 | 4.48 | 5.00 | 0.02 | 4.04 | 0.97 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
