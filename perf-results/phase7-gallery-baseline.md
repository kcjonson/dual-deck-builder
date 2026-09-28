# phase7-gallery-baseline

Captured 2026-09-28 from http://localhost:9193/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 503 | 1.99 | 5.17 | 5.24 | 0.02 | 4.65 | 0.25 | n/a | n/a | n/a | 0 | n/a | 11 | 1 | 154 | endFrame 1 | 0 |
| style-guide | 1923 | 0.52 | 2.22 | 2.34 | 0.01 | 1.91 | 0.16 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 162 | endFrame 1 | 0 |
| input-showcase | 1509 | 0.66 | 2.40 | 3.07 | 0.01 | 1.97 | 0.24 | n/a | n/a | n/a | 0 | n/a | 15 | 1 | 290 | endFrame 1 | 0 |
| rectangles | 1384 | 0.72 | 1.79 | 1.84 | 0.01 | 0.06 | 1.58 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 46 | endFrame 1 | 0 |
| buttons | 1102 | 0.91 | 4.77 | 4.77 | 0.01 | 0.20 | 4.57 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 194 | endFrame 1 | 0 |
| text | 983 | 1.02 | 3.03 | 3.08 | 0.13 | 2.08 | 0.88 | n/a | n/a | n/a | 0 | n/a | 31 | 1 | 1464 | endFrame 1 | 0 |
| primitive-shapes | 1544 | 0.65 | 2.12 | 5.87 | 0.01 | 1.86 | 0.19 | n/a | n/a | n/a | 0 | n/a | 21 | 1 | 242 | endFrame 1 | 0 |
| nested-panels | 1220 | 0.82 | 2.46 | 2.53 | 0.01 | 1.78 | 0.31 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 94 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-gallery-baseline.json at 987494b)

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 196 -> 503 (+157%) | 13.97 -> 5.17 (-63%) | 0.03 -> 0.02 (-50%) | 13.18 -> 4.65 (-65%) | 6.72 -> 0.25 (-96%) | n/a | n/a | 1 | 162 -> 154 (-5%) | endFrame 1 |
| style-guide | 288 -> 1923 (+567%) | 13.26 -> 2.22 (-83%) | 0.04 -> 0.01 (-75%) | 0.28 -> 1.91 (+593%) | 13.06 -> 0.16 (-99%) | n/a | n/a | 1 | 166 -> 162 (-2%) | endFrame 1 |
| input-showcase | 58 -> 1509 (+2505%) | 30.29 -> 2.40 (-92%) | 0.04 -> 0.01 (-75%) | 15.79 -> 1.97 (-87%) | 30.02 -> 0.24 (-99%) | n/a | n/a | 1 | 322 -> 290 (-10%) | endFrame 1 |
| rectangles | 210 -> 1384 (+561%) | 9.26 -> 1.79 (-81%) | 0.03 -> 0.01 (-86%) | 4.57 -> 0.06 (-99%) | 4.76 -> 1.58 (-67%) | n/a | n/a | 1 | 48 -> 46 (-4%) | endFrame 1 |
| buttons | 110 -> 1102 (+903%) | 42.75 -> 4.77 (-89%) | 0.06 -> 0.01 (-83%) | 0.49 -> 0.20 (-59%) | 45.77 -> 4.57 (-90%) | n/a | n/a | 1 | 202 -> 194 (-4%) | endFrame 1 |
| text | 199 -> 983 (+394%) | 59.92 -> 3.03 (-95%) | 0.03 -> 0.13 (+317%) | 9.83 -> 2.08 (-79%) | 80.51 -> 0.88 (-99%) | n/a | n/a | 1 | 1700 -> 1464 (-14%) | endFrame 1 |
| primitive-shapes | 212 -> 1544 (+629%) | 10.06 -> 2.12 (-79%) | 0.02 -> 0.01 (-50%) | 9.71 -> 1.86 (-81%) | 9.68 -> 0.19 (-98%) | n/a | n/a | 17 -> 1 (-94%) | 204 -> 242 (+19%) | endFrame 1 |
| nested-panels | 209 -> 1220 (+482%) | 9.35 -> 2.46 (-74%) | 0.02 -> 0.01 (-33%) | 4.55 -> 1.78 (-61%) | 4.79 -> 0.31 (-94%) | n/a | n/a | 1 | 102 -> 94 (-8%) | endFrame 1 |
