# phase7-frame-baseline

Captured 2026-09-28 from http://localhost:9193/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 995 | 1.01 | 2.69 | 2.77 | 0.01 | 2.47 | 0.09 | n/a | n/a | n/a | 0 | n/a | 4 | 1 | 78 | endFrame 1 | 0 |
| mainMenuScreen | 702 | 1.42 | 2.79 | 3.06 | 0.01 | 0.07 | 2.64 | n/a | n/a | n/a | 0 | n/a | 12 | 1 | 150 | endFrame 1 | 0 |
| developerScreen | 493 | 2.03 | 4.05 | 4.05 | 0.06 | 3.82 | 0.02 | n/a | n/a | n/a | 0 | n/a | 37 | 2 | 388 | barrier 2 | 0 |
| cardShowcaseScreen | 289 | 3.47 | 8.80 | 9.08 | 0.24 | 8.76 | 0.03 | n/a | n/a | n/a | 0 | n/a | 288 | 2 | 6438 | barrier 2 | 0 |
| driverSelectionScreen | 988 | 1.01 | 4.62 | 5.05 | 0.05 | 3.70 | 1.02 | n/a | n/a | n/a | 0 | n/a | 88 | 1 | 2040 | endFrame 1 | 0 |
| combatScreen | 257 | 3.90 | 5.37 | 5.66 | 0.09 | 4.95 | 1.90 | n/a | n/a | n/a | 0 | n/a | 173 | 6 | 2118 | barrier 5, endFrame 1 | 0 |
| battleResultScreen | 721 | 1.39 | 2.86 | 2.94 | 0.02 | 1.06 | 1.34 | n/a | n/a | n/a | 0 | n/a | 6 | 1 | 22 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-frame-baseline.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 113 -> 995 (+780%) | 22.14 -> 2.69 (-88%) | 0.08 -> 0.01 (-87%) | 16.80 -> 2.47 (-85%) | 21.50 -> 0.09 (-100%) | n/a | n/a | 1 | 78 | endFrame 1 |
| mainMenuScreen | 112 -> 702 (+527%) | 18.01 -> 2.79 (-85%) | 0.06 -> 0.01 (-83%) | 9.96 -> 0.07 (-99%) | 10.01 -> 2.64 (-74%) | n/a | n/a | 1 | 150 | endFrame 1 |
| developerScreen | 65 -> 493 (+655%) | 31.32 -> 4.05 (-87%) | 0.09 -> 0.06 (-37%) | 30.91 -> 3.82 (-88%) | 0.03 -> 0.02 (-33%) | n/a | n/a | 2 | 388 | barrier 2 |
| cardShowcaseScreen | 110 -> 289 (+162%) | 14.23 -> 8.80 (-38%) | 0.14 -> 0.24 (+71%) | 14.90 -> 8.76 (-41%) | 0.03 | n/a | n/a | 2 | 6438 | barrier 2 |
| driverSelectionScreen | 137 -> 988 (+620%) | 11.33 -> 4.62 (-59%) | 0.06 -> 0.05 (-8%) | 10.48 -> 3.70 (-65%) | 0.78 -> 1.02 (+31%) | n/a | n/a | 1 | 2040 | endFrame 1 |
| combatScreen | 38 -> 257 (+570%) | 30.70 -> 5.37 (-83%) | 0.06 -> 0.09 (+58%) | 30.67 -> 4.95 (-84%) | 7.87 -> 1.90 (-76%) | n/a | n/a | 6 | 2118 | barrier 5, endFrame 1 |
| battleResultScreen | 198 -> 721 (+264%) | 9.97 -> 2.86 (-71%) | 0.02 | 4.69 -> 1.06 (-78%) | 5.49 -> 1.34 (-76%) | n/a | n/a | 1 | 22 | endFrame 1 |
