# ddb-191-ab-main-2-gpu

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 49.1, 39.2, 36.4 at the start, 39.0, 37.4, 35.9 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 60 | 16.69 | 18.59 | 18.64 | 0.02 | 0.19 | 0.22 | 2.94 | 4.54 | 4.55 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.61 | 18.64 | 18.80 | 0.03 | 1.58 | 0.48 | 4.65 | 6.30 | 6.68 | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 61 | 16.45 | 18.39 | 18.60 | 0.01 | 1.36 | 1.72 | 5.81 | 7.76 | 7.81 | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 60 | 16.57 | 18.21 | 18.45 | 0.02 | 0.43 | 0.86 | 3.92 | 5.74 | 5.82 | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 60 | 16.77 | 18.25 | 18.72 | 0.02 | 0.61 | 0.75 | 4.55 | 6.51 | 6.59 | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
