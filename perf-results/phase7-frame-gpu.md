# phase7-frame-gpu

Captured 2026-09-28 from http://localhost:9092/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal every timed pass carries a floor: a query around a single clear read 1.39 ms, the same as around twenty clears, on a Radeon Pro 560X at 1440x882 with 4x MSAA. GPU time here includes that floor once per pass, so it overstates the work and compares only between runs with the same pass count on the same device.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 60 | 16.71 | 18.62 | 18.64 | 0.05 | 0.25 | 0.19 | 5.44 | 5.46 | 5.46 | 0 | n/a | 4 | 1 | 78 | endFrame 1 |
| mainMenuScreen | 60 | 16.66 | 18.52 | 18.71 | 0.08 | 0.31 | 0.26 | 5.47 | 5.49 | 5.49 | 0 | n/a | 12 | 1 | 150 | endFrame 1 |
| developerScreen | 60 | 16.62 | 18.11 | 18.37 | 0.18 | 1.23 | 0.13 | 8.97 | 9.03 | 9.04 | 0 | n/a | 37 | 2 | 388 | barrier 2 |
| cardShowcaseScreen | 60 | 16.69 | 18.49 | 18.60 | 0.25 | 5.10 | 0.04 | 9.65 | 9.69 | 9.70 | 0 | n/a | 288 | 2 | 6438 | barrier 2 |
| driverSelectionScreen | 60 | 16.64 | 18.66 | 18.69 | 0.08 | 7.03 | 2.47 | 6.36 | 6.40 | 6.40 | 0 | n/a | 88 | 1 | 2040 | endFrame 1 |
| combatScreen | 33 | 30.16 | 33.59 | 35.01 | 0.17 | 2.38 | 0.29 | 16.17 | 16.29 | 16.30 | 0 | n/a | 173 | 6 | 2118 | barrier 5, endFrame 1 |
| battleResultScreen | 61 | 16.43 | 18.45 | 18.53 | 0.08 | 0.32 | 0.17 | 5.54 | 5.59 | 5.59 | 0 | n/a | 6 | 1 | 22 | endFrame 1 |
