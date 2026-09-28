# phase7-gallery-baseline

Captured 2026-09-28 from http://localhost:9193/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 868 | 1.15 | 4.88 | 4.98 | 0.01 | 4.52 | 0.17 | n/a | n/a | n/a | 0 | n/a | 11 | 1 | 162 | endFrame 1 | 0 |
| style-guide | 1544 | 0.65 | 2.00 | 6.04 | 0.01 | 1.58 | 0.34 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 166 | endFrame 1 | 0 |
| input-showcase | 1660 | 0.60 | 2.20 | 2.44 | 0.01 | 1.84 | 0.18 | n/a | n/a | n/a | 0 | n/a | 15 | 1 | 322 | endFrame 1 | 0 |
| rectangles | 1481 | 0.67 | 2.03 | 2.33 | 0.01 | 1.65 | 0.10 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 48 | endFrame 1 | 0 |
| buttons | 1434 | 0.70 | 4.62 | 5.30 | 0.03 | 0.07 | 4.98 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 202 | endFrame 1 | 0 |
| text | 985 | 1.02 | 2.81 | 2.91 | 0.02 | 1.81 | 0.67 | n/a | n/a | n/a | 0 | n/a | 31 | 1 | 1700 | endFrame 1 | 0 |
| primitive-shapes | 1299 | 0.77 | 2.01 | 2.08 | 0.01 | 1.70 | 0.15 | n/a | n/a | n/a | 0 | n/a | 21 | 1 | 244 | endFrame 1 | 0 |
| nested-panels | 1246 | 0.80 | 1.98 | 2.01 | 0.01 | 1.69 | 0.10 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 102 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-gallery-baseline.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 196 -> 868 (+344%) | 13.97 -> 4.88 (-65%) | 0.03 -> 0.01 (-50%) | 13.18 -> 4.52 (-66%) | 6.72 -> 0.17 (-97%) | n/a | n/a | 1 | 162 | endFrame 1 |
| style-guide | 288 -> 1544 (+436%) | 13.26 -> 2.00 (-85%) | 0.04 -> 0.01 (-75%) | 0.28 -> 1.58 (+475%) | 13.06 -> 0.34 (-97%) | n/a | n/a | 1 | 166 | endFrame 1 |
| input-showcase | 58 -> 1660 (+2764%) | 30.29 -> 2.20 (-93%) | 0.04 -> 0.01 (-75%) | 15.79 -> 1.84 (-88%) | 30.02 -> 0.18 (-99%) | n/a | n/a | 1 | 322 | endFrame 1 |
| rectangles | 210 -> 1481 (+607%) | 9.26 -> 2.03 (-78%) | 0.03 -> 0.01 (-71%) | 4.57 -> 1.65 (-64%) | 4.76 -> 0.10 (-98%) | n/a | n/a | 1 | 48 | endFrame 1 |
| buttons | 110 -> 1434 (+1205%) | 42.75 -> 4.62 (-89%) | 0.06 -> 0.03 (-42%) | 0.49 -> 0.07 (-86%) | 45.77 -> 4.98 (-89%) | n/a | n/a | 1 | 202 | endFrame 1 |
| text | 199 -> 985 (+395%) | 59.92 -> 2.81 (-95%) | 0.03 -> 0.02 (-50%) | 9.83 -> 1.81 (-82%) | 80.51 -> 0.67 (-99%) | n/a | n/a | 1 | 1700 | endFrame 1 |
| primitive-shapes | 212 -> 1299 (+513%) | 10.06 -> 2.01 (-80%) | 0.02 -> 0.01 (-75%) | 9.71 -> 1.70 (-83%) | 9.68 -> 0.15 (-98%) | n/a | n/a | 17 -> 1 (-94%) | 204 -> 244 (+20%) | endFrame 1 |
| nested-panels | 209 -> 1246 (+495%) | 9.35 -> 1.98 (-79%) | 0.02 -> 0.01 (-33%) | 4.55 -> 1.69 (-63%) | 4.79 -> 0.10 (-98%) | n/a | n/a | 1 | 102 | endFrame 1 |
