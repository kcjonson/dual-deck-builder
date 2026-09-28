# phase7-gallery-gpu

Captured 2026-09-28 from http://localhost:9092/gallery.html at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal every timed pass carries a floor: a query around a single clear read 1.39 ms, the same as around twenty clears, on a Radeon Pro 560X at 1440x882 with 4x MSAA. GPU time here includes that floor once per pass, so it overstates the work and compares only between runs with the same pass count on the same device.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 60 | 16.70 | 17.33 | 17.45 | 0.03 | 0.32 | 0.30 | 5.22 | 5.28 | 5.29 | 0 | n/a | 11 | 1 | 162 | endFrame 1 |
| style-guide | 60 | 16.67 | 16.85 | 16.87 | 0.01 | 0.18 | 0.22 | 5.18 | 5.24 | 5.27 | 0 | n/a | 19 | 1 | 166 | endFrame 1 |
| input-showcase | 61 | 16.51 | 18.52 | 18.77 | 0.03 | 0.23 | 0.36 | 5.26 | 5.31 | 5.32 | 0 | n/a | 15 | 1 | 322 | endFrame 1 |
| rectangles | 61 | 16.31 | 18.70 | 18.74 | 0.01 | 0.16 | 0.15 | 5.04 | 5.08 | 5.11 | 0 | n/a | 7 | 1 | 48 | endFrame 1 |
| buttons | 60 | 16.55 | 18.68 | 18.84 | 0.02 | 0.18 | 0.26 | 5.10 | 5.15 | 5.15 | 0 | n/a | 19 | 1 | 202 | endFrame 1 |
| text | 60 | 16.73 | 18.69 | 18.71 | 0.02 | 0.19 | 0.92 | 5.77 | 5.85 | 5.85 | 0 | n/a | 31 | 1 | 1700 | endFrame 1 |
| primitive-shapes | 59 | 16.85 | 18.70 | 18.71 | 0.02 | 0.22 | 0.31 | 5.32 | 5.40 | 5.41 | 0 | n/a | 21 | 17 | 204 | endFrame 1 |
| nested-panels | 60 | 16.62 | 18.53 | 18.67 | 0.06 | 0.22 | 0.18 | 5.21 | 5.29 | 5.30 | 0 | n/a | 7 | 1 | 102 | endFrame 1 |
