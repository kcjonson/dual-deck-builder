# phase7-frame-baseline

Captured 2026-09-28 from http://localhost:9092/ at 1440x882, headless Chrome with vsync and the frame cap off (R13.38), 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times its CPU frame is excluded and counted under GPU invalid (R13.18), and n/a with no invalid count means the extension is absent.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 194 | 5.14 | 10.71 | 10.74 | 0.04 | 5.34 | 5.69 | n/a | n/a | n/a | 8 | 4 | 1 | 78 | endFrame 1 |
| mainMenuScreen | 189 | 5.29 | 11.20 | 12.37 | 0.06 | 6.96 | 6.53 | n/a | n/a | n/a | 0 | 12 | 1 | 150 | endFrame 1 |
| developerScreen | 77 | 13.04 | 33.38 | 33.48 | 0.13 | 32.93 | 0.09 | n/a | n/a | n/a | 0 | 37 | 2 | 388 | barrier 2 |
| cardShowcaseScreen | 111 | 9.02 | 15.44 | 15.78 | 0.31 | 15.43 | 0.02 | 5.70 | 5.80 | 5.80 | 0 | 288 | 2 | 6438 | barrier 2 |
| driverSelectionScreen | 348 | 2.88 | 12.58 | 12.88 | 0.09 | 11.35 | 1.72 | 3.76 | 3.77 | 3.77 | 29 | 88 | 1 | 2040 | endFrame 1 |
| combatScreen | 35 | 28.72 | 32.87 | 32.99 | 0.14 | 30.81 | 9.65 | 16.10 | 16.26 | 16.26 | 7 | 173 | 6 | 2118 | barrier 5, endFrame 1 |
| battleResultScreen | 195 | 5.13 | 10.82 | 10.84 | 0.03 | 5.36 | 6.20 | n/a | 3.26 | 3.26 | 7 | 6 | 1 | 22 | endFrame 1 |
