# phase1-gallery-final

Captured 2026-09-28 from http://localhost:9168/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version).

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 1127 | 0.89 | 3.32 | 5.10 | 0.02 | 2.78 | 0.25 | n/a | n/a | n/a | 0 | n/a | 11 | 1 | 154 | endFrame 1 |
| style-guide | 1190 | 0.84 | 2.51 | 5.41 | 0.01 | 1.84 | 1.53 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 162 | endFrame 1 |
| input-showcase | 1515 | 0.66 | 2.57 | 3.16 | 0.02 | 2.38 | 0.32 | n/a | n/a | n/a | 0 | n/a | 15 | 1 | 290 | endFrame 1 |
| rectangles | 1581 | 0.63 | 2.27 | 2.67 | 0.01 | 0.06 | 1.89 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 46 | endFrame 1 |
| buttons | 1216 | 0.82 | 5.45 | 7.62 | 0.03 | 0.09 | 7.28 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 194 | endFrame 1 |
| text | 1176 | 0.85 | 3.64 | 4.05 | 0.03 | 2.71 | 1.51 | n/a | n/a | n/a | 0 | n/a | 31 | 1 | 1464 | endFrame 1 |
| primitive-shapes | 1476 | 0.68 | 2.13 | 2.44 | 0.01 | 1.81 | 0.26 | n/a | n/a | n/a | 0 | n/a | 21 | 1 | 242 | endFrame 1 |
| nested-panels | 1613 | 0.62 | 2.39 | 2.75 | 0.02 | 2.13 | 0.25 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 94 | endFrame 1 |
| paint-order | 530 | 1.89 | 4.87 | 5.16 | 0.02 | 4.11 | 1.23 | n/a | n/a | n/a | 0 | n/a | 125 | 1 | 1272 | endFrame 1 |
| clipping | 1290 | 0.77 | 2.91 | 3.96 | 0.01 | 2.87 | 0.97 | n/a | n/a | n/a | 0 | n/a | 51 | 1 | 939 | endFrame 1 |
| shading | 723 | 1.38 | 4.91 | 5.17 | 0.02 | 3.84 | 1.52 | n/a | n/a | n/a | 0 | n/a | 326 | 5 | 1728 | endFrame 1 |

## Against perf-results/phase7-gallery-baseline.json

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 196 -> 1127 (+476%) | 13.97 -> 3.32 (-76%) | 0.03 -> 0.02 (-33%) | 13.18 -> 2.78 (-79%) | 6.72 -> 0.25 (-96%) | n/a | n/a | 1 | 162 -> 154 (-5%) | endFrame 1 |
| style-guide | 288 -> 1190 (+313%) | 13.26 -> 2.51 (-81%) | 0.04 -> 0.01 (-75%) | 0.28 -> 1.84 (+567%) | 13.06 -> 1.53 (-88%) | n/a | n/a | 1 | 166 -> 162 (-2%) | endFrame 1 |
| input-showcase | 58 -> 1515 (+2514%) | 30.29 -> 2.57 (-92%) | 0.04 -> 0.02 (-62%) | 15.79 -> 2.38 (-85%) | 30.02 -> 0.32 (-99%) | n/a | n/a | 1 | 322 -> 290 (-10%) | endFrame 1 |
| rectangles | 210 -> 1581 (+655%) | 9.26 -> 2.27 (-75%) | 0.03 -> 0.01 (-86%) | 4.57 -> 0.06 (-99%) | 4.76 -> 1.89 (-60%) | n/a | n/a | 1 | 48 -> 46 (-4%) | endFrame 1 |
| buttons | 110 -> 1216 (+1007%) | 42.75 -> 5.45 (-87%) | 0.06 -> 0.03 (-50%) | 0.49 -> 0.09 (-83%) | 45.77 -> 7.28 (-84%) | n/a | n/a | 1 | 202 -> 194 (-4%) | endFrame 1 |
| text | 199 -> 1176 (+491%) | 59.92 -> 3.64 (-94%) | 0.03 | 9.83 -> 2.71 (-72%) | 80.51 -> 1.51 (-98%) | n/a | n/a | 1 | 1700 -> 1464 (-14%) | endFrame 1 |
| primitive-shapes | 212 -> 1476 (+596%) | 10.06 -> 2.13 (-79%) | 0.02 -> 0.01 (-50%) | 9.71 -> 1.81 (-81%) | 9.68 -> 0.26 (-97%) | n/a | n/a | 17 -> 1 (-94%) | 204 -> 242 (+19%) | endFrame 1 |
| nested-panels | 209 -> 1613 (+670%) | 9.35 -> 2.39 (-74%) | 0.02 | 4.55 -> 2.13 (-53%) | 4.79 -> 0.25 (-95%) | n/a | n/a | 1 | 102 -> 94 (-8%) | endFrame 1 |
| paint-order | n/a -> 530 | n/a -> 4.87 | n/a -> 0.02 | n/a -> 4.11 | n/a -> 1.23 | n/a | n/a | n/a -> 1 | n/a -> 1272 | n/a -> endFrame 1 |
| clipping | n/a -> 1290 | n/a -> 2.91 | n/a -> 0.01 | n/a -> 2.87 | n/a -> 0.97 | n/a | n/a | n/a -> 1 | n/a -> 939 | n/a -> endFrame 1 |
| shading | n/a -> 723 | n/a -> 4.91 | n/a -> 0.02 | n/a -> 3.84 | n/a -> 1.52 | n/a | n/a | n/a -> 5 | n/a -> 1728 | n/a -> endFrame 1 |
