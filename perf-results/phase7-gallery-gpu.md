# phase7-gallery-gpu

Captured 2026-09-28 from http://localhost:9092/gallery.html at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times its CPU frame is excluded and counted under GPU invalid (R13.18), and n/a with no invalid count means the extension is absent.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 61 | 16.50 | 18.11 | 18.26 | 0.03 | 0.28 | 0.29 | 5.21 | 5.31 | 5.34 | 0 | 11 | 1 | 162 | endFrame 1 |
| style-guide | 60 | 16.67 | 18.64 | 18.67 | 0.02 | 0.44 | 0.43 | 5.17 | 5.24 | 5.27 | 0 | 19 | 1 | 166 | endFrame 1 |
| input-showcase | 60 | 16.57 | 18.57 | 18.70 | 0.04 | 0.47 | 0.42 | 5.25 | 5.33 | 5.36 | 0 | 15 | 1 | 322 | endFrame 1 |
| rectangles | 60 | 16.75 | 18.41 | 18.69 | 0.03 | 0.24 | 0.16 | 5.03 | 5.12 | 5.15 | 0 | 7 | 1 | 48 | endFrame 1 |
| buttons | 61 | 16.42 | 18.44 | 18.79 | 0.02 | 0.19 | 0.29 | 5.10 | 5.17 | 5.19 | 0 | 19 | 1 | 202 | endFrame 1 |
| text | 59 | 16.86 | 18.53 | 18.66 | 0.03 | 0.18 | 1.19 | 5.78 | 5.86 | 5.87 | 0 | 31 | 1 | 1700 | endFrame 1 |
| primitive-shapes | 61 | 16.37 | 18.56 | 18.79 | 0.02 | 0.23 | 0.43 | 5.33 | 5.42 | 5.43 | 0 | 21 | 17 | 204 | endFrame 1 |
| nested-panels | 60 | 16.66 | 18.39 | 18.69 | 0.03 | 0.16 | 0.19 | 5.23 | 5.32 | 5.34 | 0 | 7 | 1 | 102 | endFrame 1 |
