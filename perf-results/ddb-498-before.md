# ddb-498-before

Captured 2026-10-16 from http://127.0.0.1:8499/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11). Load average (1, 5, 15 min): 0.0, 0.0, 0.0 at the start, 0.0, 0.0, 0.0 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| area-map | 346 | 2.89 | 5.47 | 5.77 | 0.03 | 3.14 | 2.97 | n/a | n/a | n/a | 0 | n/a | 2304 | 1 | 10440 | endFrame 1 | 0 |
| area-map-fog | 971 | 1.03 | 1.75 | 2.77 | 0.01 | 1.76 | 1.07 | n/a | n/a | n/a | 0 | n/a | 364 | 1 | 4160 | endFrame 1 | 0 |
