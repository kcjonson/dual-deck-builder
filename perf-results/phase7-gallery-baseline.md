# phase7-gallery-baseline

Captured 2026-09-28 from http://localhost:9092/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 196 | 5.11 | 13.97 | 14.03 | 0.03 | 13.18 | 6.72 | n/a | n/a | n/a | 0 | n/a | 11 | 1 | 162 | endFrame 1 |
| style-guide | 288 | 3.47 | 13.26 | 13.66 | 0.04 | 0.28 | 13.06 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 166 | endFrame 1 |
| input-showcase | 58 | 17.26 | 30.29 | 30.50 | 0.04 | 15.79 | 30.02 | n/a | n/a | n/a | 0 | n/a | 15 | 1 | 322 | endFrame 1 |
| rectangles | 2030 | 0.49 | 16.10 | 16.61 | 0.03 | 6.23 | 16.25 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 48 | endFrame 1 |
| buttons | 110 | 9.10 | 42.75 | 46.43 | 0.06 | 0.49 | 45.77 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 202 | endFrame 1 |
| text | 199 | 5.02 | 59.92 | 81.07 | 0.03 | 9.83 | 80.51 | n/a | n/a | n/a | 0 | n/a | 31 | 1 | 1700 | endFrame 1 |
| primitive-shapes | 212 | 4.72 | 10.06 | 10.22 | 0.02 | 9.71 | 9.68 | n/a | n/a | n/a | 0 | n/a | 21 | 17 | 204 | endFrame 1 |
| nested-panels | 2899 | 0.34 | 9.68 | 9.70 | 0.02 | 0.08 | 9.41 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 102 | endFrame 1 |
