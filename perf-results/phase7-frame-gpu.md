# phase7-frame-gpu

Captured 2026-09-28 from http://localhost:9193/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 16.70 | 18.64 | 18.69 | 0.06 | 0.41 | 0.36 | 2.95 | 3.03 | 3.08 | 0 | n/a | 4 | 1 | 70 | endFrame 1 | 0 |
| mainMenuScreen | 60 | 16.66 | 18.83 | 18.92 | 0.03 | 0.26 | 0.40 | 2.96 | 3.03 | 3.04 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.73 | 18.61 | 18.72 | 0.09 | 1.44 | 0.04 | 4.91 | 5.01 | 5.06 | 0 | n/a | 37 | 2 | 370 | barrier 2 | 0 |
| cardShowcaseScreen | 60 | 16.66 | 18.50 | 18.77 | 0.19 | 5.51 | 0.02 | 6.33 | 6.42 | 6.43 | 0 | n/a | 288 | 2 | 5790 | barrier 2 | 0 |
| driverSelectionScreen | 60 | 16.64 | 18.58 | 18.63 | 0.06 | 0.38 | 1.58 | 3.94 | 4.06 | 4.06 | 0 | n/a | 88 | 1 | 1812 | endFrame 1 | 0 |
| combatScreen | 60 | 16.62 | 18.62 | 18.65 | 0.15 | 2.34 | 0.11 | 5.80 | 5.94 | 6.08 | 0 | n/a | 170 | 6 | 1896 | barrier 5, endFrame 1 | 0 |
| battleResultScreen | 60 | 16.67 | 18.85 | 18.86 | 0.04 | 0.23 | 0.26 | 3.09 | 3.15 | 3.15 | 0 | n/a | 6 | 1 | 22 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-frame-gpu.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 18.62 -> 18.64 (+0%) | 0.05 -> 0.06 (+20%) | 0.25 -> 0.41 (+65%) | 0.19 -> 0.36 (+85%) | 5.44 -> 2.95 (-46%) | 5.46 -> 3.03 (-44%) | 1 | 78 -> 70 (-10%) | endFrame 1 |
| mainMenuScreen | 60 | 18.52 -> 18.83 (+2%) | 0.08 -> 0.03 (-56%) | 0.31 -> 0.26 (-15%) | 0.26 -> 0.40 (+49%) | 5.47 -> 2.96 (-46%) | 5.49 -> 3.03 (-45%) | 1 | 150 -> 142 (-5%) | endFrame 1 |
| developerScreen | 60 | 18.11 -> 18.61 (+3%) | 0.18 -> 0.09 (-49%) | 1.23 -> 1.44 (+17%) | 0.13 -> 0.04 (-72%) | 8.97 -> 4.91 (-45%) | 9.03 -> 5.01 (-44%) | 2 | 388 -> 370 (-5%) | barrier 2 |
| cardShowcaseScreen | 60 | 18.49 -> 18.50 (+0%) | 0.25 -> 0.19 (-22%) | 5.10 -> 5.51 (+8%) | 0.04 -> 0.02 (-38%) | 9.65 -> 6.33 (-34%) | 9.69 -> 6.42 (-34%) | 2 | 6438 -> 5790 (-10%) | barrier 2 |
| driverSelectionScreen | 60 | 18.66 -> 18.58 (0%) | 0.08 -> 0.06 (-25%) | 7.03 -> 0.38 (-95%) | 2.47 -> 1.58 (-36%) | 6.36 -> 3.94 (-38%) | 6.40 -> 4.06 (-37%) | 1 | 2040 -> 1812 (-11%) | endFrame 1 |
| combatScreen | 33 -> 60 (+81%) | 33.59 -> 18.62 (-45%) | 0.17 -> 0.15 (-14%) | 2.38 -> 2.34 (-2%) | 0.29 -> 0.11 (-62%) | 16.17 -> 5.80 (-64%) | 16.29 -> 5.94 (-64%) | 6 | 2118 -> 1896 (-10%) | barrier 5, endFrame 1 |
| battleResultScreen | 61 -> 60 (-1%) | 18.45 -> 18.85 (+2%) | 0.08 -> 0.04 (-50%) | 0.32 -> 0.23 (-28%) | 0.17 -> 0.26 (+58%) | 5.54 -> 3.09 (-44%) | 5.59 -> 3.15 (-44%) | 1 | 22 | endFrame 1 |
