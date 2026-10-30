# ddb-191-ab-branch-2-gpu

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 26.7, 34.6, 34.9 at the start, 20.5, 32.7, 34.2 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 60 | 16.73 | 18.47 | 18.67 | 0.01 | 0.20 | 0.17 | 2.79 | 2.81 | 2.82 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.67 | 18.35 | 18.45 | 0.03 | 2.67 | 2.54 | 4.53 | 4.57 | 4.59 | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 60 | 16.65 | 18.19 | 18.23 | 0.02 | 1.79 | 1.36 | 5.48 | 5.60 | 5.61 | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 60 | 16.71 | 18.09 | 18.10 | 0.02 | 0.41 | 0.68 | 3.67 | 3.73 | 3.73 | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 60 | 16.66 | 18.61 | 18.63 | 0.05 | 0.93 | 0.84 | 4.30 | 4.38 | 4.38 | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
