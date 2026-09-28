# phase7-frame-baseline

Captured 2026-09-28 from http://localhost:9193/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 1061 | 0.94 | 2.68 | 2.98 | 0.02 | 2.34 | 1.28 | n/a | n/a | n/a | 0 | n/a | 4 | 1 | 70 | endFrame 1 | 0 |
| mainMenuScreen | 802 | 1.25 | 4.09 | 6.56 | 0.01 | 1.71 | 3.65 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 449 | 2.23 | 4.29 | 4.42 | 0.04 | 4.07 | 0.01 | n/a | n/a | n/a | 0 | n/a | 37 | 2 | 370 | barrier 2 | 0 |
| cardShowcaseScreen | 265 | 3.77 | 9.29 | 9.45 | 0.11 | 9.13 | 0.04 | n/a | n/a | n/a | 0 | n/a | 288 | 2 | 5790 | barrier 2 | 0 |
| driverSelectionScreen | 765 | 1.31 | 4.10 | 4.56 | 0.03 | 3.36 | 1.10 | n/a | n/a | n/a | 0 | n/a | 88 | 1 | 1812 | endFrame 1 | 0 |
| combatScreen | 196 | 5.10 | 6.02 | 6.80 | 0.12 | 5.57 | 2.02 | n/a | n/a | n/a | 0 | n/a | 170 | 6 | 1896 | barrier 5, endFrame 1 | 0 |
| battleResultScreen | 794 | 1.26 | 2.64 | 2.88 | 0.01 | 1.07 | 1.21 | n/a | n/a | n/a | 0 | n/a | 6 | 1 | 22 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-frame-baseline.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 113 -> 1061 (+838%) | 22.14 -> 2.68 (-88%) | 0.08 -> 0.02 (-81%) | 16.80 -> 2.34 (-86%) | 21.50 -> 1.28 (-94%) | n/a | n/a | 1 | 78 -> 70 (-10%) | endFrame 1 |
| mainMenuScreen | 112 -> 802 (+616%) | 18.01 -> 4.09 (-77%) | 0.06 -> 0.01 (-83%) | 9.96 -> 1.71 (-83%) | 10.01 -> 3.65 (-64%) | n/a | n/a | 1 | 150 -> 142 (-5%) | endFrame 1 |
| developerScreen | 65 -> 449 (+588%) | 31.32 -> 4.29 (-86%) | 0.09 -> 0.04 (-53%) | 30.91 -> 4.07 (-87%) | 0.03 -> 0.01 (-50%) | n/a | n/a | 2 | 388 -> 370 (-5%) | barrier 2 |
| cardShowcaseScreen | 110 -> 265 (+140%) | 14.23 -> 9.29 (-35%) | 0.14 -> 0.11 (-25%) | 14.90 -> 9.13 (-39%) | 0.03 -> 0.04 (+0%) | n/a | n/a | 2 | 6438 -> 5790 (-10%) | barrier 2 |
| driverSelectionScreen | 137 -> 765 (+458%) | 11.33 -> 4.10 (-64%) | 0.06 -> 0.03 (-50%) | 10.48 -> 3.36 (-68%) | 0.78 -> 1.10 (+41%) | n/a | n/a | 1 | 2040 -> 1812 (-11%) | endFrame 1 |
| combatScreen | 38 -> 196 (+411%) | 30.70 -> 6.02 (-80%) | 0.06 -> 0.12 (+92%) | 30.67 -> 5.57 (-82%) | 7.87 -> 2.02 (-74%) | n/a | n/a | 6 | 2118 -> 1896 (-10%) | barrier 5, endFrame 1 |
| battleResultScreen | 198 -> 794 (+301%) | 9.97 -> 2.64 (-74%) | 0.02 -> 0.01 (-33%) | 4.69 -> 1.07 (-77%) | 5.49 -> 1.21 (-78%) | n/a | n/a | 1 | 22 | endFrame 1 |
