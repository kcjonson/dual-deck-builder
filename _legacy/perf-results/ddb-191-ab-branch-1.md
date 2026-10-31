# ddb-191-ab-branch-1

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 34.9, 32.8, 34.1 at the start, 33.1, 32.5, 34.0 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 768 | 1.30 | 2.99 | 3.02 | 0.01 | 0.06 | 0.15 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 173 | 5.77 | 6.56 | 34.66 | 0.02 | 2.81 | 5.50 | n/a | n/a | n/a | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 401 | 2.49 | 23.93 | 27.53 | 0.02 | 1.85 | 25.84 | n/a | n/a | n/a | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 698 | 1.43 | 2.84 | 4.12 | 0.01 | 2.09 | 0.64 | n/a | n/a | n/a | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 766 | 1.31 | 3.03 | 4.15 | 0.01 | 2.19 | 0.68 | n/a | n/a | n/a | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
