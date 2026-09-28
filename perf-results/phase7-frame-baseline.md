# phase7-frame-baseline

Captured 2026-09-28 from http://localhost:9092/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 113 | 8.85 | 22.14 | 125.69 | 0.08 | 16.80 | 21.50 | n/a | n/a | n/a | 0 | n/a | 4 | 1 | 78 | endFrame 1 |
| mainMenuScreen | 112 | 8.94 | 18.01 | 18.63 | 0.06 | 9.96 | 10.01 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 150 | endFrame 1 |
| developerScreen | 65 | 15.32 | 31.32 | 40.96 | 0.09 | 30.91 | 0.03 | n/a | n/a | n/a | 0 | n/a | 37 | 2 | 388 | barrier 2 |
| cardShowcaseScreen | 110 | 9.07 | 14.23 | 15.26 | 0.14 | 14.90 | 0.03 | n/a | n/a | n/a | 0 | n/a | 288 | 2 | 6438 | barrier 2 |
| driverSelectionScreen | 137 | 7.29 | 11.33 | 11.41 | 0.06 | 10.48 | 0.78 | n/a | n/a | n/a | 0 | n/a | 88 | 1 | 2040 | endFrame 1 |
| combatScreen | 38 | 26.08 | 30.70 | 31.03 | 0.06 | 30.67 | 7.87 | n/a | n/a | n/a | 0 | n/a | 173 | 6 | 2118 | barrier 5, endFrame 1 |
| battleResultScreen | 198 | 5.05 | 9.97 | 10.14 | 0.02 | 4.69 | 5.49 | n/a | n/a | n/a | 0 | n/a | 6 | 1 | 22 | endFrame 1 |
