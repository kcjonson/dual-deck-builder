# phase7-gallery-gpu

Captured 2026-09-28 from http://localhost:9193/gallery.html at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 59 | 16.97 | 18.35 | 18.74 | 0.03 | 0.35 | 0.55 | 2.00 | 2.09 | 2.13 | 0 | n/a | 11 | 1 | 154 | endFrame 1 | 0 |
| style-guide | 60 | 16.80 | 18.72 | 18.78 | 0.03 | 0.38 | 0.45 | 2.01 | 2.05 | 2.07 | 0 | n/a | 19 | 1 | 162 | endFrame 1 | 0 |
| input-showcase | 59 | 16.86 | 18.50 | 19.03 | 0.03 | 0.37 | 0.53 | 2.07 | 2.14 | 2.15 | 0 | n/a | 15 | 1 | 290 | endFrame 1 | 0 |
| rectangles | 60 | 16.65 | 18.63 | 18.76 | 0.02 | 0.25 | 0.27 | 1.81 | 1.90 | 1.91 | 0 | n/a | 7 | 1 | 46 | endFrame 1 | 0 |
| buttons | 60 | 16.60 | 18.72 | 18.73 | 0.02 | 0.25 | 0.45 | 1.90 | 1.98 | 1.99 | 0 | n/a | 19 | 1 | 194 | endFrame 1 | 0 |
| text | 60 | 16.62 | 18.64 | 18.70 | 0.05 | 0.41 | 1.60 | 2.51 | 2.57 | 2.58 | 0 | n/a | 31 | 1 | 1464 | endFrame 1 | 0 |
| primitive-shapes | 60 | 16.73 | 18.80 | 18.82 | 0.03 | 0.34 | 0.44 | 2.13 | 2.19 | 2.20 | 0 | n/a | 21 | 1 | 242 | endFrame 1 | 0 |
| nested-panels | 60 | 16.66 | 18.50 | 18.54 | 0.02 | 0.21 | 0.28 | 2.04 | 2.10 | 2.10 | 0 | n/a | 7 | 1 | 94 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-gallery-gpu.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 60 -> 59 (-2%) | 17.33 -> 18.35 (+6%) | 0.03 | 0.32 -> 0.35 (+11%) | 0.30 -> 0.55 (+86%) | 5.22 -> 2.00 (-62%) | 5.28 -> 2.09 (-60%) | 1 | 162 -> 154 (-5%) | endFrame 1 |
| style-guide | 60 | 16.85 -> 18.72 (+11%) | 0.01 -> 0.03 (+133%) | 0.18 -> 0.38 (+114%) | 0.22 -> 0.45 (+109%) | 5.18 -> 2.01 (-61%) | 5.24 -> 2.05 (-61%) | 1 | 166 -> 162 (-2%) | endFrame 1 |
| input-showcase | 61 -> 59 (-2%) | 18.52 -> 18.50 (0%) | 0.03 | 0.23 -> 0.37 (+61%) | 0.36 -> 0.53 (+49%) | 5.26 -> 2.07 (-61%) | 5.31 -> 2.14 (-60%) | 1 | 322 -> 290 (-10%) | endFrame 1 |
| rectangles | 61 -> 60 (-2%) | 18.70 -> 18.63 (0%) | 0.01 -> 0.02 (+50%) | 0.16 -> 0.25 (+53%) | 0.15 -> 0.27 (+80%) | 5.04 -> 1.81 (-64%) | 5.08 -> 1.90 (-63%) | 1 | 48 -> 46 (-4%) | endFrame 1 |
| buttons | 60 | 18.68 -> 18.72 (+0%) | 0.02 | 0.18 -> 0.25 (+46%) | 0.26 -> 0.45 (+73%) | 5.10 -> 1.90 (-63%) | 5.15 -> 1.98 (-61%) | 1 | 202 -> 194 (-4%) | endFrame 1 |
| text | 60 | 18.69 -> 18.64 (0%) | 0.02 -> 0.05 (+200%) | 0.19 -> 0.41 (+118%) | 0.92 -> 1.60 (+73%) | 5.77 -> 2.51 (-57%) | 5.85 -> 2.57 (-56%) | 1 | 1700 -> 1464 (-14%) | endFrame 1 |
| primitive-shapes | 59 -> 60 (+1%) | 18.70 -> 18.80 (+1%) | 0.02 -> 0.03 (+0%) | 0.22 -> 0.34 (+58%) | 0.31 -> 0.44 (+38%) | 5.32 -> 2.13 (-60%) | 5.40 -> 2.19 (-59%) | 17 -> 1 (-94%) | 204 -> 242 (+19%) | endFrame 1 |
| nested-panels | 60 | 18.53 -> 18.50 (0%) | 0.06 -> 0.02 (-77%) | 0.22 -> 0.21 (-7%) | 0.18 -> 0.28 (+57%) | 5.21 -> 2.04 (-61%) | 5.29 -> 2.10 (-60%) | 1 | 102 -> 94 (-8%) | endFrame 1 |
