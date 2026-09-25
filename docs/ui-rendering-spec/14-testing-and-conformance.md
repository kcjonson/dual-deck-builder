# 14. Testing strategy and conformance

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

How an implementation proves it conforms, and where the two reference implementations stand today. The test strategy is the one worldsim converged on (headless unit tests over a no-op renderer, behaviour tests per component, the lint as the merge gate) plus the two pieces it never built (a recording backend and golden screenshots). The consistency review found the scoring table lagging the revised chapters; it is re-scored below against draft 3's required items.

Rules are numbered R14.n.

## 14.1 Test layers

- R14.1 Unit tests without a GPU, against the null backend (chapter 2, R2.21): tree semantics (chapter 8 tests), dispatch and focus (chapter 9 tests), the layout suite (chapter 10 tests), text measurement and wrapping against the committed metrics files (chapter 6 tests), token resolution and state tables (chapter 11 tests), lint and snapshot (chapter 13). These MUST run in the project's ordinary test runner and CI, which requires that engine modules are importable and constructible without a DOM or a canvas and that timing tests drive `update(dt)` with a test clock rather than platform timers.
- R14.2 Ordering tests against the recording backend (chapter 2, R2.22): the chapter 3 and chapter 4 required tests, and per-component "what was drawn and in what order" assertions. These MUST also be GPU-free.
- R14.3 Component behaviour tests: the worldsim suites listed in chapter 12 as "tests: port" are the conformance tests for those components; they drive components through the dispatcher with constructed events and through `update(dt)` loops for timing, never by calling handlers directly.
- R14.4 Pixel tests with a GPU: chapter 5 and 6 fixtures, chapter 7 snapping tests. They run where a context exists and skip (not fail) headless; in CI they run under the software GL path of chapter 15, R15.33 with their own baselines.
- R14.5 Gallery screenshot goldens: every gallery scene (chapter 13, R13.31) has a golden per backend; comparison uses a perceptual pixel diff with an anti-aliasing tolerance and a small `maxDiffPixelRatio`; the render clock is fixed-step and injected so animations land on the same frame. Goldens are produced by the CI runner image; local runs compare and never update, because local hardware output does not match the software renderer.
- R14.6 Performance captures: the chapter 13 capture script runs on demand and after each rendering phase lands; a comparison table against the previous baseline accompanies the change.

## 14.2 Gates

- R14.7 Merge gate for any UI change: unit and ordering tests green; `lint.count == 0` on every gallery scene and every game screen; screenshot goldens either unchanged or updated with the change reviewed visually.
- R14.8 Merge gate for any renderer change: the above plus the pixel fixtures and a perf capture comparison showing no regression in frame p99, GPU draws, or flushes.

## 14.3 Scoring conformance

A checklist item scores yes, partial, or no. An implementation "conforms at the required level" when every required item scores yes; recommended and optional items are reported, not required. The tables below are the state on 2026-09-07 from reading both codebases (no code was executed in the sibling engine because its dependencies were not installed in the audited worktree; its most recent verified toolchain state is the 2026-08-22 survey). Rows added by the reviews are scored from the same reading; the worldsim column was corrected by review 03 against the source.

- R14.9 An implementation MAY score a required item not applicable when no application it hosts exercises the behaviour (a drag-and-drop service with no drop targets, a component transform with no rotated or scaled content, an animator with no transitions), recording the justification beside the score; the row counts as conforming until an application needs the behaviour, when it is re-scored. Not applicable is never a substitute for partial: a behaviour an application does exercise scores yes, partial, or no.

## 14.4 Required items by chapter: worldsim and the sibling engine

| Chapter | Required item | Worldsim | Sibling engine |
|---|---|---|---|
| 1 | Downward dependencies, draw API only GPU path | yes | partial (components call the renderer singleton; game code makes no GPU calls of its own) |
| 1 | Mount context; services reached through it, never through globals | no (focus, tooltip, input singletons) | no (input singleton, renderer singleton) |
| 1 | Null backend | yes (draw calls no-op without a batcher) | no (jest stubs a fake context; nothing renders) |
| 2 | Frame lifecycle, no separate text batch | yes | no (text batch flushed on scissor change) |
| 2 | State stacks captured per draw | partial (transform, clip; no opacity, no layer) | no |
| 2 | Draw calls including image and `flat` | partial (no image, no explicit flat) | partial (rect, circle, polygon, text, line; texture as alpha mask only) |
| 2 | `measureText` sharing the draw iteration | yes | partial (the draw layer measures and renders from one advance table; the component layer estimates from `0.5` and `0.6` em per character instead of asking it) |
| 3 | No depth test, premultiplied over | partial (straight alpha) | partial (straight alpha) |
| 3 | Per-layer partition preserving submission order, fast path | partial (stable sort by forwarded component z) | no (tree order only, `zIndex` unread) |
| 3 | Named layer ladder, monotonic effective layer, promotion, clip reset | no (literal z values per widget) | no |
| 3 | Tree order: parent first, children by stable local `zIndex`, invisible skipped | yes | partial (insertion order only; invisible skipped) |
| 3 | Component `zIndex` never reaches the batcher | no | not applicable |
| 3 | Shadow group before owner | yes | no (no shadows) |
| 3 | Explicit barrier; UI last content domain | yes | no |
| 3 | Hit testing in reverse paint order across layers | no | no (every hovered component receives the event) |
| 3 | Children never reordered by sorting | yes | yes (no sorting) |
| 3 | Inherited opacity | no | no |
| 3 | Overlay service `bringToFront`; popups closed when a modal opens | no | no |
| 4 | Per-draw rect clip, no flush on clip change, no encoding that `empty` can produce | partial (`(0,0,0,0)` is both none and empty) | no (scissor with state queries, text flushed) |
| 4 | Three-state clip stack | no | no (nested clips replace) |
| 4 | CPU cull of draws outside the clip | no | partial (a scrollable content layer culls children against its viewport) |
| 4 | Fragment test on an interpolated logical position | no (`gl_FragCoord` with ratio and height uniforms) | not applicable (scissor) |
| 4 | Clip transformed at push | no | yes (translate-only; the scissor is computed from accumulated offsets at the moment it is applied) |
| 4 | Offset before clip; hit testing honours clip and offset | partial (offset yes; the scroll container gates on its viewport, the base container does not) | partial (offset yes; hit testing ignores clip and visibility) |
| 4 | All primitives clipped including text | partial (text input unclipped) | yes (text is flushed at each scissor change, so it is clipped by the scope it was drawn in) |
| 5 | Single program, explicit modes including `flat` | partial | partial (one program for the whole app, modes selected by per-draw uniforms, no SDF) |
| 5 | SDF rounded rect, three border positions, RGBA border, exact coverage compositing | partial (border RGB only, `mix` compositing) | no (`borderRadius` dropped) |
| 5 | Linear one-pixel ramp and quad inflation | partial (two-pixel `smoothstep`, quads expanded only for outward borders) | partial (inner stroke edge only) |
| 5 | Box shadow with CSS mapping, spread radii, full padding | partial (padded by `blur`) | no |
| 5 | Premultiplied `over`, `additive` free, sRGB blend | partial (straight alpha) | partial (straight alpha) |
| 5 | Image quads, premultiplied textures, resident texture set | no | partial (alpha-mask only) |
| 5 | Text in the same batcher | yes | no |
| 5 | 32-bit indices, reusable arrays, sized buffer rings, per-flush uniform slots | partial (orphaning, single buffer, per-flush uniforms) | no |
| 5 | Resource layer with ownership, metered uploads, context-loss recovery | no | no |
| 6 | Size-independent glyphs with the range ratio, validated metrics, fallback glyph | partial (32 px em with range 4) | no (32 px bitmap scaled; unknown glyphs vanish) |
| 6 | MSDF shading with the linear ramp | yes | no |
| 6 | Shared measure and render | yes | partial (see the chapter 2 row) |
| 6 | Ascent centring, greedy wrap with the normative break opportunities, ellipsis | partial (space and punctuation breaks; no ellipsis) | partial |
| 6 | Run snapping | yes | no (per-glyph rounding in CSS pixels, the anti-pattern R6.16 names) |
| 6 | Text in the same batch and sort, culled per run | partial (no cull) | no |
| 6 | Multiple atlases per flush | yes (the text shape ignores the family, so shape text always uses the default atlas) | not applicable (one atlas) |
| 7 | Logical pixels, ratio confined, not a shader input | partial (ratio in the clip shader) | partial |
| 7 | Projection per flush | yes | yes (rebuilt on resize, which is equivalent while the viewport only changes then) |
| 7 | Single viewport owner, resize through layout | partial | no (window reads in screens, two combat layouts) |
| 7 | Input converted once at the dispatcher | yes | partial |
| 8 | Single interface including primitives; `render()` emits own draws only | partial (seven draw-only primitives; button, select, dropdown, and toast stack render their own children) | partial (game card and vehicle bypass the base; leaves recurse into children) |
| 8 | Properties of R8.2 with propagation rules and `pointerEvents` | partial (no `pointerEvents`, `transform`, `opacity`, `layer`) | partial |
| 8 | Children order, parent back-reference, never reordered, state-preserving moves; `removeChild` unmounts | partial (no remove, no moves) | partial (remove does not unmount) |
| 8 | Margin box with per-side margin, content-box hit test, ink overflow | partial (uniform margin, mixed hit boxes) | no (no margin concept) |
| 8 | `transform` ignored by layout, honoured by render and hit testing | no | no |
| 8 | Read-only `screenBounds` and conversions; no window reads | no (positions are absolute; there is no local space to convert from) | partial (a local-to-global helper; window reads in screens) |
| 8 | Mount lifecycle, no constructor-time registration | no (registration in constructors) | no (unmount only; five classes register in constructors) |
| 8 | Frame order including layout before render, input with layout on demand | no (layout in render) | partial |
| 8 | Clock and animator with tweens, reduced motion, retargeting | no (hard-coded timers per widget) | no |
| 8 | Upward invalidation to relayout boundaries | no | no |
| 8 | Overlay service owning overlay roots; roots sized from the viewport; `onLayout` | no (hand-ordered roots) | no |
| 8 | Named-argument constructors, accessors, synchronous callbacks | yes (C++ designated initialisers) | partial (positional in the engine) |
| 9 | Event fields including pointer identity, cancel, `contextmenu`, `repeat` | partial (mouse only) | no |
| 9 | Queued dispatch at frame start against current geometry | partial (synthesised per frame from polled state; layout not on demand) | no (immediate DOM handlers) |
| 9 | Hit-test walk mirroring paint, clip- and `pointerEvents`-aware; public `hitTest` | no | no |
| 9 | Bubble | no | no |
| 9 | Framework enter, leave, `hovered` on ancestors | no | partial (over and out per component) |
| 9 | Click on the nearest common ancestor with a drag threshold | no | no |
| 9 | Pointer capture per pointer with cancellation | no | no |
| 9 | Drag-and-drop service | no | no |
| 9 | Popup dismissal and exclusivity via the popup service | no (focus theft) | no |
| 9 | Keyboard routing with scoped hotkeys; text fields own printable keys | partial | partial |
| 9 | `activate` and `cancel` actions; `inputMode` | no | no |
| 9 | Focus manager: tree-derived order, scopes, fixup, focus groups, focus-visible | partial (registration order; scopes unused; no focus-visible) | no |
| 9 | Directional focus | no | no |
| 9 | Text editing key set | yes | no (append and backspace only) |
| 9 | Wheel normalisation and latching | no | no |
| 10 | Fixed, hug, fill; stack container; three passes; modes never changed by layout | partial (resolved axes became definite) | no |
| 10 | Per-pass resolved sizes including zero; hug re-measured when dirty | partial (the freeze) | no |
| 10 | Shrink-to-fit, safe alignment, `minSize` and `maxSize`, text minimum, `alignSelf` | no | no |
| 10 | Text wrap width from the cross pass with real metrics | yes | no |
| 10 | Absolute children with anchor and pivot; roots sized from the viewport | no | no |
| 10 | Upward invalidation | no | no |
| 11 | Token file, committed generated module with a drift test | partial (generated header, no drift test) | no (about 190 inline literals) |
| 11 | Variants and framework-maintained state flags | partial | no |
| 11 | Layered state resolution, focus ring independent | no (ad hoc per component) | no |
| 11 | Closed style property set, rejected rather than ignored | not applicable (typed style structs, R11.14) | no (radius, opacity, family, weight ignored) |
| 11 | Token-driven transitions | no (hard-coded seconds) | no |
| 12 | Leaves: Rectangle, Circle, Line, Text, Image, Icon | partial (no image; icons are polylines) | partial (no image, no icon) |
| 12 | Button, ListRow, Checkbox, Toggle, RadioGroup, FocusGroup | partial (button, list row) | partial (button) |
| 12 | TextInput | partial (no validator; Escape consumed) | partial (append and backspace) |
| 12 | Menu, Select, DropdownButton, ContextMenu, Slider, TabBar, SegmentedControl | mostly (segmented control draw-only) | no |
| 12 | Container, Stack, Panel, ScrollContainer, Dialog, Popover | partial (no popover; panel draw-only) | partial (panel with stubbed scrolling) |
| 12 | Tooltip, Toast, ToastStack, ScreenTransition | partial (no screen transition; text-only tooltips) | no |
| 12 | ProgressBar, Badge, TreeView | yes | partial (a hand-built bar in one screen) |
| 12 | Placement, popup, overlay, tooltip, drag, clipboard, asset services | partial (placement duplicated three times; no popup, overlay, drag, asset services) | no |
| 13 | Frame sections with p99, histogram, spikes, per-window max | partial (no per-window max, sections overlap) | partial (frame interval only) |
| 13 | Batcher counters with reasons | no | no |
| 13 | Tree snapshot with the normative schema | partial (id, type, bounds, margin, `zIndex`, `visible`; bounds absolute) | no |
| 13 | Layout lint with the seven required rules as gate | partial (four rules) | no |
| 13 | Gallery | yes | partial (developer screen) |
| 13 | Screenshot and injection | yes | partial (a test drives the real handlers with DOM events on the canvas; no logical-coordinate API, no screenshot hook) |
| 13 | Perf capture script | yes | no |
| 13 | Dev-only build exclusion | partial | no |
| 15 | WebGL2 backend rules | not applicable | no (WebGL1) |

## 14.5 Reading the table

Worldsim conforms to most of the rendering core and the layout engine; its gaps are the z model, the input model, opacity, lifecycle, and a handful of shader details (chapter 16 lists them in priority order), plus the rules the reviews added that neither project has yet (transform, animator, drag service, directional focus, resource layer); under R14.9 worldsim may score the drag service, the transform, and the animator not applicable until a screen needs them. Catalog components absent from worldsim today, listed once: Image, Checkbox, Toggle, RadioGroup, FocusGroup, NumberInput, Popover, ScreenTransition, Counter, and a standalone Scrollbar. The sibling engine conforms to almost nothing below the object-model naming conventions, which is expected: it was a first pass at a WebGL UI written in a few weeks, and this specification exists so its second pass does not repeat the six months of ordering, clipping, and text bugs worldsim worked through. Its implementation plan lives outside this specification.

## 14.6 Migration notes for an engine that reorders text

An engine that drew text after shapes (the sibling engine's text batch flushed on clip changes and at the end of the frame) has screens that silently depend on it. When chapter 3 ordering lands, every such site changes and each needs a layout decision, not only a renderer change. Known sites in the sibling engine at the time of writing: a card's title drawn before its driver badge (the badge will cover the first glyphs; move the title past the badge); a deck preview whose overflow painted through a later button (it will hide behind it; the preview needs a scroll container or hug sizing); a screen title whose descenders overlapped a later opaque panel; a developer overlay whose background previously sat under screen text. A migration MUST include a before-and-after screenshot pass of every screen and record the intended layout fix for each reorder site in the same change.

Other one-time migration facts recorded for that engine: hit-test edges change from closed to half-open; every button changes appearance once styles are honoured; corner radii render for the first time at about thirty-five sites; every estimated text layout reflows once real metrics land; polygon edges lose multisampling unless the CPU feather is implemented; the accessor rename is a mechanical change best landed on its own.

## 14.7 Conformance checklist

| Item | Level |
|---|---|
| Unit and ordering tests on null and recording backends in CI | required |
| Ported component behaviour suites | required |
| Lint-zero merge gate | required |
| Pixel fixtures with headless skip | required |
| Gallery screenshot goldens per backend, produced in CI (a gate for UI changes) | required |
| Perf capture comparison per renderer change (a gate for renderer changes) | required |
