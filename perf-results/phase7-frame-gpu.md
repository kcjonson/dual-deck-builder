# phase7-frame-gpu

Captured 2026-09-28 from http://localhost:9092/ at 1440x882, headless Chrome with vsync on, so frame times are paced and only the GPU columns and the sections are costs, 1000 ms and 120 frames of settle, and 20 samples per scenario. Times in ms. Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). GPU columns are timer-query GPU time over the valid samples (R13.16); a sample over three times its CPU frame is excluded and counted under GPU invalid (R13.18), and n/a with no invalid count means the extension is absent.

| Scenario | FPS | Frame median | Frame p99 | Frame max | Update max | Render max | Flush max | GPU median | GPU p99 | GPU max | GPU invalid | API draws | GPU draws | Triangles | Flushes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| splashScreen | 59 | 16.90 | 18.44 | 18.69 | 0.07 | 0.45 | 0.31 | 5.43 | 6.32 | 6.92 | 0 | 4 | 1 | 78 | endFrame 1 |
| mainMenuScreen | 60 | 16.81 | 18.50 | 18.57 | 0.08 | 0.34 | 0.38 | 6.90 | 6.91 | 6.93 | 0 | 12 | 1 | 150 | endFrame 1 |
| developerScreen | 61 | 16.53 | 18.82 | 18.84 | 0.17 | 1.23 | 0.08 | 8.97 | 9.02 | 9.03 | 0 | 37 | 2 | 388 | barrier 2 |
| cardShowcaseScreen | 59 | 17.02 | 18.26 | 18.50 | 0.29 | 4.75 | 0.04 | 9.64 | 9.72 | 9.73 | 0 | 288 | 2 | 6438 | barrier 2 |
| driverSelectionScreen | 60 | 16.61 | 18.55 | 18.79 | 0.09 | 0.60 | 1.36 | 6.36 | 6.43 | 6.46 | 0 | 88 | 1 | 2040 | endFrame 1 |
| combatScreen | 37 | 26.93 | 33.94 | 35.16 | 0.30 | 2.46 | 0.13 | 16.21 | 16.30 | 16.31 | 1 | 173 | 6 | 2118 | barrier 5, endFrame 1 |
| battleResultScreen | 60 | 16.69 | 18.74 | 18.87 | 0.06 | 0.16 | 0.16 | 5.54 | 5.60 | 5.63 | 0 | 6 | 1 | 22 | endFrame 1 |
