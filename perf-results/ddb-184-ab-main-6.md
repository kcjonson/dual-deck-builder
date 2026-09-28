# ddb-184-ab-main-6

Captured 2026-09-28 from http://localhost:9183/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 14.4, 22.7, 35.3 at the start, 14.4, 22.7, 35.3 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 381 | 2.63 | 10.28 | 23.16 | 0.05 | 4.41 | 21.36 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 615 | 1.63 | 2.33 | 3.02 | 0.02 | 2.04 | 0.56 | n/a | n/a | n/a | 0 | n/a | 58 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 678 | 1.47 | 2.38 | 2.62 | 0.03 | 1.24 | 1.47 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
