# ddb-191-ab-main-1-gpu

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 21.1, 30.6, 33.4 at the start, 18.6, 29.5, 33.0 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 59 | 16.84 | 18.64 | 18.67 | 0.02 | 0.14 | 0.19 | 2.93 | 4.56 | 4.73 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.75 | 18.40 | 18.46 | 0.01 | 1.09 | 0.31 | 4.65 | 6.22 | 6.35 | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 60 | 16.73 | 18.67 | 18.67 | 0.02 | 1.21 | 1.79 | 5.81 | 7.37 | 7.80 | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 60 | 16.58 | 18.47 | 18.50 | 0.03 | 0.80 | 1.46 | 3.92 | 5.59 | 6.64 | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 60 | 16.62 | 18.64 | 25.24 | 0.04 | 1.41 | 1.72 | 4.52 | 6.10 | 7.36 | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
