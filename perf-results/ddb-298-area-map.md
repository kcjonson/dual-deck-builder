# ddb-298-area-map

Captured 2026-10-08 from http://localhost:8298/gallery.html at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 30 samples per scenario. Times in ms. Device: ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11). Load average (1, 5, 15 min): 0.0, 0.0, 0.0 at the start, 0.0, 0.0, 0.0 at the end.

GPU timer: off. GPU columns are n/a because nothing measured them, not because they are zero.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | Fence latency | API draws | GPU draws | Triangles | Flushes | Long frames (worst window) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| area-map | 1487 | 0.67 | 0.96 | 1.04 | 0.01 | 0.48 | 0.74 | n/a | n/a | n/a | 0 | n/a | 503 | 1 | 2580 | endFrame 1 | 0 |
| area-map-fog | 1307 | 0.77 | 0.98 | 1.00 | 0.01 | 0.19 | 0.78 | n/a | n/a | n/a | 0 | n/a | 241 | 1 | 1698 | endFrame 1 | 0 |
| shading | 1325 | 0.75 | 1.05 | 1.05 | 0.01 | 0.38 | 0.72 | n/a | n/a | n/a | 0 | n/a | 333 | 5 | 1852 | endFrame 1 | 0 |
