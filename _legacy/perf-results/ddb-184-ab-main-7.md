# ddb-184-ab-main-7

Captured 2026-09-28 from http://localhost:9183/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 14.1, 22.4, 35.0 at the start, 13.9, 22.2, 34.9 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 373 | 2.68 | 4.82 | 5.13 | 0.16 | 2.15 | 2.09 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 721 | 1.39 | 1.64 | 1.89 | 0.01 | 1.33 | 0.30 | n/a | n/a | n/a | 0 | n/a | 58 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 656 | 1.52 | 4.11 | 5.14 | 0.01 | 3.24 | 0.72 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
