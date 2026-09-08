# Research inputs

The reports in this folder are the primary sources the specification was abstracted from. They were produced on 2026-09-07 by reading the two reference codebases and the published designs listed in each report; file and line references are as of that date (worldsim at its `main` of 2026-07-06 plus later branch work, the sibling engine at commit `49ae3c7`). They are kept verbatim as provenance: when a rule in the specification cites "worldsim does X" or "the sibling engine does Y", the evidence is here. They are not maintained; the specification is.

| File | Subject |
|---|---|
| [01-worldsim-draw-core.md](01-worldsim-draw-core.md) | Worldsim's immediate draw API, batcher, uber shader, clipping, coordinate system, and above all its render-ordering mechanisms and the incidents behind them |
| [02-worldsim-ui-components.md](02-worldsim-ui-components.md) | Worldsim's object model, event system, focus manager, layout engine, token pipeline, the full component catalog with behaviour contracts and tests, debug tooling, and design-language rules |
| [03-worldsim-perf-observability.md](03-worldsim-perf-observability.md) | Worldsim's frame timing, metrics, GPU timer, benchmarks, sandbox app and HTTP endpoints, dashboard, tree snapshot and lint, logging, testing, and the lessons recorded about each |
| [04-sibling-engine-audit.md](04-sibling-engine-audit.md) | The TypeScript/WebGL engine that the specification was written to replace: its pipeline, ordering, object model, input, components, layout, tooling, and a gap analysis |
| [05-webgl-prior-art.md](05-webgl-prior-art.md) | Web research with sources: OpenGL versus WebGL2 feature matrix, GLSL ES differences, ANGLE and Electron specifics, prior art (GPUI, PixiJS, Skia, Flutter, WebRender, ImGui, egui, Unity, Godot, and others), rendering techniques, browser performance monitoring, and layout engines |

The review reports that challenged the first draft are in [../review/](../review/README.md), and their resolutions in chapter 17 of the specification.
