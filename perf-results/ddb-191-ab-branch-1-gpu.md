# ddb-191-ab-branch-1-gpu

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 31.1, 32.1, 33.8 at the start, 25.6, 30.8, 33.3 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 60 | 16.79 | 18.54 | 18.55 | 0.02 | 0.17 | 0.23 | 2.78 | 2.82 | 2.84 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.58 | 18.59 | 18.67 | 0.01 | 1.03 | 0.24 | 4.54 | 4.61 | 4.63 | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| cardShowcaseScreen | 60 | 16.69 | 18.66 | 18.68 | 0.02 | 1.02 | 1.07 | 5.57 | 5.61 | 5.61 | 0 | n/a | 198 | 1 | 3976 | endFrame 1 | 0 |
| driverSelectionScreen | 60 | 16.66 | 18.62 | 18.69 | 0.02 | 0.30 | 0.52 | 3.71 | 3.80 | 3.80 | 0 | n/a | 83 | 1 | 1814 | endFrame 1 | 0 |
| combatScreen | 60 | 16.77 | 18.61 | 18.62 | 0.03 | 0.88 | 0.77 | 4.33 | 4.40 | 4.41 | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
