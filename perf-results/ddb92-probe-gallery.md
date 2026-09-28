# ddb92-probe-gallery

Captured 2026-09-28 from http://localhost:9092/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 120 settle frames and 60 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). GPU columns are timer-query GPU time (R13.16); n/a where the extension is absent.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 2094 | 0.48 | 1.41 | 1.53 | 0.03 | 0.32 | 0.41 | 3.10 | 5.51 | 5.51 | 11 | 1 | 162 | endFrame 1 |
| style-guide | 2083 | 0.48 | 1.40 | 8.98 | 0.02 | 0.19 | 0.72 | 3.10 | 5.51 | 5.51 | 19 | 1 | 166 | endFrame 1 |
| input-showcase | 2151 | 0.47 | 1.25 | 1.28 | 0.05 | 0.25 | 0.39 | 3.11 | 5.51 | 5.51 | 15 | 1 | 322 | endFrame 1 |
| rectangles | 3030 | 0.33 | 0.99 | 1.16 | 0.02 | 0.17 | 0.14 | n/a | 5.51 | 5.51 | 7 | 1 | 48 | endFrame 1 |
| buttons | 1905 | 0.53 | 10.81 | 2088.20 | 0.03 | 0.31 | 2086.07 | n/a | 5.51 | 5.51 | 19 | 1 | 202 | endFrame 1 |
| text | 181 | 5.52 | 11.74 | 12.20 | 0.02 | 10.45 | 11.61 | 3.46 | 5.51 | 5.51 | 31 | 1 | 1700 | endFrame 1 |
| primitive-shapes | 2667 | 0.38 | 8.89 | 8.98 | 0.02 | 0.31 | 8.58 | 3.45 | 5.51 | 5.51 | 21 | 17 | 204 | endFrame 1 |
| nested-panels | 3670 | 0.27 | 1.13 | 6.72 | 0.01 | 0.08 | 6.40 | 3.47 | 5.51 | 5.51 | 7 | 1 | 102 | endFrame 1 |
