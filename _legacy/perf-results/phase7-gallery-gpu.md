# phase7-gallery-gpu

Captured 2026-09-28 from http://localhost:9193/gallery.html at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 5.2, 11.0, 16.2 at the start, 4.5, 10.4, 15.9 at the end.

GPU timer: on. GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times the larger of its CPU frame and the median frame is excluded and counted under GPU invalid (R13.18). Fence latency is the fallback where the timer query extension is absent: submission to observed completion, an upper bound, never GPU time (R13.19).

On ANGLE Metal the first timed pass of each frame carries the drawing buffer's clear and store whatever the pass draws: 1.26 ms paced on a Radeon Pro 560X at 1440x882 with antialias off, 0.04 ms at 128x128. It is paid once per frame and is work the frame does untimed too; later passes carry only their own draws. The per-pass floor measured before DDB-64 was the 4x MSAA resolve, which a query boundary made every pass pay. Paced GPU times are read at the clock a 60 FPS load leaves the GPU at: the same passes read about 2.7 times shorter unthrottled (DDB-193).

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 60 | 16.56 | 18.72 | 18.80 | 0.02 | 0.25 | 0.38 | 2.02 | 2.13 | 2.13 | 0 | n/a | 11 | 1 | 154 | endFrame 1 | 0 |
| style-guide | 60 | 16.58 | 18.70 | 18.75 | 0.05 | 0.25 | 0.40 | 2.00 | 2.13 | 2.14 | 0 | n/a | 19 | 1 | 162 | endFrame 1 | 0 |
| input-showcase | 60 | 16.71 | 18.78 | 18.81 | 0.02 | 0.36 | 0.40 | 2.08 | 2.19 | 2.22 | 0 | n/a | 15 | 1 | 290 | endFrame 1 | 0 |
| rectangles | 60 | 16.71 | 18.58 | 18.72 | 0.01 | 0.17 | 0.17 | 1.82 | 1.91 | 1.97 | 0 | n/a | 7 | 1 | 46 | endFrame 1 | 0 |
| buttons | 60 | 16.56 | 18.63 | 18.80 | 0.03 | 0.19 | 0.53 | 1.91 | 1.99 | 2.03 | 0 | n/a | 19 | 1 | 194 | endFrame 1 | 0 |
| text | 59 | 16.98 | 18.77 | 18.88 | 0.02 | 0.20 | 1.12 | 2.55 | 2.68 | 2.68 | 0 | n/a | 31 | 1 | 1464 | endFrame 1 | 0 |
| primitive-shapes | 59 | 16.90 | 18.59 | 18.88 | 0.02 | 0.33 | 0.40 | 2.15 | 2.31 | 2.32 | 0 | n/a | 21 | 1 | 242 | endFrame 1 | 0 |
| nested-panels | 61 | 16.32 | 18.76 | 18.81 | 0.02 | 0.19 | 0.25 | 2.05 | 2.13 | 2.15 | 0 | n/a | 7 | 1 | 94 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-gallery-gpu.json at 987494b)

Section maxima and p99 move with whatever else the machine is doing, and two unthrottled captures of the same build can differ by tens of percent on a light scene. A section or max delta here is unconfirmed until a second capture agrees; FPS on a heavy scene and paced GPU medians are stable to a few percent.

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 60 | 17.33 -> 18.72 (+8%) | 0.03 -> 0.02 (-40%) | 0.32 -> 0.25 (-20%) | 0.30 -> 0.38 (+29%) | 5.22 -> 2.02 (-61%) | 5.28 -> 2.13 (-60%) | 1 | 162 -> 154 (-5%) | endFrame 1 |
| style-guide | 60 | 16.85 -> 18.70 (+11%) | 0.01 -> 0.05 (+233%) | 0.18 -> 0.25 (+42%) | 0.22 -> 0.40 (+86%) | 5.18 -> 2.00 (-61%) | 5.24 -> 2.13 (-59%) | 1 | 166 -> 162 (-2%) | endFrame 1 |
| input-showcase | 61 -> 60 (-1%) | 18.52 -> 18.78 (+1%) | 0.03 -> 0.02 (-43%) | 0.23 -> 0.36 (+59%) | 0.36 -> 0.40 (+13%) | 5.26 -> 2.08 (-60%) | 5.31 -> 2.19 (-59%) | 1 | 322 -> 290 (-10%) | endFrame 1 |
| rectangles | 61 -> 60 (-2%) | 18.70 -> 18.58 (-1%) | 0.01 | 0.16 -> 0.17 (+6%) | 0.15 -> 0.17 (+17%) | 5.04 -> 1.82 (-64%) | 5.08 -> 1.91 (-62%) | 1 | 48 -> 46 (-4%) | endFrame 1 |
| buttons | 60 | 18.68 -> 18.63 (0%) | 0.02 -> 0.03 (+25%) | 0.18 -> 0.19 (+11%) | 0.26 -> 0.53 (+102%) | 5.10 -> 1.91 (-63%) | 5.15 -> 1.99 (-61%) | 1 | 202 -> 194 (-4%) | endFrame 1 |
| text | 60 -> 59 (-2%) | 18.69 -> 18.77 (+0%) | 0.02 | 0.19 -> 0.20 (+5%) | 0.92 -> 1.12 (+21%) | 5.77 -> 2.55 (-56%) | 5.85 -> 2.68 (-54%) | 1 | 1700 -> 1464 (-14%) | endFrame 1 |
| primitive-shapes | 59 | 18.70 -> 18.59 (-1%) | 0.02 | 0.22 -> 0.33 (+53%) | 0.31 -> 0.40 (+27%) | 5.32 -> 2.15 (-60%) | 5.40 -> 2.31 (-57%) | 17 -> 1 (-94%) | 204 -> 242 (+19%) | endFrame 1 |
| nested-panels | 60 -> 61 (+2%) | 18.53 -> 18.76 (+1%) | 0.06 -> 0.02 (-69%) | 0.22 -> 0.19 (-18%) | 0.18 -> 0.25 (+46%) | 5.21 -> 2.05 (-61%) | 5.29 -> 2.13 (-60%) | 1 | 102 -> 94 (-8%) | endFrame 1 |
