# Where the draw API resolves state, and what that makes the backend seam

Date: 2026-09-09. Epic DDB-55, phase 1, first of three PRs against DDB-65.
Normative source: `docs/ui-rendering-spec/`, chapters 2, 3, 4 and 13.

## The problem

Chapter 2 specifies an immediate draw API with four push/pop state stacks
(transform, clip, opacity, layer) and seven draw calls. R2.4 to R2.7 say the
stacks are "captured into each draw at submission time (nothing is GPU state)".
That sentence is the whole design, and it admits at least three implementations
that differ in where the capture lands and therefore in what a backend receives.
The choice is expensive to revisit: PR 3 moves every consumer onto this seam, PR
4 puts the batcher behind it, PR 6 replaces the backend with WebGL2, and each of
those pays for whatever is decided here.

## Options considered

Three were built end to end and compared against the same brief.

**Command objects.** Each draw call reads the four stacks once and stamps the
resolved values onto a plain-data `DrawCommand`, which the API accumulates and
hands to the backend one array per sort domain.

**Backend callbacks.** The API resolves the same four stacks into a single
reused `DrawState` scratch object and calls one method per primitive on the
backend (`drawRect(payload, state)`), so a steady-state frame allocates nothing
through the seam.

**Encoder buffer.** Each draw becomes a fixed-size record packed into a
`Float32Array`/`Uint32Array` pair over one `ArrayBuffer`, with variable-length
values in side tables and a `Uint32Array` of record offsets as the emit order.

## Decision

**Command objects**, with the cull, the partition, the resource surface and the
`measureText` seam grafted from the other two.

A `DrawCommand` is inert plain data carrying: the concatenated transform and its
translate-only flag, the screen-space clip already intersected down the stack,
the multiplied opacity, the layer name and ordinal, the blend mode, a dense
submission `sequence`, the optional `id`, and a `group` role of `primary` or
`shadow`. Every value on it is copied out of the caller's memory at submission.
Geometry stays in the caller's local space beside the matrix.

## Why

**The rule forces the capture, whatever the shape.** R3.10's partition moves a
group away from the call that produced it, so by the time a group is emitted the
stacks have unwound. R4.6 says it outright for the clip: "sorting, texture
splitting, and later pushes and pops cannot change what a vertex is clipped to."
Resolving anywhere later is not a different implementation of the same rule, it
is a different rule. All three candidates got this part right; it is the seam
they disagree about.

**Command objects put the batcher somewhere.** Chapters 3 and 4 make three
decisions about a *set* of groups: R3.10's per-layer partition, R3.16's shadow
adjacency through the sort, and R3.2's optional occlusion drop. Under callbacks
there is no moment at which a set of groups exists, so each backend has to
implement those itself, and two backends can then disagree about what order a
frame was in. Under a materialised list the batcher is a function from a list to
a list, written once, upstream of every backend.

**The command survives the call, which is what the recording backend needs.**
R2.22's recording backend is a `push`; a frame is snapshottable, diffable and
storable as a fixture; the JSON round trip is a test rather than a claim. The
scratch-object shape trades that away by contract, and the buffer shape trades
it for a decoder.

**The buffer's argument is entirely downstream.** R15.11's fixed-capacity rings,
R15.15's per-flush uniform block and R5.4's packed instance are real, and none of
them exists yet. The version measured here grows rather than being a ring, its
rect record is 152 bytes against R5.4's worked 64, and it costs roughly 4,900
lines with no consumers. Interning or packing can be added later as a pass over
the same array without touching the backend interface, because the commands are
inert and nothing holds a reference into a live stack.

**The cost was measured, not assumed.** 112 groups a frame (48 bordered rounded
rects, 16 shadowed, 48 text runs, under a clip and a per-card translate) through
the whole API path into the null backend ran at a median 0.0088 ms a frame on
node 24, five hundredths of a percent of a 16.67 ms budget, against a phase 0
baseline whose heaviest screen has a p99 of 1.02 ms and submits 96 draws. These
are short-lived, same-shaped, young-generation objects.

## What was grafted, and from where

- **R4.2a's CPU cull** (`bounds.ts`), from the callbacks candidate. It is the
  only way to fill R13.12's `culled` honestly, chapter 4's checklist rates it
  required, and 4.7's required fixture (500 rows, 12 visible) is unwritable
  without it. Bounds are conservative by construction: border outset, shadow
  spread plus three sigma, one device pixel of R5.7 inflation, the four-corner
  hull under rotation. They may under-cull and never over-cull.
- **R3.10's per-layer partition** (`layerPartition.ts`), from the same
  candidate, but moved upstream of the backend. R2.22 says the recording backend
  returns "the sorted draw list"; without a sort, chapter 3.12's required order
  tests pass on submission order and stay green when a sort is wrong. Putting
  the partition in the API rather than in a backend means one implementation and
  no two backends that disagree.
- **R2.17 and R2.18's resource surface**, from the buffer candidate.
  `createTexture`, `destroyTexture`, `loadFontAtlas` and `fontAtlasNames` on the
  backend, with `drawText` before its atlas a development-build error. PR 3
  needs this the moment `drawImage` or `drawText` moves onto the API, because
  today's `Renderer` already owns a `FontAtlas`.
- **`measureText` delegated to an optional `DrawBackend.measureText`**, from
  both other candidates. R2.14's requirement is that measurement share
  `drawText`'s glyph iteration (R6.8); hanging it on the backend makes one
  object answer both calls, so they cannot drift. It throws today.
- **`beginFrame({ viewport, ratio })`**, because R4.2a's bounds need R5.7's
  device pixel and R4.1's `none` clip wants the target rect, and changing that
  signature after PR 3 has created every call site is the expensive order.

## Departures from the spec, each deliberate

- **`radius` is a field of `drawRect`, not of `border`.** R2.8 nests it inside
  `border`, which makes a rounded rectangle with no border inexpressible, and
  every `Panel` in this codebase is exactly that. R5.3 lists the corner radii
  beside the border colour rather than inside it and R5.5 treats them as the
  rectangle's own. No alias and no shim.
- **R2.13's `transform` is `textTransform`.** It is R6.9's uppercase-before-
  measurement, not a matrix, and a field called `transform` beside R2.4's
  transform stack is a footgun.
- **A shadowed text run emits two groups.** R2.8's parenthetical names only the
  rectangle; R3.17 requires the same of text and chapter 3 is normative on
  order. Both carry `group: 'shadow' | 'primary'` and both count in `apiDraws`.
- **`pushLayer` takes `max(requested, current)` and reports a lowering push.**
  R2.7 read alone says "sets". R3.6 states the invariant as an outcome ("a
  subtree never paints beneath its own ancestor's layer") and 3.12 requires one
  test to see both halves at once, and the ordinal is stamped here, so this is
  the only place the invariant can be guaranteed. R2.7's own example of a direct
  caller, a targeting line pushing `overlay`, is a raise.
- **`pushClipReset()` exists and chapter 2 names no such call.** R3.8 and R4.8
  require promotion to reset the inherited clip and change nothing else. It
  cannot fold into `pushLayer`, because R2.7 lets a direct caller raise a layer
  without promoting a subtree. Worth raising against the spec.
- **`apiDraws` counts groups emitted, not calls made.** R13.12 defines it as
  "draw-API calls, equal to draw groups plus shadow groups", and the two halves
  disagree for a culled draw. The equation is the tiebreak: a culled draw
  produced no group. `apiDraws + culled` is the number of groups the frame asked
  for, and a test asserts it.
- **R2.1's "errors in development builds" are recorded diagnostics, not
  throws**, unless the caller passes `strict`. A throw inside the tree walk
  abandons the frame with its stacks half-unwound, turning a report about one
  bad call into a blank screen. One policy, applied to all twenty entry points
  in both build modes, and both modes are tested.
- **Backends live in `src/renderer/engine/draw/` and the interface is named
  `DrawBackend`.** The phase 1 recon note puts them under `engine/gpu/`, but the
  file it names there is the R15.38 seam (render passes, pipeline keys, bind
  groups), which is a lower layer arriving with WebGL2. The name leaves
  `gpu/Backend.ts` free for R15.38 with no collision and no file move.

## What is deliberately not filled

Under R13.5's discipline, a counter carries a number this layer derived or
`null`, never zero standing in for unknown. `occluded` is null because R3.2's
drop is a MAY and is not implemented; zero would claim a coverage test ran.
`gpuDraws`, `vertices`, `triangles`, `instances`, `textureBinds`,
`bytesUploaded` and `splits` come from whoever did the work, so they are null
under a backend that returns nothing and real zeros under the null and recording
backends, which rasterise nothing. R13.14's resource counters are null because
R5.30's resource manager is a later PR. `clipChange` and `shaderChange` read
zero because R13.13 requires them to under this design, and a non-zero value is
the failure the counters exist to catch.

Nothing synthesises a per-draw vertex count. Phase 0 shipped one that read
`5327.999999999999` because it was derived from a byte count, and only a backend
that actually built the geometry reports one here.

## Consequences

- PR 4's batcher inserts as one statement between building the command array and
  submitting it, as a `DrawCommand[] -> DrawCommand[]` function, and every
  backend receives the result with no edit.
- PRs 5 and 6 widen per-draw data by widening a union or adding a field, and the
  compiler propagates it. The recording backend never changes, because it stores
  commands rather than copying fields out of them.
- The hot property access in PR 6's packing loop reads eight command shapes and
  is therefore megamorphic where a scratch object or a typed array would be
  monomorphic. The measured cost at 112 groups does not justify acting on that;
  a 5,000-group stress scene is untested and is the thing that would.
- R4.2a's benefit is only partly realised until chapter 6. A run's extent needs
  R6.8's glyph iteration, so `drawText` is never bounds-culled and a scrolled
  list of labels still submits every hidden run.
