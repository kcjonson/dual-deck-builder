# ddb-191-gpu-branch-3

Captured 2026-09-28 from http://localhost:9391/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 28.7, 36.9, 35.8 at the start, 30.6, 37.0, 35.8 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mainMenuScreen | 60 | 16.57 | 17.73 | 17.92 | 0.04 | 0.19 | 0.21 | 4.02 | 6.48 | 6.49 | 0 | n/a | 12 | 1 | 142 | endFrame 1 | 0 |
| developerScreen | 60 | 16.73 | 18.63 | 18.68 | 0.02 | 1.22 | 0.34 | 5.73 | 9.30 | 10.09 | 0 | n/a | 44 | 1 | 444 | endFrame 1 | 0 |
| combatScreen | 60 | 16.77 | 18.57 | 18.58 | 0.04 | 0.95 | 0.88 | 5.44 | 8.78 | 9.52 | 0 | n/a | 153 | 1 | 1472 | endFrame 1 | 0 |
