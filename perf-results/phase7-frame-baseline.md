# phase7-frame-baseline

Captured 2026-09-28 from http://localhost:9193/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 4.5, 10.4, 15.9 at the start, 5.3, 10.4, 15.8 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 851 | 1.17 | 3.50 | 3.53 | 0.07 | 3.13 | 1.31 | n/a | n/a | n/a | 0 | n/a | 4 | 1 | 70 | endFrame 1 | 0 |
| mainMenuScreen | 727 | 1.38 | 3.93 | 4.29 | 0.03 | 0.08 | 4.00 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 703 | 1.42 | 4.38 | 4.96 | 0.12 | 3.91 | 0.48 | n/a | n/a | n/a | 0 | n/a | 37 | 1 | 370 | endFrame 1 | 0 |
| cardShowcaseScreen | 275 | 3.64 | 6.10 | 6.76 | 0.22 | 3.47 | 4.37 | n/a | n/a | n/a | 0 | n/a | 288 | 1 | 5790 | endFrame 1 | 0 |
| driverSelectionScreen | 763 | 1.31 | 5.08 | 5.70 | 0.07 | 4.45 | 1.29 | n/a | n/a | n/a | 0 | n/a | 88 | 1 | 1812 | endFrame 1 | 0 |
| combatScreen | 737 | 1.36 | 5.25 | 5.48 | 0.11 | 4.03 | 1.61 | n/a | n/a | n/a | 0 | n/a | 171 | 1 | 1916 | endFrame 1 | 0 |
| battleResultScreen | 774 | 1.29 | 3.12 | 3.41 | 0.02 | 1.32 | 1.71 | n/a | n/a | n/a | 0 | n/a | 6 | 1 | 22 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-frame-baseline.json at 987494b)

Section maxima and p99 move with whatever else the machine is doing, and two unthrottled captures of the same build can differ by tens of percent on a light scene. A section or max delta here is unconfirmed until a second capture agrees; FPS on a heavy scene and paced GPU medians are stable to a few percent.

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 113 -> 851 (+653%) | 22.14 -> 3.50 (-84%) | 0.08 -> 0.07 (-12%) | 16.80 -> 3.13 (-81%) | 21.50 -> 1.31 (-94%) | n/a | n/a | 1 | 78 -> 70 (-10%) | endFrame 1 |
| mainMenuScreen | 112 -> 727 (+550%) | 18.01 -> 3.93 (-78%) | 0.06 -> 0.03 (-50%) | 9.96 -> 0.08 (-99%) | 10.01 -> 4.00 (-60%) | n/a | n/a | 1 | 150 -> 142 (-5%) | endFrame 1 |
| developerScreen | 65 -> 703 (+977%) | 31.32 -> 4.38 (-86%) | 0.09 -> 0.12 (+21%) | 30.91 -> 3.91 (-87%) | 0.03 -> 0.48 (+1500%) | n/a | n/a | 2 -> 1 (-50%) | 388 -> 370 (-5%) | barrier 2 -> endFrame 1 |
| cardShowcaseScreen | 110 -> 275 (+149%) | 14.23 -> 6.10 (-57%) | 0.14 -> 0.22 (+54%) | 14.90 -> 3.47 (-77%) | 0.03 -> 4.37 (+12371%) | n/a | n/a | 2 -> 1 (-50%) | 6438 -> 5790 (-10%) | barrier 2 -> endFrame 1 |
| driverSelectionScreen | 137 -> 763 (+457%) | 11.33 -> 5.08 (-55%) | 0.06 -> 0.07 (+17%) | 10.48 -> 4.45 (-58%) | 0.78 -> 1.29 (+65%) | n/a | n/a | 1 | 2040 -> 1812 (-11%) | endFrame 1 |
| combatScreen | 38 -> 737 (+1821%) | 30.70 -> 5.25 (-83%) | 0.06 -> 0.11 (+83%) | 30.67 -> 4.03 (-87%) | 7.87 -> 1.61 (-80%) | n/a | n/a | 6 -> 1 (-83%) | 2118 -> 1916 (-10%) | barrier 5, endFrame 1 -> endFrame 1 |
| battleResultScreen | 198 -> 774 (+291%) | 9.97 -> 3.12 (-69%) | 0.02 | 4.69 -> 1.32 (-72%) | 5.49 -> 1.71 (-69%) | n/a | n/a | 1 | 22 | endFrame 1 |
