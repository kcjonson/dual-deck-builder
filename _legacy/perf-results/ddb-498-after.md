# ddb-498-after

Captured 2026-10-16 from http://127.0.0.1:8498/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11). Load average (1, 5, 15 min): 0.0, 0.0, 0.0 at the start, 0.0, 0.0, 0.0 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| area-map | 203 | 4.92 | 6.80 | 7.40 | 0.02 | 3.44 | 4.43 | n/a | n/a | n/a | 0 | n/a | 3036 | 1 | 18414 | endFrame 1 | 0 |
| area-map-fog | 866 | 1.16 | 1.71 | 1.71 | 0.01 | 0.76 | 1.40 | n/a | n/a | n/a | 0 | n/a | 465 | 1 | 5174 | endFrame 1 | 0 |
