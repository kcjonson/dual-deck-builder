# Layered UI rendering specification

Status: draft 4, 2026-09-07. All five reviews resolved (see `17-review-log.md`).

A backend-agnostic specification for a 2D game UI renderer: an immediate-mode draw API with a batching, sorting painter's renderer underneath, a retained component tree on top, and the layout, input, focus, theming, component catalog, and developer tooling that go with it. It was abstracted from worldsim (C++, OpenGL) after a year of development and written so that a second implementation (TypeScript, WebGL2, browser and Electron) can be built to it and so that both projects can be scored against it.

This directory is self-contained. It references the two projects for provenance only and can be moved into its own repository unchanged.

## What it is for

- A contract precise enough to test: every chapter ends in numbered rules (R3.14) and a conformance checklist; chapter 14 scores the two reference implementations.
- A record of why: each chapter carries the incidents that produced its rules, so nobody re-argues the depth buffer, the per-scissor flush, or the overlay queue.
- A shared base: the same token file, the same tree snapshot schema, the same lint rules, the same component behaviours in both languages.

## How to read it

Read chapters 0 to 3 in order; they define the vocabulary, the layers, the draw API, and the ordering rules everything else assumes. After that the chapters are independent. If you only read one, read 3.

| Chapter | Subject |
|---|---|
| [00](00-glossary-and-conventions.md) | Glossary, RFC 2119 keywords, rule numbering, conformance levels |
| [01](01-architecture.md) | The four layers, dependency direction, the frame, the mount context |
| [02](02-draw-api.md) | The immediate draw API: lifecycle, state stacks, draw calls, null and recording backends |
| [03](03-render-order.md) | Render order: painter's algorithm, draw groups, layers, promotion, barriers, opacity, hit order |
| [04](04-clipping.md) | Clipping as per-draw data, three-state clip stack, scrolling, rounded and stencil clips |
| [05](05-primitives-and-shading.md) | The uber shader: SDF rects, borders, shadows, circles, lines, images, premultiplied alpha, colour |
| [06](06-text.md) | MSDF text: atlases, metrics, measure equals render, wrapping, snapping, batching |
| [07](07-coordinates-and-dpi.md) | Logical pixels, device pixel ratio, UI scale, snapping, resizing |
| [08](08-object-model.md) | The retained tree: interface, children, geometry, lifecycle, invalidation, authoring API |
| [09](09-input-and-focus.md) | Events, hit testing, bubbling, capture, popups, keyboard routing, focus |
| [10](10-layout.md) | Fixed, hug, fill; the stack container and its three-pass algorithm |
| [11](11-style-and-theme.md) | Tokens, the design-language rules, variants, visual states, transitions |
| [12](12-component-catalog.md) | Required components and their behaviour contracts |
| [13](13-observability-and-performance.md) | Frame timer, batcher counters, GPU timer, tree snapshot, lint, gallery, screenshots, injection, perf capture |
| [14](14-testing-and-conformance.md) | Test layers, gates, conformance scoring of both reference implementations |
| [15](15-backend-webgl2.md) | WebGL2 and Electron specifics, port risks |
| [16](16-backend-opengl.md) | OpenGL mapping and the worldsim gap list |
| [17](17-review-log.md) | Review findings and their resolutions |
| [research/](research/README.md) | The five research reports the specification was abstracted from (worldsim's draw core, components, and tooling; the sibling engine audit; web prior art with sources) |
| [review/](review/README.md) | The independent review reports that challenged the first draft |

## Conformance levels

Required items are MUSTs; an implementation conforms when all of them score yes. Recommended items are SHOULDs and optional items are MAYs; they are reported, not required. The checklists are at the end of each chapter and aggregated in chapter 14.

## Provenance

Worldsim's rendering core, layout engine, focus manager, token pipeline, tree snapshot, and lint are the base (chapter 16.3 records what changed on top); its development log supplied the incident list. The sibling engine's audit supplied the anti-patterns and the migration constraints. Published designs consulted for the rules that go beyond both: Zed's GPUI (draw order and per-primitive clip), PixiJS v8 (instruction lists and render layers), Dear ImGui and egui (per-command clip rects, named layer orders), Skia and Flutter (clip stack, group opacity as a layer), WebRender (batching and clip chains), the CSS stacking-context and compositing specifications, Inigo Quilez's distance functions, Evan Wallace's rounded-rectangle shadows, msdfgen and msdf-atlas-gen, Clay (fit, grow, fixed layout), and the WebGL 2.0 and GLSL ES 3.00 specifications with MDN's best practices and the ANGLE project notes.

## Adopting the specification in a project

1. Score the current implementation against chapter 14's table and record it.
2. Implement chapters 2 to 5 first (the draw API and the ordering model); nothing above them is stable until they are.
3. Build chapter 13's gallery, snapshot, and lint before porting components; worldsim's rule was "build the net before the thing it catches".
4. Port components with their behaviour suites (chapter 12) one at a time, each landing with its gallery scene and zero lint violations.
5. Keep the token file as the single source of truth from the first component.

## Changing the specification

Rules are numbered and stable; a new rule takes the next unused number in its chapter (or a letter suffix beside a related rule) and sits at its logical place, so numbers identify rules, not positions; withdraw rather than renumber. Record the reason for every change in the chapter's rationale section and, while the review is open, in chapter 17.
