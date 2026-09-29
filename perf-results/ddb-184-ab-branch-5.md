# ddb-184-ab-branch-5

Captured 2026-09-28 from http://localhost:9182/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 40 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 14.7, 23.1, 35.6 at the start, 14.2, 22.8, 35.4 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cardShowcaseScreen | 407 | 2.46 | 5.09 | 5.11 | 0.05 | 2.35 | 2.49 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| developerScreen | 881 | 1.14 | 1.41 | 1.62 | 0.03 | 0.84 | 0.33 | n/a | n/a | n/a | 0 | n/a | 57 | 1 | 652 | endFrame 1 | 0 |
| combatScreen | 407 | 2.46 | 9.40 | 27.72 | 0.30 | 8.02 | 12.96 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
