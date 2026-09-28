# phase7-gallery-baseline

Captured 2026-09-28 from http://localhost:9092/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times its CPU frame is excluded and counted under GPU invalid (R13.18), and n/a with no invalid count means the extension is absent.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 398 | 2.52 | 11.12 | 11.19 | 0.02 | 10.71 | 0.27 | n/a | n/a | n/a | 16 | 11 | 1 | 162 | endFrame 1 |
| style-guide | 203 | 4.94 | 11.53 | 11.76 | 0.02 | 0.23 | 11.05 | n/a | n/a | n/a | 0 | 19 | 1 | 166 | endFrame 1 |
| input-showcase | 100 | 9.97 | 15.80 | 16.45 | 0.04 | 4.71 | 15.95 | n/a | n/a | n/a | 0 | 15 | 1 | 322 | endFrame 1 |
| rectangles | 194 | 5.15 | 10.47 | 10.62 | 0.04 | 4.81 | 7.04 | n/a | n/a | n/a | 0 | 7 | 1 | 48 | endFrame 1 |
| buttons | 48 | 20.88 | 32.21 | 59.57 | 0.03 | 0.28 | 31.75 | n/a | n/a | n/a | 0 | 19 | 1 | 202 | endFrame 1 |
| text | 177 | 5.64 | 45.83 | 68.41 | 0.03 | 10.97 | 67.70 | 3.48 | 3.49 | 3.49 | 2 | 31 | 1 | 1700 | endFrame 1 |
| primitive-shapes | 203 | 4.92 | 12.03 | 12.50 | 0.02 | 0.20 | 11.82 | n/a | n/a | n/a | 8 | 21 | 17 | 204 | endFrame 1 |
| nested-panels | 2116 | 0.47 | 11.25 | 11.30 | 0.02 | 0.24 | 10.85 | n/a | n/a | n/a | 0 | 7 | 1 | 102 | endFrame 1 |
