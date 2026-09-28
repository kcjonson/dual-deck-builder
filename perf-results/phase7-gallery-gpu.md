# phase7-gallery-gpu

Captured 2026-09-28 from http://localhost:9193/gallery.html at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 60 | 16.79 | 18.75 | 18.81 | 0.03 | 0.20 | 0.31 | 2.04 | 2.08 | 2.09 | 0 | n/a | 11 | 1 | 162 | endFrame 1 | 0 |
| style-guide | 60 | 16.64 | 18.69 | 18.69 | 0.02 | 0.20 | 0.25 | 2.00 | 2.06 | 2.08 | 0 | n/a | 19 | 1 | 166 | endFrame 1 | 0 |
| input-showcase | 60 | 16.70 | 18.53 | 18.66 | 0.05 | 0.33 | 0.38 | 2.05 | 2.13 | 2.15 | 0 | n/a | 15 | 1 | 322 | endFrame 1 | 0 |
| rectangles | 60 | 16.65 | 18.87 | 18.89 | 0.01 | 0.19 | 0.18 | 1.81 | 1.89 | 1.89 | 0 | n/a | 7 | 1 | 48 | endFrame 1 | 0 |
| buttons | 60 | 16.72 | 18.71 | 18.86 | 0.02 | 0.19 | 0.28 | 1.92 | 1.99 | 1.99 | 0 | n/a | 19 | 1 | 202 | endFrame 1 | 0 |
| text | 60 | 16.72 | 18.73 | 18.78 | 0.02 | 0.22 | 1.19 | 2.52 | 2.60 | 2.61 | 0 | n/a | 31 | 1 | 1700 | endFrame 1 | 0 |
| primitive-shapes | 60 | 16.66 | 18.73 | 18.75 | 0.03 | 0.23 | 0.35 | 2.18 | 2.22 | 2.22 | 0 | n/a | 21 | 1 | 244 | endFrame 1 | 0 |
| nested-panels | 61 | 16.43 | 18.74 | 18.74 | 0.03 | 0.16 | 0.19 | 2.05 | 2.10 | 2.12 | 0 | n/a | 7 | 1 | 102 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-gallery-gpu.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 60 | 17.33 -> 18.75 (+8%) | 0.03 | 0.32 -> 0.20 (-38%) | 0.30 -> 0.31 (+5%) | 5.22 -> 2.04 (-61%) | 5.28 -> 2.08 (-61%) | 1 | 162 | endFrame 1 |
| style-guide | 60 | 16.85 -> 18.69 (+11%) | 0.01 -> 0.02 (+0%) | 0.18 -> 0.20 (+14%) | 0.22 -> 0.25 (+19%) | 5.18 -> 2.00 (-61%) | 5.24 -> 2.06 (-61%) | 1 | 166 | endFrame 1 |
| input-showcase | 61 -> 60 (-1%) | 18.52 -> 18.53 (+0%) | 0.03 -> 0.05 (+43%) | 0.23 -> 0.33 (+43%) | 0.36 -> 0.38 (+8%) | 5.26 -> 2.05 (-61%) | 5.31 -> 2.13 (-60%) | 1 | 322 | endFrame 1 |
| rectangles | 61 -> 60 (-2%) | 18.70 -> 18.87 (+1%) | 0.01 | 0.16 -> 0.19 (+19%) | 0.15 -> 0.18 (+17%) | 5.04 -> 1.81 (-64%) | 5.08 -> 1.89 (-63%) | 1 | 48 | endFrame 1 |
| buttons | 60 | 18.68 -> 18.71 (+0%) | 0.02 | 0.18 -> 0.19 (+6%) | 0.26 -> 0.28 (+8%) | 5.10 -> 1.92 (-62%) | 5.15 -> 1.99 (-61%) | 1 | 202 | endFrame 1 |
| text | 60 | 18.69 -> 18.73 (+0%) | 0.02 | 0.19 -> 0.22 (+16%) | 0.92 -> 1.19 (+29%) | 5.77 -> 2.52 (-56%) | 5.85 -> 2.60 (-55%) | 1 | 1700 | endFrame 1 |
| primitive-shapes | 59 -> 60 (+1%) | 18.70 -> 18.73 (+0%) | 0.02 -> 0.03 (+20%) | 0.22 -> 0.23 (+9%) | 0.31 -> 0.35 (+11%) | 5.32 -> 2.18 (-59%) | 5.40 -> 2.22 (-59%) | 17 -> 1 (-94%) | 204 -> 244 (+20%) | endFrame 1 |
| nested-panels | 60 -> 61 (+1%) | 18.53 -> 18.74 (+1%) | 0.06 -> 0.03 (-54%) | 0.22 -> 0.16 (-29%) | 0.18 -> 0.19 (+9%) | 5.21 -> 2.05 (-61%) | 5.29 -> 2.10 (-60%) | 1 | 102 | endFrame 1 |
