# phase7-frame-gpu

Captured 2026-09-28 from http://localhost:9193/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 16.57 | 18.75 | 18.86 | 0.05 | 0.43 | 0.27 | 2.98 | 3.03 | 3.06 | 0 | n/a | 4 | 1 | 78 | endFrame 1 | 0 |
| mainMenuScreen | 60 | 16.70 | 18.75 | 18.77 | 0.05 | 0.25 | 0.25 | 3.02 | 3.05 | 3.05 | 0 | n/a | 12 | 1 | 150 | endFrame 1 | 0 |
| developerScreen | 60 | 16.60 | 18.66 | 18.75 | 0.07 | 0.92 | 0.20 | 4.95 | 5.07 | 5.11 | 0 | n/a | 37 | 2 | 388 | barrier 2 | 0 |
| cardShowcaseScreen | 60 | 16.72 | 18.63 | 18.70 | 0.15 | 4.50 | 0.01 | 6.39 | 6.49 | 6.51 | 0 | n/a | 288 | 2 | 6438 | barrier 2 | 0 |
| driverSelectionScreen | 60 | 16.67 | 18.62 | 18.77 | 0.04 | 0.21 | 1.02 | 3.94 | 4.00 | 4.02 | 0 | n/a | 88 | 1 | 2040 | endFrame 1 | 0 |
| combatScreen | 60 | 16.63 | 18.76 | 18.79 | 0.09 | 1.69 | 0.05 | 5.77 | 6.05 | 6.07 | 0 | n/a | 173 | 6 | 2118 | barrier 5, endFrame 1 | 0 |
| battleResultScreen | 60 | 16.64 | 18.47 | 18.65 | 0.04 | 0.24 | 0.11 | 3.11 | 3.15 | 3.16 | 0 | n/a | 6 | 1 | 22 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-frame-gpu.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 18.62 -> 18.75 (+1%) | 0.05 | 0.25 -> 0.43 (+76%) | 0.19 -> 0.27 (+36%) | 5.44 -> 2.98 (-45%) | 5.46 -> 3.03 (-45%) | 1 | 78 | endFrame 1 |
| mainMenuScreen | 60 | 18.52 -> 18.75 (+1%) | 0.08 -> 0.05 (-37%) | 0.31 -> 0.25 (-18%) | 0.26 -> 0.25 (-6%) | 5.47 -> 3.02 (-45%) | 5.49 -> 3.05 (-44%) | 1 | 150 | endFrame 1 |
| developerScreen | 60 | 18.11 -> 18.66 (+3%) | 0.18 -> 0.07 (-60%) | 1.23 -> 0.92 (-26%) | 0.13 -> 0.20 (+60%) | 8.97 -> 4.95 (-45%) | 9.03 -> 5.07 (-44%) | 2 | 388 | barrier 2 |
| cardShowcaseScreen | 60 | 18.49 -> 18.63 (+1%) | 0.25 -> 0.15 (-42%) | 5.10 -> 4.50 (-12%) | 0.04 -> 0.01 (-75%) | 9.65 -> 6.39 (-34%) | 9.69 -> 6.49 (-33%) | 2 | 6438 | barrier 2 |
| driverSelectionScreen | 60 | 18.66 -> 18.62 (0%) | 0.08 -> 0.04 (-44%) | 7.03 -> 0.21 (-97%) | 2.47 -> 1.02 (-59%) | 6.36 -> 3.94 (-38%) | 6.40 -> 4.00 (-37%) | 1 | 2040 | endFrame 1 |
| combatScreen | 33 -> 60 (+81%) | 33.59 -> 18.76 (-44%) | 0.17 -> 0.09 (-46%) | 2.38 -> 1.69 (-29%) | 0.29 -> 0.05 (-81%) | 16.17 -> 5.77 (-64%) | 16.29 -> 6.05 (-63%) | 6 | 2118 | barrier 5, endFrame 1 |
| battleResultScreen | 61 -> 60 (-1%) | 18.45 -> 18.47 (+0%) | 0.08 -> 0.04 (-44%) | 0.32 -> 0.24 (-25%) | 0.17 -> 0.11 (-33%) | 5.54 -> 3.11 (-44%) | 5.59 -> 3.15 (-44%) | 1 | 22 | endFrame 1 |
