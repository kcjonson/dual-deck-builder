# phase7-frame-gpu

Captured 2026-09-28 from http://localhost:9193/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 6.0, 12.7, 17.3 at the start, 8.1, 12.6, 17.1 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 16.65 | 18.11 | 18.21 | 0.06 | 0.51 | 0.70 | 2.93 | 2.98 | 2.98 | 0 | n/a | 4 | 1 | 70 | endFrame 1 | 0 |
| mainMenuScreen | 60 | 16.66 | 17.08 | 17.11 | 0.03 | 0.26 | 0.30 | 2.95 | 3.00 | 3.05 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.68 | 17.09 | 17.09 | 0.17 | 0.86 | 0.93 | 4.63 | 4.68 | 4.69 | 0 | n/a | 37 | 1 | 370 | endFrame 1 | 0 |
| cardShowcaseScreen | 60 | 16.67 | 17.05 | 17.06 | 0.50 | 3.39 | 4.79 | 5.99 | 6.09 | 6.11 | 0 | n/a | 288 | 1 | 5790 | endFrame 1 | 0 |
| driverSelectionScreen | 60 | 16.69 | 17.20 | 17.46 | 0.09 | 0.84 | 1.92 | 3.91 | 4.00 | 4.02 | 0 | n/a | 88 | 1 | 1812 | endFrame 1 | 0 |
| combatScreen | 60 | 16.65 | 17.08 | 17.29 | 0.19 | 1.58 | 2.57 | 4.55 | 4.62 | 4.64 | 0 | n/a | 171 | 1 | 1916 | endFrame 1 | 0 |
| battleResultScreen | 60 | 16.63 | 16.98 | 17.01 | 0.03 | 0.21 | 0.18 | 3.11 | 3.15 | 3.16 | 0 | n/a | 6 | 1 | 22 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-frame-gpu.json at 987494b)

Section maxima and p99 move with whatever else the machine is doing, and two unthrottled captures of the same build can differ by tens of percent on a light scene. A section or max delta here is unconfirmed until a second capture agrees; FPS on a heavy scene and paced GPU medians are stable to a few percent.

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 18.62 -> 18.11 (-3%) | 0.05 -> 0.06 (+20%) | 0.25 -> 0.51 (+108%) | 0.19 -> 0.70 (+259%) | 5.44 -> 2.93 (-46%) | 5.46 -> 2.98 (-45%) | 1 | 78 -> 70 (-10%) | endFrame 1 |
| mainMenuScreen | 60 | 18.52 -> 17.08 (-8%) | 0.08 -> 0.03 (-62%) | 0.31 -> 0.26 (-15%) | 0.26 -> 0.30 (+13%) | 5.47 -> 2.95 (-46%) | 5.49 -> 3.00 (-45%) | 1 | 150 -> 142 (-5%) | endFrame 1 |
| developerScreen | 60 | 18.11 -> 17.09 (-6%) | 0.18 -> 0.17 (-3%) | 1.23 -> 0.86 (-30%) | 0.13 -> 0.93 (+644%) | 8.97 -> 4.63 (-48%) | 9.03 -> 4.68 (-48%) | 2 -> 1 (-50%) | 388 -> 370 (-5%) | barrier 2 -> endFrame 1 |
| cardShowcaseScreen | 60 | 18.49 -> 17.05 (-8%) | 0.25 -> 0.50 (+102%) | 5.10 -> 3.39 (-34%) | 0.04 -> 4.79 (+11875%) | 9.65 -> 5.99 (-38%) | 9.69 -> 6.09 (-37%) | 2 -> 1 (-50%) | 6438 -> 5790 (-10%) | barrier 2 -> endFrame 1 |
| driverSelectionScreen | 60 | 18.66 -> 17.20 (-8%) | 0.08 -> 0.09 (+19%) | 7.03 -> 0.84 (-88%) | 2.47 -> 1.92 (-22%) | 6.36 -> 3.91 (-38%) | 6.40 -> 4.00 (-37%) | 1 | 2040 -> 1812 (-11%) | endFrame 1 |
| combatScreen | 33 -> 60 (+81%) | 33.59 -> 17.08 (-49%) | 0.17 -> 0.19 (+11%) | 2.38 -> 1.58 (-34%) | 0.29 -> 2.57 (+788%) | 16.17 -> 4.55 (-72%) | 16.29 -> 4.62 (-72%) | 6 -> 1 (-83%) | 2118 -> 1916 (-10%) | barrier 5, endFrame 1 -> endFrame 1 |
| battleResultScreen | 61 -> 60 (-1%) | 18.45 -> 16.98 (-8%) | 0.08 -> 0.03 (-62%) | 0.32 -> 0.21 (-34%) | 0.17 -> 0.18 (+9%) | 5.54 -> 3.11 (-44%) | 5.59 -> 3.15 (-44%) | 1 | 22 | endFrame 1 |
