# 0. Glossary and conventions

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

## Conventions

- MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are used as in RFC 2119. A required conformance item is a MUST; recommended is a SHOULD; optional is a MAY. A required item MAY be scored not applicable with a recorded justification when no hosted application exercises it (chapter 14, R14.9). A checklist row marked "out of scope" names something the specification deliberately does not cover; it carries no level and is not scored.
- Rules are numbered `R<chapter>.<n>` (R3.14 is chapter 3, rule 14) so reviews, tests, and commit messages can cite them. A number identifies a rule, not a position: rules are grouped by topic within a chapter, a revision may insert a new rule at its logical place with the next unused whole number or with a letter suffix on a related rule (R5.7a sits beside R5.7), and a number is never reused. Rule numbers are stable once published; a withdrawn rule keeps its number with the text "withdrawn".
- Each chapter ends with a conformance checklist. Chapter 14 aggregates them and scores the two reference implementations.
- "Worldsim" is the C++ and OpenGL reference implementation; "the sibling engine" or "the deck builder" is the TypeScript and WebGL2 project this specification was written to upgrade. Provenance notes name them so a reader can tell a rule that codifies practice from a rule that corrects it.
- All lengths are logical pixels unless stated otherwise (chapter 7). Colours are RGBA in [0, 1], authored straight and blended premultiplied (chapter 5). Angles, when any, are radians.
- Code-like identifiers in the text (`zIndex`, `pushClip`) are the names used in the reference implementations or the suggested names for a new one; an implementation MAY rename as long as the semantics hold, and SHOULD keep the names where it has no reason not to.

## Glossary

- Backend: the layer that talks to a GPU API (WebGL2, OpenGL, WebGPU). Chapter 15 and 16.
- Barrier (`flush`): the point at which the batcher sorts and submits everything accumulated so far; ends a sort domain. Chapter 3.
- Batcher: the component of the draw API that accumulates draw groups, sorts them, and submits them. Chapter 2, 3.
- Bounds: a component's margin box in its parent's content-box coordinates. Chapter 8.
- Clip: the axis-aligned (or rounded) region outside of which a draw's fragments are discarded; carried per draw. Chapter 4.
- Component: any node in the retained tree, leaf or container. Chapter 8.
- Content box: a component's bounds inset by its margin; where it draws and where it is hit-tested. Chapter 8.
- Content offset: a container's translation of its children, used for scrolling; independent of clipping. Chapter 4.
- Domain (sort domain): the draw groups between two barriers; layer keys compare only within a domain. Chapter 3.
- Drag threshold: the distance a pressed pointer must move before a gesture becomes a drag rather than a click; a token. Chapter 9.
- Focus group: a container that is one Tab stop with arrow-key movement inside it (the roving-tabindex pattern). Chapter 9.
- Ink overflow: drawing outside a component's layout box (shadows, glows, focus rings); ignored by layout and hit testing, clipped like everything else. Chapter 8.
- Overlay service: the mount-context service that owns overlay roots (dialogs, toast stacks, transitions) and orders them after the scene's roots. Chapter 8.
- `pointerEvents`: a component's hit-testability mode (`auto`, `passthrough`, `unit`, `none`), never derived from what it draws. Chapter 8.
- Relayout boundary: the nearest ancestor whose sizing modes are both fixed (or a root); invalidation stops there and layout runs from it. Chapter 8.
- Transform: a component's rotation, scale, and translation about a pivot; ignored by layout, honoured by render and hit testing. Chapter 8.
- `dpr`: device pixel ratio, framebuffer pixels per logical pixel. Chapter 7.
- Draw call: one call on the immediate draw API. Chapter 2.
- Draw group: the vertex and index range one draw call produced, plus its layer key. Chapter 3.
- Draw API: the immediate-mode functions through which all UI pixels are produced. Chapter 2.
- Effective value: a property value after combining a component's own value with its parent's effective value (`visible`, `enabled`, `opacity`, `layer`). Chapter 8.
- Fill, hug, fixed: the three sizing modes of the layout engine. Chapter 10.
- Focus scope: a subtree root that becomes the active Tab-cycling scope while it holds focus (a modal opening pushes one); the set of focusables is derived from its subtree. Chapter 9.
- Focus-visible: focus that arrived by keyboard and therefore draws a ring. Chapter 9, 11.
- Gallery (sandbox): the development application that mounts one scene at a time by name. Chapter 13.
- Layer: a named stacking band (`base`, `raised`, `overlay`, `modal`, `popup`, `toast`, `tooltip`, `drag`, `transition`); the batcher's sort key. Chapter 3.
- Lint (layout lint): the pure function that checks a tree snapshot for overlap, containment, and size invariants. Chapter 13.
- Local order (`zIndex`): an integer ordering a component among its siblings only. Chapter 3, 8.
- Logical pixel: the unit of every public coordinate; a CSS pixel in a browser, a window point natively. Chapter 7.
- Margin box: a component's content box grown by its margin on every side; its reported bounds. Chapter 8.
- Mount context: the object carrying services, viewport, clock, and tokens to every component on mount. Chapter 1, 8.
- MSDF: multi-channel signed distance field, the glyph representation in font atlases. Chapter 6.
- Painter's algorithm: drawing back to front so later draws cover earlier ones; the only ordering mechanism used. Chapter 3.
- Pointer capture: routing all pointer events to one component until release, for drags. Chapter 9.
- Premultiplied alpha: colour stored as (r·a, g·a, b·a, a); the blending representation throughout. Chapter 5.
- Promotion: a component setting a `layer` above its parent's, which lifts its subtree into that layer and resets the inherited clip (chapter 3, R3.8); position, content offset, and transform are unchanged. Chapter 3.
- Recording backend: a backend that returns the sorted draw list instead of drawing, for tests. Chapter 2.
- SDF: signed distance field; the fragment-stage representation of rectangles, circles, and shadows. Chapter 5.
- Snapshot (tree snapshot): the JSON serialisation of the live tree after layout. Chapter 13.
- Stack (stack container): the flow-layout container with direction, gap, padding, distribution, and cross alignment. Chapter 10.
- Submission order: the order draw calls reach the batcher; equal to the depth-first tree walk order for UI. Chapter 3.
- Token: a named design value from the single token file. Chapter 11.
- Tone, size: the cross-component variant vocabulary. Chapter 11.
- Uber shader: the single program that renders every primitive kind, selected per draw by data. Chapter 5.
- `uiScale`: the user-facing UI scale factor, applied by redefining the logical viewport. Chapter 7.
- Visual state: a component's set of composable boolean state flags (`hovered`, `pressed`, `focused`, `focusVisible`, `enabled`, `selected`, `open`, `active`, `dropActive`) that style resolution layers together; no flag is exclusive. Chapter 11.
