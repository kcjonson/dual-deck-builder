# phase7-gallery-baseline

Captured 2026-09-28 from http://localhost:9193/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Load average (1, 5, 15 min): 8.5, 11.0, 16.0 at the start, 8.7, 10.9, 15.9 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 1329 | 0.75 | 5.34 | 5.39 | 0.02 | 4.92 | 0.26 | n/a | n/a | n/a | 0 | n/a | 11 | 1 | 154 | endFrame 1 | 0 |
| style-guide | 1544 | 0.65 | 2.63 | 2.73 | 0.06 | 2.28 | 0.30 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 162 | endFrame 1 | 0 |
| input-showcase | 1786 | 0.56 | 2.43 | 2.58 | 0.02 | 2.15 | 0.44 | n/a | n/a | n/a | 0 | n/a | 15 | 1 | 290 | endFrame 1 | 0 |
| rectangles | 1550 | 0.65 | 2.26 | 2.42 | 0.01 | 0.12 | 1.81 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 46 | endFrame 1 | 0 |
| buttons | 1023 | 0.98 | 5.29 | 6.05 | 0.02 | 0.15 | 5.46 | n/a | n/a | n/a | 0 | n/a | 19 | 1 | 194 | endFrame 1 | 0 |
| text | 1064 | 0.94 | 3.40 | 3.53 | 0.02 | 2.61 | 1.47 | n/a | n/a | n/a | 0 | n/a | 31 | 1 | 1464 | endFrame 1 | 0 |
| primitive-shapes | 1379 | 0.73 | 3.12 | 5.41 | 0.03 | 2.21 | 0.35 | n/a | n/a | n/a | 0 | n/a | 21 | 1 | 242 | endFrame 1 | 0 |
| nested-panels | 1114 | 0.90 | 2.02 | 2.41 | 0.02 | 0.08 | 2.02 | n/a | n/a | n/a | 0 | n/a | 7 | 1 | 94 | endFrame 1 | 0 |

## Against the DDB-92 capture (perf-results/phase7-gallery-baseline.json at 987494b)

Section maxima and p99 move with whatever else the machine is doing, and two unthrottled captures of the same build can differ by tens of percent on a light scene. A section or max delta here is unconfirmed until a second capture agrees; FPS on a heavy scene and paced GPU medians are stable to a few percent.

| Scenario | FPS | Frame p99 | Update max | Render max | Flush max | GPU median | GPU p99 | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| interactive-controls | 196 -> 1329 (+579%) | 13.97 -> 5.34 (-62%) | 0.03 -> 0.02 (-33%) | 13.18 -> 4.92 (-63%) | 6.72 -> 0.26 (-96%) | n/a | n/a | 1 | 162 -> 154 (-5%) | endFrame 1 |
| style-guide | 288 -> 1544 (+436%) | 13.26 -> 2.63 (-80%) | 0.04 -> 0.06 (+37%) | 0.28 -> 2.28 (+727%) | 13.06 -> 0.30 (-98%) | n/a | n/a | 1 | 166 -> 162 (-2%) | endFrame 1 |
| input-showcase | 58 -> 1786 (+2981%) | 30.29 -> 2.43 (-92%) | 0.04 -> 0.02 (-62%) | 15.79 -> 2.15 (-86%) | 30.02 -> 0.44 (-99%) | n/a | n/a | 1 | 322 -> 290 (-10%) | endFrame 1 |
| rectangles | 210 -> 1550 (+640%) | 9.26 -> 2.26 (-76%) | 0.03 -> 0.01 (-71%) | 4.57 -> 0.12 (-97%) | 4.76 -> 1.81 (-62%) | n/a | n/a | 1 | 48 -> 46 (-4%) | endFrame 1 |
| buttons | 110 -> 1023 (+831%) | 42.75 -> 5.29 (-88%) | 0.06 -> 0.02 (-67%) | 0.49 -> 0.15 (-70%) | 45.77 -> 5.46 (-88%) | n/a | n/a | 1 | 202 -> 194 (-4%) | endFrame 1 |
| text | 199 -> 1064 (+435%) | 59.92 -> 3.40 (-94%) | 0.03 -> 0.02 (-33%) | 9.83 -> 2.61 (-73%) | 80.51 -> 1.47 (-98%) | n/a | n/a | 1 | 1700 -> 1464 (-14%) | endFrame 1 |
| primitive-shapes | 212 -> 1379 (+551%) | 10.06 -> 3.12 (-69%) | 0.02 -> 0.03 (+25%) | 9.71 -> 2.21 (-77%) | 9.68 -> 0.35 (-96%) | n/a | n/a | 17 -> 1 (-94%) | 204 -> 242 (+19%) | endFrame 1 |
| nested-panels | 209 -> 1114 (+432%) | 9.35 -> 2.02 (-78%) | 0.02 | 4.55 -> 0.08 (-98%) | 4.79 -> 2.02 (-58%) | n/a | n/a | 1 | 102 -> 94 (-8%) | endFrame 1 |
