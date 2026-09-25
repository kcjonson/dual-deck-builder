# 1. Architecture

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Four layers, one direction of dependency, and one rule about who owns pixels. The layers are the same in both reference projects (worldsim in C++ on OpenGL, the sibling deck builder in TypeScript on WebGL2); what differs between them is confined to the bottom layer and to the tooling transport.

Rules are numbered R1.n.

## 1.1 The layers

```
game code, screens, HUD            <- uses components and the draw API
--------------------------------------------------------------
4. components and theme            <- chapter 11, 12
3. retained tree, layout, input,   <- chapter 8, 9, 10
   focus, services
2. draw API and batcher            <- chapter 2, 3, 4, 5, 6, 7
1. GPU backend                     <- chapter 15 (WebGL2), 16 (OpenGL)
--------------------------------------------------------------
tooling (gallery, snapshot, lint,  <- chapter 13; development builds only,
perf, injection)                      reaches into every layer read-only
```

- R1.1 Dependencies point downward only. Components depend on the tree and the draw API; the tree depends on the draw API; the draw API depends on the backend; the backend depends on nothing above it. Game code depends on components and on the draw API, never on the backend.
- R1.2 The draw API is the only path to the GPU for UI (chapter 2). Components do not hold GPU resources; the tree does not know the backend exists. A world renderer that owns its own GPU path coordinates with the batcher only through flush barriers (chapter 3, R3.22).
- R1.3 Layers 2 through 4 and the tooling are backend-agnostic by construction: their source contains no GPU API calls and no platform input calls. The backend and the platform shell (window, canvas, input source, clock) are the two adapters an implementation writes.

## 1.2 What each layer knows

- Backend (1): buffers, textures, programs, passes, queries; the pipeline key and bind-group abstraction of chapter 15, R15.38 so that WebGL2, OpenGL, and later WebGPU sit behind the same interface. Also the null and recording backends of chapter 2 for tests.
- Draw API and batcher (2): the immediate calls, the four state stacks, draw groups and their layer keys, the sort, the flush, the counters. Also font metrics and text layout, because measurement is a draw-side concern that layout consumes.
- Tree and services (3): components as objects, children, lifecycle, the order walk that emits draw calls, layout, hit testing and event dispatch, focus, the popup and tooltip and placement services, the mount context that carries all of them plus the viewport and the clock.
- Components and theme (4): the catalog, tokens, variants, state tables, transitions.
- Tooling: frame timer, batcher statistics, tree snapshot, lint, gallery, screenshot and injection hooks, perf capture.

## 1.3 The frame

- R1.4 A frame is: platform input converted to logical events and dispatched (chapter 9); `update(dt)` on opted-in components with a clamped `dt`; layout of dirty subtrees (chapter 10); then rendering as an ordered sequence of sort domains separated by barriers, the screen UI last before any diagnostic overlay (chapter 3, R3.21); then the snapshot if requested and the frame statistics.
- R1.5 Inside the UI domain the tree is walked once, depth first, emitting draw calls in submission order; the batcher stamps each with the current layer; at the barrier the groups are stable-sorted by layer and submitted. No second pass, no per-frame scene graph rebuild, no retained GPU geometry in the baseline.

## 1.4 The mount context

- R1.6 A single context object is created by the platform shell and passed to every component on mount (chapter 8, R8.15): the draw API, the font metrics service, the focus manager, the popup, tooltip, placement, and clipboard services, the viewport (logical size, `dpr`, `uiScale`), the clock, and the token set. Layers 3 and 4 reach every service (focus, popup, tooltip, placement, clipboard, input, clock) through the context and never through a global; tests build a context with a null backend. The draw API of layer 2 MAY be a process-wide instance in a native implementation (worldsim's free functions over a static batcher are fine) as long as components reach it through the context and never touch GPU objects through it.

## 1.5 Domains and the world

- R1.7 World rendering (tiles, entities, 2.5D depth sorting, particles) is out of scope. The specification defines how the world and the UI share a frame: world passes are their own domains, they flush before raw draws and the UI flushes before it begins, and world-space UI (health bars, names) is drawn through the draw API in a domain of its own between them.

## 1.6 Non-goals

Vector path rendering beyond icons (tessellation, stroking, gradients along paths), 3D, HTML or CSS interoperability, accessibility tree export, right-to-left and complex-script text in the baseline (chapter 6, R6.20), HDR and wide-gamut output, and a markup language for UI. Multiple windows are out of scope as a shared concern: each window is a separate platform shell with its own backend, resource layer, and mount context, and nothing GPU-side is shared between them. Each of these can be layered on later without changing the contracts here.

## 1.7 Module map (suggested names)

| Concern | TypeScript | C++ (worldsim) |
|---|---|---|
| Backend | `engine/gpu/` (`WebGL2Backend`, `NullBackend`, `RecordingBackend`) | `libs/renderer/gl/` |
| Draw API and batcher | `engine/draw/` (`DrawApi`, `Batcher`, `DrawGroup`, `Layers`) | `libs/renderer/primitives/` |
| Text | `engine/text/` (`FontAtlas`, `TextMetrics`, `TextLayout`) | `libs/ui/font/` |
| Tree and services | `engine/ui/` (`Component`, `Container`, `Stack`, `Dispatcher`, `FocusManager`, `MountContext`) | `libs/ui/component/`, `libs/ui/input/`, `libs/ui/focus/`, `libs/ui/layout/` |
| Components and theme | `engine/components/`, `engine/theme/` (generated `tokens.ts`) | `libs/ui/components/`, `libs/ui/theme/` |
| Tooling | `engine/devtools/` (`FrameTimer`, `TreeSnapshot`, `LayoutLint`, `Gallery`) | `libs/ui/debug/`, `libs/renderer/metrics/`, `apps/ui-sandbox/` |

Names are suggestions; the dependency direction is the rule.

## 1.8 Rationale

The four-layer stack is worldsim's, recorded in its integration architecture in 2025 as "components, primitives API, batch renderer, OpenGL". Two things are added: the mount context (so that layers 2 to 4 have no singletons and can be tested and hosted more than once per process) and the backend interface shaped for WebGPU (so the WebGL2 implementation is not the last one). The immediate draw API under a retained tree is the pattern every surveyed production engine converges on; the specification's contribution is making the ordering contract between the two explicit enough to test.

## 1.9 Conformance checklist

| Item | Level |
|---|---|
| Downward-only dependencies; no GPU or platform calls above the backend | required |
| Draw API is the only GPU path for UI | required |
| Frame structure of R1.4 with the UI as the last content domain | required |
| Mount context; services reached through it, never through globals | required |
| Null backend | required |
| Recording backend | recommended |
| Backend interface shaped as in chapter 15, R15.38 | recommended |
