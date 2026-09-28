# phase1-frame-final

Captured 2026-09-28 from http://localhost:9168/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 1556 | 0.64 | 3.00 | 3.14 | 0.03 | 2.78 | 0.15 | n/a | n/a | n/a | 0 | n/a | 4 | 1 | 70 | endFrame 1 |
| mainMenuScreen | 437 | 2.29 | 5.78 | 5.88 | 0.06 | 3.13 | 3.29 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 |
| developerScreen | 360 | 2.78 | 5.79 | 6.47 | 0.11 | 4.52 | 5.55 | n/a | n/a | n/a | 0 | n/a | 44 | 1 | 444 | endFrame 1 |
| cardShowcaseScreen | 261 | 3.82 | 5.41 | 5.76 | 0.25 | 2.95 | 3.56 | n/a | n/a | n/a | 0 | n/a | 288 | 1 | 5790 | endFrame 1 |
| driverSelectionScreen | 823 | 1.22 | 4.36 | 4.43 | 0.08 | 3.22 | 1.41 | n/a | n/a | n/a | 0 | n/a | 88 | 1 | 1812 | endFrame 1 |
| combatScreen | 571 | 1.75 | 5.32 | 5.73 | 0.17 | 4.35 | 1.74 | n/a | n/a | n/a | 0 | n/a | 171 | 1 | 1916 | endFrame 1 |
| battleResultScreen | 762 | 1.31 | 2.78 | 2.79 | 0.02 | 1.06 | 2.53 | n/a | n/a | n/a | 0 | n/a | 6 | 1 | 22 | endFrame 1 |

## Against perf-results/phase7-frame-baseline.json

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 113 -> 1556 (+1277%) | 22.14 -> 3.00 (-86%) | 0.08 -> 0.03 (-69%) | 16.80 -> 2.78 (-83%) | 21.50 -> 0.15 (-99%) | n/a | n/a | 1 | 78 -> 70 (-10%) | endFrame 1 |
| mainMenuScreen | 112 -> 437 (+290%) | 18.01 -> 5.78 (-68%) | 0.06 | 9.96 -> 3.13 (-69%) | 10.01 -> 3.29 (-67%) | n/a | n/a | 1 | 150 -> 142 (-5%) | endFrame 1 |
| developerScreen | 65 -> 360 (+452%) | 31.32 -> 5.79 (-81%) | 0.09 -> 0.11 (+16%) | 30.91 -> 4.52 (-85%) | 0.03 -> 5.55 (+18400%) | n/a | n/a | 2 -> 1 (-50%) | 388 -> 444 (+14%) | barrier 2 -> endFrame 1 |
| cardShowcaseScreen | 110 -> 261 (+137%) | 14.23 -> 5.41 (-62%) | 0.14 -> 0.25 (+75%) | 14.90 -> 2.95 (-80%) | 0.03 -> 3.56 (+10086%) | n/a | n/a | 2 -> 1 (-50%) | 6438 -> 5790 (-10%) | barrier 2 -> endFrame 1 |
| driverSelectionScreen | 137 -> 823 (+500%) | 11.33 -> 4.36 (-62%) | 0.06 -> 0.08 (+33%) | 10.48 -> 3.22 (-69%) | 0.78 -> 1.41 (+80%) | n/a | n/a | 1 | 2040 -> 1812 (-11%) | endFrame 1 |
| combatScreen | 38 -> 571 (+1388%) | 30.70 -> 5.32 (-83%) | 0.06 -> 0.17 (+175%) | 30.67 -> 4.35 (-86%) | 7.87 -> 1.74 (-78%) | n/a | n/a | 6 -> 1 (-83%) | 2118 -> 1916 (-10%) | barrier 5, endFrame 1 -> endFrame 1 |
| battleResultScreen | 198 -> 762 (+285%) | 9.97 -> 2.78 (-72%) | 0.02 | 4.69 -> 1.06 (-78%) | 5.49 -> 2.53 (-54%) | n/a | n/a | 1 | 22 | endFrame 1 |
