# DDB-55 phase 1: recon map

Working notes from the ddb55-phase1-recon workflow (2026-09-09). Not a spec. The spec is
docs/ui-rendering-spec/ and docs/specs/ui-rendering-engine-implementation.md section 6, "Phase 1:
draw core". Where this note and the spec disagree, the spec wins and this note is wrong.

Everything below marked with a file:line was read on this branch. Three things were measured live
against a dev server on port 9077 and are marked as such. Two claims inherited from earlier
sessions turned out to be wrong and are corrected in place; one more is marked unconfirmed.

## The split, and why

**Chosen: facade-first, grafted.** Build the seam before the machine. The draw API and the null and
recording backends land first with no consumers, then one commit moves every consumer onto them
behind a `LegacyGLBackend` whose body is today's `Renderer`. After that the batcher, the clip stack,
the WebGL2 context and the resource layer each swap in underneath a seam that is already carrying
the real game and the real gallery, and every one of those PRs makes the same falsifiable claim:
the goldens do not move. Only the last two move pixels, and each moves them for one reason.

Two grafts onto that spine:

- From the primitive-slicing proposal: `Circle`, `Triangle` and `Polygon` are imported by exactly
  one file in the whole repo (`src/renderer/game/screens/developer/PrimitiveShapesSection.ts:3-5`)
  and appear in **zero** committed goldens. Verified by opening
  `tests/visual/__screenshots__/chromium/linux/screen-developerScreen.png`: the viewport shot holds
  Interactive Controls, Style Guide and the Back to Menu button and nothing else, and
  `scene-primitive-shapes` is `test.fixme` with no picture at all. So circle mode, polygon feather,
  the CPU triangle absorption and the DDB-103 fix carry no golden risk, and primitive-shapes gets
  its first honest picture rather than a re-baseline.
- From the bottom-up proposal: the recording backend is what section 3.12's *required* tests
  actually depend on, even though R2.22 rates it only SHOULD while R2.21's null backend is the MUST
  (`docs/ui-rendering-spec/02-draw-api.md:53-54`). It lands in PR 2, with the API, not later.

**Why the other two lost.**

Bottom-up (eleven PRs, backend seam through coordinates proven on a dev-only
`public/conformance.html`, then one cutover) loses on the ground rule it bends hardest. For eight
merged PRs the repository would hold two complete renderers, the old one drawing every screen and
the gallery, the new one drawing only a fixture page written to be thrown away. Nothing selects
between them at runtime, so it does not violate the letter, but "each PR replaces one layer
wholesale behind an API that the next PR deletes"
(docs/specs/ui-rendering-engine-implementation.md:29) would be true of one PR out of eleven, and
that one PR is the first moment anyone learns whether the seam designed in PR 2 fits the batcher
written in PR 7. Its readPixels fixtures are genuinely the best proof of the chapter 5 rules on
offer, and that idea survives here as PR 10's gallery fixtures.

Slice-by-primitive (rectangle plus the whole spine in slice 1, then circles, polygons, viewport,
text) loses on PR size. Its own objection is right: slice 1 is roughly sixty percent of the phase
and is not a slice, it is the engine with one primitive attached, and the small attributable PRs it
buys are for the three primitives no screen uses. It also runs two shader programs and two
submission mechanisms in the same frame for four PRs, which is the plainest reading of "no parallel
code paths" even though nothing chooses between them.

## Ordered tasks

Board note before the list: this order deviates from the blockers as recorded. The board has
DDB-65 blocked by DDB-63 and DDB-64, i.e. build bottom-up. Facade-first inverts that for DDB-63:
the draw API and batcher land on the legacy GL body first so the WebGL2 swap can be proved by
"nothing happened". DDB-64 still comes after DDB-63, because nothing in chapter 5 is expressible on
a WebGL1 context. Re-point the blockers before starting, or the board will read as stale from day
one. DDB-65 and DDB-67 both need splitting; two new tasks are needed.

---

### 1. Delete the card showcase double render

**Board: new task needed.** Title: "P1: Delete the card showcase double render". Splinter of
DDB-67's last bullet; file with `discovered_from` DDB-59.

`Screen.render` already calls `this.rootLayer.render()` before `this.onRender()`
(`src/renderer/game/core/Screen.ts:161-169`), and `CardShowcaseScreen.onRender`
(`.../card-showcase/CardShowcaseScreen.ts:308-310`) calls it a second time. It is the only
`onRender` override in the game that does. Deleting the body takes the largest draw number in the
committed baseline from 96 to 48 and the vertex count from 15736 to 7868 before any batching.

Depends on: nothing. First because it is one line, one cause, one screen, and it is the only pixel
change in the phase whose diff a reviewer can attribute without reading anything else.

Files to edit:
- `src/renderer/game/screens/card-showcase/CardShowcaseScreen.ts:308-310` (delete the override)
- `tests/visual/__screenshots__/{chromium,electron}/linux/screen-cardShowcaseScreen.png` (re-mint)

Proved by: the re-minted golden pair and nothing else changing; `npm test`; a perf capture showing
cardShowcaseScreen at 48 / 7868 / 1928.

**Moves pixels: NO.** Measured, three ways, after this note's first draft claimed the opposite.

The first draft reasoned from the blend arithmetic that a second identical pass must darken every
anti-aliased glyph edge, and predicted a diff far over `maxDiffPixels: 200`. The arithmetic is
sound and its inputs are real: `FontAtlas.ts:70-72` rasterises the atlas opaque so the red channel
carries coverage, `fragment.glsl:16` turns that straight into fragment alpha, `Renderer.ts:53-54`
blends `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`, `TextRenderer.drawText:143-153` pushes without dedupe, and
the atlas really does carry partial coverage (measured in the harness browser: a 32 px Arial run
rasterised the way `generateAtlas` does it gives 2608 partial-coverage pixels against 1375 solid).
The prediction still turned out to be wrong.

What was actually measured, with the override deleted and restored:

- The two captures are the same file. Identical SHA-256, both 79,057 bytes, and a channel-by-channel
  decode gives 0 differing samples of 3,810,240 with a maximum delta of 0.
- The screenshot spec passes with the tolerance forced to `threshold: 0` and `maxDiffPixels: 0`,
  which is exact equality rather than a tolerance being generous.
- Both passes really do reach the GPU, so this is not the second render being skipped:
  `window.__perf.snapshot().renderer` reads `glDrawCalls 96, vertices 15736, textCharacters 3856`
  with the override and `48, 7868, 1928` without it. Exactly halved.

So the deletion is free of pixel risk and PR 1 needs no re-mint, while still halving the screen's
draw calls, which is the phase's actual criterion.

**The mechanism is unexplained and that is recorded rather than papered over.** Every input to the
arithmetic was verified individually and the conclusion is still contradicted by three independent
measurements, so something in the chain does not behave as read. Candidates not yet eliminated: the
UVs `buildVertexBufferForColor` computes may sample only interior texels, so no partial-coverage
texel is ever fetched at a rendered fragment; or the second pass's quads may be discarded somewhere
between `bufferSubData` and rasterisation. The truncation guard is NOT the answer, checked:
`maxCharacters` is 10000 (`TextRenderer.ts:49`) against 3856 used, and no "Max characters reached"
warning appears. Whoever writes the phase 1 text path should find out, because if glyph alpha never
takes an intermediate value at a rendered fragment then this engine has no text anti-aliasing at
all, which is a different and larger finding than a double render.

Shapes are unaffected for the reason the first draft gave: they are opaque, so a fragment written
twice with alpha 1 resolves to the same value.

---

### 2. Draw API surface, null backend, recording backend

**Board: DDB-65, first of three.** DDB-65 as written is "Draw API, batcher, and three-state clip
stack", which is three PRs. Split it.

Chapter 2's whole surface with no consumers: `beginFrame` / `endFrame` / `flush` (R2.1), the four
push/pop stacks (R2.4 to R2.7), the seven draw calls plus `measureText` as named-field option
objects each taking an optional `id` (R2.8 to R2.14), `invalidateState`, `createTexture`,
`loadFontAtlas`, `getStats` (R2.15 to R2.19), plus `NullBackend` (R2.21, MUST) and
`RecordingBackend` (R2.22, SHOULD, and what section 3.12's required tests actually run on).

Depends on: nothing in code. Ordered second because every later PR's tests import it.

Files to create:
- `src/renderer/engine/gpu/Backend.ts` (the R15.38 seam: render passes as objects with attachments
  and clear ops, immutable pipeline keys, bind groups, uniforms only in blocks, async readback)
- `src/renderer/engine/gpu/NullBackend.ts`, `.../RecordingBackend.ts` and their tests
- `src/renderer/engine/draw/DrawApi.ts` and `DrawApi.test.ts`
- `src/renderer/engine/draw/stateStacks.ts` and test

Proved by: Jest only. `jest.config.js` is `testEnvironment: 'node'` with `roots: ['<rootDir>/src']`,
so importability with no DOM is itself the R14.1 assertion: a seam that needs a canvas to construct
fails the suite. Assert R2.1's reset, R2.2's no-modes (there is no text batch to open), R2.4's
translate-only tracking, R2.6's opacity multiply, R2.7's layer stamp, R2.14's shared iteration
between `measureText` and `drawText`, R2.18's dev-build error when `drawText` runs before an atlas
loads, and R2.21's accept-and-count.

Moves pixels: no. Nothing the game imports is touched.

Risk: two API shapes have to be decided here and are expensive to change later. The spec names
`popClip()` and `popLayer()` individually but covers transform and opacity only by "Four stacks, all
saved and restored with push and pop" (`02-draw-api.md:17`), so whether those two pop by an explicit
call or a scope handle is open. And `drawTriangle` (`Renderer.ts:455`) has no counterpart anywhere
in chapter 2; under the delete-legacy convention it must be absorbed into `drawPolygon`, and
`Triangle.ts` is live, so decide that here rather than discovering it at the facade.

---

### 3. LegacyGLBackend, and every consumer moved onto the draw API

**Board: DDB-67, first of two.** Pull the facade bullet to the front of the phase.

`LegacyGLBackend` implements the backend interface with today's `Renderer` body verbatim. The draw
API forwards `drawRect` to `Renderer.drawRectangle` with the same arguments, `drawText` to
`Renderer.drawText` (text still defers to the text batch), `pushClip` / `popClip` to
`enableScissor` / `disableScissor` with the innermost rect. Every consumer moves in this one commit.

Depends on: PR 2. Ordered here because it is the last moment the whole consumer set can be moved
while the thing underneath is still bit-for-bit today's renderer, which is what makes "nothing
happened" a checkable claim rather than an aspiration.

Files to create:
- `src/renderer/engine/gpu/LegacyGLBackend.ts`

Files to edit (the complete consumer set; there are six draw sites and no others):
- `src/renderer/engine/components/Layer.ts:441` (draw), `:445-497` (delete the scissor save and
  restore block whole)
- `src/renderer/engine/components/Rectangle.ts:119-127`
- `src/renderer/engine/components/Circle.ts:97`, `Triangle.ts:82`, `Polygon.ts:144`,
  `Text.ts:250`
- `src/renderer/engine/ui/Panel.ts:302-305`, `:319-360` (same scissor block, second copy)
- `src/index.ts:113-121` (frame brackets), `src/gallery/index.ts:139-153` (the second frame loop)
- `src/renderer/game/Game.ts:253-265` and `:280-288`

Proved by: all 26 goldens unchanged in both projects. `tests/visual/web/lint.spec.ts` still zero on
all eight scenes with `MIN_NODES` intact and the per-scene evaluated counts from
`perf-results/phase0-gallery-lint.json` unmoved (sibling pairs 21, 153, 36, 15, 45, 190, 91, 4).
`npm test`. A perf capture with draw counts unchanged.

Moves pixels: no.

Risk, three of them and the third is the one that bites.

(a) The gallery has its own frame loop and never touches `Game`. `src/gallery/index.ts:139-153`
calls `beginTextBatch`, `isScissorEnabled`, `disableScissor`, `flushTextBatch` and `endTextBatch`
itself, and `SceneHost` has no renderer reference at all. Brackets placed only in `Game.render`, as
the implementation spec's facade bullet literally says, leave all eight gallery scenes unframed and
the lint and screenshot gates go red at merge.

(b) `Panel.render` never iterates `this.children`. It calls `background.render` then
`contentLayer.render` by hand (`Panel.ts:302-305`, `:341-344`), and `Panel.addChild` redirects into
the content layer (`Panel.ts:178-180`), so a Panel's child array and its rendered children are
different sets. `Card.render` calls `Layer.prototype.render.call(this, context)` (`Card.ts:457-460`),
bypassing its own class chain, so it will not appear in a grep for whatever `Layer.render` becomes.

(c) The five synchronous GL state reads die here and they are not in `Renderer`. They are
`Layer.ts:451` `isScissorEnabled()`, `Layer.ts:453` `getParameter(SCISSOR_BOX)`, `Panel.ts:321` and
`:323` the same pair again, plus `Game.ts:283` `if (this.renderer.isScissorEnabled())` and
`gallery/index.ts:148` the same. R15.22 bans `getParameter` in the frame loop by name and calls the
save-and-restore pattern prohibited. The CPU stack knows the parent rect, so all six go together.

---

### 4. Batcher: draw groups, layer ordinal, per-layer partition, barriers, counters

**Board: DDB-65, second of three.**

One draw group per call, keyed by layer ordinal alone (R3.5, R3.6, R3.14). The per-layer partition
of R3.10, not a comparator sort, with the single-layer fast path as a required conformance row.
`flush()` as the only barrier (R3.20). R13.12 to R13.15 counters, which turn `batcher` in the frame
snapshot from null into its first measurement.

**The legacy backend still issues one GL draw per group.** The old shader takes a unit quad times a
per-draw `uModelMatrix` and a per-draw `uShapeSize` / `uStrokeWidth` for the border branch
(`vertex.glsl:11`, `fragment.glsl:19-38`), so there is no way to pack many rects into one buffer
until the uber shader exists. So this PR changes when and in what order draws are issued, not how
many. **The draw-call number does not move until PR 8.** Say that in the PR description or it reads
as a batcher that does not batch.

Depends on: PR 3, so the batcher is exercised by the real component layer from its first commit
rather than by a fixture its own author wrote.

Files to create:
- `src/renderer/engine/draw/Batcher.ts`, `layers.ts` (the nine-band ladder), `Batcher.test.ts`
- `src/renderer/engine/draw/Batcher.bench.ts` (partition against the comparator sort R3.10 forbids
  by name; outside Jest's match pattern per spec section 5)

Files to edit: `DrawApi.ts`, `LegacyGLBackend.ts`.

Proved by: section 3.12's nine unit tests on the recording backend, landed with the code because the
ground rule requires a PR to carry the tests its rules demand. Group order with mixed layers; the
single-layer domain uploading its submission sequence with no concatenation copy; effective layer as
`max(own, parent)` with the dev-build authoring error; barrier isolation; shadow adjacency;
promotion clearing the clip and nothing else; the children collection still in insertion order; hit
order; determinism. All 26 goldens unchanged.

Moves pixels: no, **if** two temporary constants hold. Both are deleted in PR 9.

Risk. Today's paint order is not "text last", and a temporary text-last ordinal alone does not
reproduce it. `Renderer.enableScissor` and `disableScissor` each flush the pending text batch before
touching GL state (`Renderer.ts:636-643` and `:649-656`), and `Layer` and `Panel` call those during
the tree walk, so on any clipped screen the text submitted before a clip lands *underneath* shapes
drawn after it. Reproducing today exactly needs both: (i) `drawText` stamped with a temporary
`legacyTextLast` ordinal above every band, and (ii) a `flush()` barrier at every `pushClip` and
`popClip`. Barriers are the spec's own mechanism (R3.20 says everything before a barrier paints
beneath everything after), so this is a faithful reproduction rather than a hack, but it is
invisible in review and it looks like a leftover. Name both in the PR description with the PR that
removes them.

Second risk, and it may force this PR to merge into PR 9: today `TextRenderer.flush` groups entries
**by colour** (`TextRenderer.ts:144-153`, `:470-497`), so runs submitted red, blue, red are drawn as
red-red then blue. A submission-order partition emits red, blue, red. Those differ wherever two
differently-coloured text runs overlap. Nobody has checked whether any screen has that. If the
screenshot job comes back red on a text-only diff, this is why, and the answer is to move the
batcher into the ordering re-baseline rather than to invent a colour-grouping sort.

---

### 5. Clip stack with three states, screen-space conversion at push, CPU cull

**Board: DDB-65, third of three.**

`none` / `rect` / `empty` with `empty` never collapsing to `none` (R4.2); nesting as intersection
with unbounded depth (R4.3); conversion to screen space through the current transform at push, with
the dev warning when a clip is pushed under a non-translate transform (R4.7); capture at submission
so the sort cannot change it (R4.6); CPU cull of draws whose transformed bounds miss the clip,
counted as `culled`, per text run rather than per glyph (R4.2a); content offset applied before the
clip (R4.9 to R4.11). The legacy backend still lowers the innermost rect to `gl.scissor`; per-draw
clip data arrives with the shader in PR 8.

Depends on: PR 4, because R4.6 says the clip is captured into the draw at submission time, which
needs draw groups to capture into.

Files to create:
- `src/renderer/engine/draw/ClipStack.ts` and `ClipStack.test.ts`

Files to edit: `Panel.ts:36-83` (the `ScrollableContentLayer` cull becomes the batcher's R4.2a
cull), `DrawApi.ts`, `Batcher.ts`.

Proved by: section 4.7's tests, minus the fragment-test row which needs the shader and moves to
PR 8. Intersection and `empty`; `pop` restoring the parent exactly; the 500-row cull reporting the
rest as `culled`; offset before clip keeping the clip fixed while a child at local y 150 renders at
y 50; the hit test rejecting a scrolled-out child. All 26 goldens unchanged.

Moves pixels: no, expected. See the risk.

Risk. The intersect-versus-replace fix is the one place this PR could move pixels, and the reason it
should not is worth writing down because two readers assumed the opposite. Today both clip sites
*replace* rather than intersect: `Layer.ts:485-492` and `Panel.ts:348-359` restore
`previousScissorBox` verbatim, so a clipper nested inside another clipper draws wider than intended.
**No two clipping containers nest anywhere in the app today.** The complete clip site list is
`Panel.ts:121` (scrollable Panels), `CardShowcaseScreen.ts:74-76`, `DeveloperScreen.ts:98-100`,
`BattlefieldLayer.ts:29`, `PlayerHandLayer.ts:45`, `ResourceBarLayer.ts:34`. All three combat layers
are direct children of `rootLayer` (`CombatScreen.ts:468-529`), which does not clip; the developer
screen's sections are Panels that are neither scrollable nor `overflow: hidden`, so they do not
clip; and `NestedPanelsSection` nests visually, not by clip. Let the screenshot job confirm it
rather than asserting it.

Second risk: `treeSnapshot.ts:215-218` derives `clips` from `panel.scrollable ||
panel.getOverflow() === 'hidden'` and intersects by hand, with a comment at `:27-33` saying phase 1
closes the gap. When the real clip stack exists the snapshot must be re-pointed at it in the same
PR, or `window.__ui.tree()` reports a stale clip and `child-outside-parent` and `outside-viewport`
drift silently under a gate that is checked as `count === 0`.

Third: R4.12 has no implementation at all. `InputSystem.ts:262` and `:325` walk a flat registration
list calling `containsPoint`, and `Layer.containsPoint` (`Layer.ts:312`) tests bounds only, so a row
scrolled out of a Panel is clickable today. The clip stack does not fix that by itself; the gate has
to go into the hit-test walk, and the dispatcher is phase 3 (DDB-75). Decide here whether the
scrolled-out-is-not-clickable half of R4.12 ships now or is deferred, and say which.

---

### 6. WebGL2 backend replaces the legacy GL backend

**Board: DDB-63.**

R15.2 attributes, R15.3's three feature detections, context-loss handling (R15.5), fixed-capacity
buffer rings written with `bufferSubData` (R15.11, sized off the measured flush count per R5.27, not
off the literal 3), one VAO per buffer set (R15.14), the std140 per-flush uniform block with
`bindBufferRange` (R15.15), `texStorage2D` plus `texSubImage2D` for the atlas (R15.18, R15.19), and
zero synchronous GL entry points in the frame loop (R15.22).

Depends on: PR 5. Everything above it is already on the seam, so the only claim this PR makes is
that the picture did not change.

Files to create: `src/renderer/engine/gpu/WebGL2Backend.ts`, `bufferRing.ts` + test,
`glState.ts` (JavaScript-side state tracking, since `getParameter` is banned).

Files to delete: `src/renderer/engine/gpu/LegacyGLBackend.ts`, `Shader.ts` (its only job is
`getUniformLocation` per set, `Shader.ts:98-138`).

Files to edit: `Renderer.ts:35` (the context request), `FontAtlas.ts:131-144` (allocation and
pixelStorei flags), `src/index.ts:47-52` and `src/gallery/index.ts:44-46` (both bootstraps).

Proved by: all 26 goldens unchanged, which is the whole claim. The clean-console assertion in every
screenshot spec. DDB-103 closes here: the cause is `Renderer.ts:434-438` calling `bufferData` (not
`bufferSubData`, and `STATIC_DRAW` on a `DYNAMIC_DRAW` buffer) inside `drawCircle`'s stroke path,
which permanently shrinks the shared 8192-byte dynamic buffer to 264 bytes; a fixed-capacity ring
that nothing re-specifies cannot do that. **Confirmed live** on the gallery: the primitive-shapes
scene emits `WebGL: INVALID_VALUE: bufferSubData: buffer overflow` on every frame and the first two
circles render with visible stray geometry, the third clean.

Moves pixels: no, and two constants are held deliberately for one more PR to keep it that way:
`antialias: true` instead of R15.2's `false`, and `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`
instead of R15.25's premultiplied `over`. Name both in the PR description as dying in PR 8. Flipping
either without the analytic coverage ramp would alias every edge for a PR.

Risk. The context type escapes the rendering directory. `Renderer.getContext(): WebGLRenderingContext`
(`Renderer.ts:618`) is public and consumed by `src/gallery/index.ts:45`, `src/index.ts:48`,
`Layer.ts:453` and `:457`, `Panel.ts:323` and `:327`. `WebGL2RenderingContext` is not a subtype of
`WebGLRenderingContext` in lib.dom, so this is a compile-wide change. PR 3 already removed the Layer
and Panel call sites, which is most of why it goes first.

Second: `stencil` must be `false`, because phase 1 implements R4.4's fragment-test clip and not
R4.15's stencil clip. Context attributes cannot be changed after creation, so this forecloses the
stencil path for the rest of the project without recreating the context and every resource. It is a
one-line decision with a permanent consequence.

Third: keep the geometry generation byte-identical. In particular `TextRenderer.ts:360-361` rounds
run origins, and `TextRenderer` stays alive behind the mask mode until phase 2. This PR is buffers,
uniforms, VAOs and the context. It is not the place to rewrite how a quad is built.

---

### 7. Resource layer and coordinate rules

**Board: DDB-66.**

Reference-counted create and destroy with components holding handles only (R5.30), the 2 MB
per-frame upload budget drained oldest-first at `beginFrame` (R5.32), context-loss recovery from the
CPU-side descriptions (R5.33, R15.5). One viewport owner with `ResizeObserver` on
`device-pixel-content-box` and the `Math.round(clientSize * devicePixelRatio)` fallback (R15.4),
`ratio = dpr * uiScale` with `dpr` used for nothing but the backing store (R7.2), projection rebuilt
from the current logical viewport at every flush (R7.4), and the R7.8 / R7.8a snapping helpers.

The card-art texture array and the residency budget are explicitly deferred to phase 6
(implementation spec:74); chapter 5 rates them recommended
(`05-primitives-and-shading.md:95-96`).

Depends on: PR 6. Placed before the shader because the shader's device-pixel constants are computed
at submission from `ratio` (R5.28), and because a dpr change now has to re-rasterise the bitmap
atlas, which `FontAtlas.ts:40-49` captures once in the `Renderer` constructor (`Renderer.ts:58`).

Files to create: `src/renderer/engine/gpu/Resources.ts` + test,
`src/renderer/engine/coords/Viewport.ts` + test, `snapping.ts` + test.

Files to edit: `Renderer.ts:49-50` and `:113-148` (the resize listener and the projection),
`src/renderer/game/core/Screen.ts:58`, `src/gallery/index.ts:56` (three window resize listeners
collapse into one owner).

Proved by: goldens unchanged, since the harness runs at 1440x882 devicePixelRatio 1 where both
R15.4 paths agree. Jest for refcounts, the byte budget, context-loss rebuild, the snapping
arithmetic, and the WebKit fallback path exercised directly, because it is the live path on Safari
and must not be dead code.

Moves pixels: no.

Risk. `SceneHost.resize()` has two guards, no-op on an unchanged size and defer while paused, and
the phase 0 pause and inject contract depends on both. Breaking either turns the screenshot gate red
for a reason unrelated to rendering. Preserve them verbatim under the new owner.

---

### 8. Uber shader, per-draw clip data, premultiplied output

**Board: DDB-64, plus the clip half of DDB-65 that PR 5 could not land.**

Modes `flat`, `rect`, `shadow`, `circle`, `image`, `text`, plus the temporary `mask` for the old
bitmap atlas (R5.2 and implementation spec:72). `sdRoundedBox` with per-corner radii clamped to the
half extent (R5.5, R5.7a). The linear one-pixel coverage ramp `clamp(0.5 - d/w, 0, 1)`, which
replaces `smoothstep` (R5.6). Quads inflated one device pixel past the outermost edge (R5.7). Three
border positions with `inside` as the default and exact-coverage compositing in premultiplied form
(R5.8). Premultiplied gradients (R5.9). Shadows as a preceding quad with three-sigma padding (R5.11
to R5.13). The CPU feather for polygons (R5.17). `antialias: false` and premultiplied `over` (R5.22,
R15.25). And the clip as per-draw data tested on a `highp` `v_pos` varying (R4.1, R4.4), which is
what lets the scissor lowering die.

Depends on: PRs 5, 6, 7. This is the first re-baseline.

Files to create: `src/assets/shaders/uber.vert`, `uber.frag`,
`src/renderer/engine/gpu/instanceLayout.ts`.

Files to delete: `src/assets/shaders/vertex.glsl`, `fragment.glsl`.

Files to edit: `Rectangle.ts:41-43` and `:119-127` (pass the radius that has been parsed and dropped
since day one), `Circle.ts:97-104`, `Triangle.ts:82-90`, `Polygon.ts:144-153`, `Batcher.ts`.

Proved by: the re-baseline, plus section 4.7's fragment-test row as an executable check rather than
a picture, using chapter 4's own normative fixture (`04-clipping.md:51`): at ratio 2 a clip at
logical (10, 10, 20, 20) keeps the device pixel whose centre is (20.5, 20.5) and discards (19.5,
19.5) and (40.5, 40.5), with the same result on an off-screen target of a different size. Lint zero
on all eight scenes. `scene-primitive-shapes` loses its `test.fixme` and gets its first picture.

**Moves pixels: YES, all 26.** Re-baseline one of two.

Risk. This is where the phase spends its pixel budget and it spends it on five causes at once:
radius activating at 35 configured sites, the coverage ramp, the border compositing formula,
`antialias: false`, and premultiplied output. Four notes on what those actually do.

- Radius is dead configuration today and will surprise a reviewer. `Rectangle.ts:41-42` parses
  `style.borderRadius` into `this.cornerRadius`, `Rectangle.ts:96` exposes a setter, and
  `Rectangle.render` (`:119-127`) calls `drawRectangle`, whose signature (`Renderer.ts:291-298`) has
  no radius parameter and whose shader has no radius uniform. `grep -c borderRadius src/renderer` is
  35, spread over 19 files including every Button (5px), every Input (3px) and every Panel (5px).
  The committed `screen-developerScreen.png` shows it: every corner in that picture is square.
- The AA ramp is the exact thing R5.6 forbids: `fragment.glsl:35` is
  `smoothstep(innerEdge - halfPixel, innerEdge + halfPixel, minDist)`.
- Premultiplied output is probably neutral on its own here and is not worth arguing about, because
  it cannot be tested in isolation. Both pages set `background-color: #000` (`public/index.html`,
  `public/gallery.html`) and the GL clear is opaque black (`Renderer.ts:55`), so the compositor's
  `canvasRGB + pageRGB*(1-canvasA)` adds zero however wrong the alpha channel is. It stops being
  neutral the moment anything behind the canvas is not black.
- `antialias: false` removes MSAA from every rasterised edge. Diagonal edges exist only in
  primitive-shapes, which has no golden. Axis-aligned quad edges only change where they are not on
  an integer device pixel at dpr 1, and nobody has counted how many are fractional. Budget for
  movement and let the diff say.

Second risk: R5.4 leaves the instance layout open, and the choice is permanent. The clip can live
inline per instance or behind a `clipIndex u16` into a per-flush uniform block, and the worked
64-byte example has no obvious room for R4.14's rounded-clip SDF parameters. Panels default to
`borderRadius: 5` (`Panel.ts:138`) while the scissor clips square, so children already leak into
panel corners; whether phase 1 ships the rounded clip or accepts the leak is not settled by chapter
4 or 5 and it changes goldens either way.

Third: R5.6 offers `length(vec2(dFdx(d), dFdy(d)))` or a per-draw constant under translate-only
transforms without choosing. This UI is translate-only nearly everywhere and the constant is
cheaper; the two disagree by a fraction of a pixel at any non-uniform scale.

---

### 9. Ordering: delete the temporary constants, fix the reorder sites

**Board: DDB-67, second of two.**

Delete the `legacyTextLast` ordinal and the clip barriers from PR 4. Text joins the ladder, sibling
order becomes R3.12's `stable_sort` by `zIndex`, and the fixed composite order of R3.18 applies.
`TextRenderer.ts` dies with them, along with `beginTextBatch` / `endTextBatch` / `flushTextBatch`.

Depends on: PR 8. This is the ordering re-baseline the ground rules budget, and its code diff is two
deleted constants plus the reorder sites, which is as attributable as a deliberate pixel change
gets.

Files to delete: `src/renderer/engine/rendering/TextRenderer.ts`.

Files to edit: `Renderer.ts:636-696` (the five clip and batch controls go),
`Game.ts:253-288`, `src/index.ts:113-121`, `src/gallery/index.ts:139-153`,
`src/renderer/engine/ui/DeveloperOverlay.ts:129`, plus the reorder sites:
`Card.ts:106` (the name is added before the driver badge at `:199-215`, so the title moves past it),
`src/renderer/game/screens/driver-selection/` deck preview (scroll container or hug sizing),
`DeveloperScreen.ts` panel below the title's line box.

Proved by: the section 3.12 tests from PR 4 now running without the temporary ordinal, and being the
contract. A screenshot pass of every screen and scene per spec 14.6. The second `[visual-baseline]`
mint.

**Moves pixels: YES, all 26.** Re-baseline two of two.

Risk. Ordering alone leaves DDB-28 and DDB-31 wrong in a new way rather than fixed: the driver badge
covers the card title instead of the title painting over the badge, and the deck preview hides
behind the cycle button instead of through it. Spec 14.6 says so explicitly
(`14-testing-and-conformance.md:140`) and requires the intended layout fix recorded in the same
change. Minting goldens without those fixes bakes a new wrong picture in as correct.

Do **not** claim DDB-30 here. Its own description misdiagnoses it; the audit
(`research/04-sibling-engine-audit.md:131-132`) shows both halves are geometry, three text rows at
y 10 / 20 / 30 with 16 / 20 / 14 px text in a 200x40 box, plus a title created without `textAlign`
and then positioned at `centerX`. It is blocked on DDB-71 alone.

Second risk: this PR also decides the `flush` section's meaning. `SECTION_NAMES` is a fixed const
(`FrameTimer.ts:58`) and R13.7 defines `render` as command generation and `flush` as GPU submission
(`13-observability-and-performance.md:20`). Under a batcher those become accurate for the first
time: `render` is the tree walk that submits to the batcher, `flush` is `endFrame`. The names
survive and improve; the *numbers* stop comparing to the phase 0 baseline, and
`DeveloperOverlay.ts:129` prints that line. Say which it is.

Third: keep `renderer.glDrawCalls` meaning GPU submissions and add `batcher.*` alongside rather than
renaming, or the phase 0 baseline stops comparing. `FrameTimer.recordDrawCall` is already one
increment per `drawElements` / `drawArrays` (`Renderer.ts:271`, `:420`, `:445`, `:513`, `:521`,
`:585`, `:593`), which is `gpuDraws`, not `apiDraws`.

---

### 10. Chapter 5 pixel fixtures as gallery scenes, and the phase 1 re-capture

**Board: DDB-68**, minus its test half. The ground rule that a PR lands the tests its rules require
already redistributed section 3.12 into PR 4 and section 4.7 into PRs 5 and 8. What is left is the
fixtures and the capture.

New gallery scenes with new goldens: the coverage ramp against a hairline, the three border
positions, a radius clamped to a capsule, shadow blur and spread including the cubic small-radius
formula, a per-corner gradient premultiplied before interpolation, abutting rects snapped to the
device grid, and chapter 3's own fixture (overlapping stacks with ascending and descending
`zIndex`, a shadowed panel over a busy background, a popup declared inside a scroll container).

Depends on: PR 9.

Files to create: new sections under `src/renderer/game/screens/developer/`, registered in
`sections.ts` so they become gallery scenes automatically (`src/gallery/registry.ts:27` maps
the same list).

Proved by: new goldens minted by the same dispatch, lint zero on them, and the phase 1 perf capture.

Moves pixels: new pictures only; nothing existing changes.

Risk: the re-capture must visit `driverSelectionScreen` fifth, or state which mount state it
captured. DDB-106 makes first mount 49 / 4552 / 1095 and every remount 33 / 4016 / 977, and the
committed baseline row is the remount. A capture that navigates straight there reports a free
16-draw-call win that is a capture-order artefact, and this already made three phase 0 captures
disagree.

## What phase 1 is NOT

**It is not a CPU performance task.** Nothing in `perf-results/phase0-frame-baseline.json` is close
to the budget. `frame.budgetMs` is 16.667 on all 140 samples, `spikesOverBudget` and
`spikesOver2xBudget` are 0 on every sample of every screen, every `frame.histogram` is `[120,0,0,0]`,
and `sanity.framesWithSectionsOverSpan` is 0 throughout. The heaviest screen is card showcase at
p99 1.020 ms, then combat at 0.925 ms; the lightest is battle result at 0.200 ms. Roughly 1.1 ms of
a 16.67 ms budget on the worst screen. A phase 1 PR that claims a frame-time improvement is claiming
noise.

**The draw-call criterion is the real one, and it is far off.** The success criterion is combat
under 40 GPU draw calls per frame at 1440x882 (implementation spec section 8). The baseline is
combat 92 and card showcase 96, and both counts are byte-identical across all 20 samples, which
makes them the only clean comparison in the file (frame figures are rolling 120-frame window
statistics and move sample to sample; combat's worst `maxMs` sample says 4.725 ms against 0.935 in
the last one, so a max quoted without a sample index is meaningless). Roughly half the showcase
number is the double render, which PR 1 deletes for 96 to 48. Combat has no such shortcut. Its tree
is 25 Layer, 72 Rectangle, 113 Text, 1 Button, 1 Panel, measured live, so it is almost entirely the
two primitives that cannot be separated from the spine.

**There is no GPU time in the baseline at all.** `gpu` is five nulls on every sample, not
`valid: false`. Timer queries are R13.16 to R13.20 and phase 7 (DDB-92). Nothing in the baseline
speaks to a GPU budget and no phase 1 proposal should pretend otherwise.

**Three of R13.7's six sections are null by design and phase 1 creates none of them.** `input` is
null because this engine dispatches straight from DOM listeners on the canvas; `layout` is null
because there is no layout phase; `present` is null because rAF is vsync-paced
(`FrameTimer.ts:29-40`). `memory.usedBytes` is null throughout this capture as a documented failure
mode. Do not report a regression or an improvement in any of them.

**`batcher` is null and phase 1 is its first measurement, not an improvement.** R13.12's counters
need a batcher and there was not one. Report `apiDraws`, `gpuDraws`, `culled`, `occluded`, the flush
reasons and the split reasons as first numbers.

**Screen lint is not phase 1's.** The live total after DDB-104 is 1,002 over six screens, of which
roughly 398 are unmeasured text (phase 2 and 3), 291 are content scrolled out of a container
(DDB-85, phase 5), and about 223 of the 245 sibling-overlap rows are composite background
construction hand-rolled in `Card`, `Vehicle` and the screens (DDB-79, phase 3). Screen lint zero is
DDB-91's. Phase 1 should move only the handful of rows its reorder-site fixes touch.

## The golden re-baseline

**Which goldens change, and when.** Three mints, not one:

| PR | Goldens | Cause |
|---|---|---|
| 1 | `screen-cardShowcaseScreen.png`, both projects | double-composited glyph edges removed |
| 8 | all 26, plus `scene-primitive-shapes` minted for the first time | rasterisation: radius at 35 sites, the one-pixel ramp, exact-coverage borders, `antialias: false`, premultiplied output |
| 9 | all 26 | ordering, plus the reorder-site layout fixes |

The ground rules budget one phase 1 re-baseline, "when ordering changes", each its own PR with
nothing else in it (implementation spec:33). This plan needs three, and that has to be agreed rather
than absorbed by whoever picks up DDB-63. The argument for three: all 26 goldens move for at least
four independent causes that have nothing to do with tree order, so the choice is not one
re-baseline versus three, it is three diffs each attributable to one cause versus one diff in which
nobody can say which of six causes moved a pixel. The argument against is that the rule exists and
someone wrote it deliberately. It is the sort of call that belongs to whoever wrote the rule.

Note also that there were already four scheduled, not three: the harness decision doc adds any bump
of the pinned `ubuntu-24.04` runner image to the phase 1, 2 and 4 list
(`docs/AI_TECHNICAL_DECISIONS/visual-golden-harness.md:61-66`).

**The exact procedure.** A local run cannot write a committed golden, by three separate gates.

1. `snapshotPathTemplate` is `{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}`
   (`playwright.config.ts:104`) and only the `linux` directories are tracked, so a win32 or darwin
   run writes a path git does not see.
2. `playwright.config.ts:76-81` throws on any argv beginning `-u` or `--update-snapshots` unless
   `VISUAL_BASELINE_RUNNER` is set, and only the dispatch job sets it
   (`.github/workflows/visual.yml:189`).
3. The `baseline-provenance` job fails any PR whose baseline-touching commit lacks the
   `[visual-baseline]` marker (`visual.yml:38-79`).

So: dispatch the Visual workflow with `update_baselines=true` on the branch (`visual.yml:159-167`
checks out `github.ref_name`). It runs `xvfb-run -a npx playwright test --update-snapshots` on
`ubuntu-24.04` and pushes one `Update screenshot baselines [visual-baseline]` commit carrying the
run URL (`visual.yml:186-217`). **Read the `playwright-report-baseline` artifact image by image
before trusting it**, because that run has no second run to disagree with it.

Tolerances are `threshold: 0.01`, `maxDiffPixels: 200`, `maxDiffPixelRatio: 0.0002`
(`playwright.config.ts:154-156`), set by mutation rather than by feel. At 1440x882 the ratio works
out to 254 pixels, so the absolute cap is what binds.

**What the goldens cannot see.** Every screen golden is the pre-first-update frame: `openScreen`
calls `freezeApplication` *before* `navigate` (`tests/visual/support/harness.ts:228-244`). A change
visible only after the first tick appears in no golden. `screen-developerScreen.png` is the
viewport, not the document, and holds only Interactive Controls, Style Guide and the Back to Menu
button; the other six sections including primitive-shapes are below the fold. The developer overlay
is hidden unless F5 is pressed (`Game.ts:215-217`), so it is in no golden either, which means spec
14.6's "developer overlay whose background previously sat under screen text" reorder site is
invisible to the gate.

## Traps

Every trap the readers found or this pass found, with evidence. Roughly in the order they will be
hit.

**The double render IS free, and the reason is not understood.** Measured byte-identical three ways
(identical SHA-256, 0 of 3,810,240 channel samples differing, and the spec passing at
`threshold: 0`/`maxDiffPixels: 0`) while the counters halve from 96/15736/3856 to 48/7868/1928, so
both passes reach the GPU and change nothing. The blend arithmetic says that is impossible. Until
someone explains it, treat any claim about how this engine anti-aliases text as unverified: if a
glyph fragment never takes an intermediate alpha, there is no text anti-aliasing here at all.

**A beginFrame placed only in `Game.render` breaks the gallery.** `src/gallery/index.ts:139-153`
drives the renderer directly and never touches `Game`; `SceneHost` has no renderer reference.
Eight scenes go unframed and the lint and screenshot gates go red.

**`Panel.render` never iterates `this.children`.** `Panel.ts:302-305` and `:341-344` call
`background.render` then `contentLayer.render` by hand, and `Panel.addChild` (`:178-180`) redirects
into the content layer, so a Panel's child array and its rendered children are different sets. Any
refactor that makes the parent walk children silently drops the panel background.

**`Card.render` bypasses its own class chain.** `Card.ts:457-460` is
`Layer.prototype.render.call(this, context)`. Changing `Layer.render`'s contract changes Card
without Card appearing in a grep for the changed method.

**The five synchronous GL state reads are in `Layer` and `Panel`, not `Renderer`.** `Layer.ts:451`,
`:453`, `Panel.ts:321`, `:323`, plus `Renderer.ts:662`, consumed again at `Game.ts:283` and
`gallery/index.ts:148`. R15.22 bans `getParameter` in the frame loop and names the save-and-restore
pattern prohibited. They all die with the clip stack, in one PR.

**A clip change is currently a flush, which R3.20 forbids twice over.** `Renderer.ts:638` and `:651`
flush the pending text batch before touching scissor state, and `Layer.ts:467`, `:487`, `:495` and
`Panel.ts:338`, `:350`, `:358` call those during the tree walk. That is why the phase 0 `flush`
section under-reports: `developerScreen` shows `flush.maxMs` 0.005 while drawing 177 characters and
`splashScreen` shows 0.040 while drawing 37.

**Today's order is not "text last".** Because of the flush above, on any clipped screen the text
submitted before a clip lands *underneath* shapes drawn after it. A temporary text-last ordinal
alone does not reproduce today; the clip barriers are the other half.

**Today's text is grouped by colour, which is itself a reordering.** `TextRenderer.ts:144-153` keys
a Map by `color.join(',')` and `:470-497` emits one draw per colour group. Runs submitted red, blue,
red are drawn red, red, blue. A submission-order partition will not reproduce that where two
differently-coloured text runs overlap. Unchecked.

**The first rendered frame of every page load is immediate-mode text.** `Renderer.beginTextBatch`
(`:669-673`) no-ops against a null `TextRenderer`, which `drawText` creates lazily (`:320-323`), so
frame one issues one GL draw per glyph. **Measured live: 39 draws for the splash screen's 37
characters plus 2 shapes, against 4 thereafter.** Any draw-call assertion taken on an early frame
reads wildly high.

**`Rectangle.cornerRadius` is write-only dead state.** `Rectangle.ts:13`, `:41-42`, `:96` set it;
`Rectangle.render` (`:119-127`) calls a method with no radius parameter (`Renderer.ts:291-298`) and
a shader with no radius uniform. 35 sites over 19 files. The change is invisible in review because
every call site already looks correct.

**`fontWeight` is the same trap, bigger, and it is phase 2.** 32 production declarations, none read:
`Text.applyTextStyle` (`Text.ts:46-68`) handles fontSize, color, textAlign, verticalAlign,
lineHeight, whiteSpace and textOverflow and stops. It sits in the same Style objects as
`borderRadius`. A general "make Style apply" pass in phase 1 bolds 32 sites outside the scheduled
re-baseline.

**DDB-107 is phase 4, not phase 1.** `Button` never forwards `options.style.fontSize`, so five
MainMenuScreen style blocks are dead configuration. Patching it moves every button label in the
game, which is the phase 4 re-baseline. Folding it into phase 1 makes both changes unattributable.

**`setBackgroundColor` on a `Rectangle` does nothing.** `Layer.ts:416-419` sets a field read only at
`Layer.ts:436-441`, and `Rectangle.render` overrides `Layer.render` and draws `this.fillColor`. The
developer screen's colour control is wired to it (`InteractiveControlsSection.ts:78` and `:128`), so
it is already broken. If a later phase unifies the fill fields, that control starts working and the
developer-screen golden changes.

**DDB-103 is not a sizing bug.** `Renderer.ts:434-438` calls `bufferData`, not `bufferSubData`, and
`STATIC_DRAW` on a `DYNAMIC_DRAW` buffer, inside `drawCircle`'s stroke path, permanently shrinking
the shared 8192-byte dynamic buffer to 264 bytes. Bumping `maxDynamicVertices` (`Renderer.ts:26`)
fixes nothing. Confirmed live: the overflow warning fires every frame and the first two circles
render with stray geometry.

**Circle, triangle and polygon strokes are silently hairlines.** `Renderer.ts:443-444`, `:519-520`,
`:591-592` set `gl.lineWidth` and draw `LINE_STRIP` / `LINE_LOOP`; ANGLE clamps line width to 1.
`borderWidth` on those three components starts meaning something for the first time when the CPU
feather lands, in the one scene that uses them.

**Circle, triangle and polygon leave shader state dirty.** They set `uColor` and `uUseTexture` but
never reset `uStrokeWidth` (compare `Renderer.ts:399-401` with `:206-212`), and they leave
`aTexCoord` disabled so `vTexCoord` is constant (0,0). If the previously drawn rectangle had a
border, the fragment shader's stroke branch paints the whole shape in that stroke colour. Their fill
is already draw-order dependent, so changing draw order can change pixels where no geometry changed.

**`Rectangle` passes `borderWidth` even with no border colour.** `Rectangle.ts:125-126` sends it
unconditionally and `Renderer.ts:207` substitutes black. Turning on real border rendering surfaces
black borders wherever a site set a width without a colour.

**`Renderer.getContext()` leaks the raw context type app-wide.** `Renderer.ts:618`, consumed by
`gallery/index.ts:45`, `index.ts:48`, `Layer.ts:453`, `:457`, `Panel.ts:323`, `:327`.
`WebGL2RenderingContext` is not a subtype of `WebGLRenderingContext` in lib.dom.

**Both bootstraps construct `Renderer` positionally.** `index.ts:37` and `gallery/index.ts:39` are
`new Renderer('game-canvas', this.frameTimer)`, against the named-argument convention, and both then
repeat the same six-line setup. Fix both or the gallery diverges.

**Three of the four classes on DDB-67's delete list are already gone.** `ScissorBatcher`, `Texture`,
`Arrow` and `Renderer.drawLine` were removed by DDB-62. What survives to delete is `TextRenderer`,
`Shader`, the two shader files, and the scissor save-and-restore. The implementation spec's list at
line 78 is stale.

**`Input` is the only consumer of `getFontAtlas`.** `Input.ts:185-197` uses
`fontAtlas.measureText` for caret placement. That single call keeps `FontAtlas` on the public
surface after phase 2 deletes the rest of the text path.

**The lint gate is satisfiable by measuring nothing.** `tests/visual/web/lint.spec.ts:60-63` says the
empty case was demonstrated rather than imagined; `MIN_NODES = 4` (`:76`) is the only thing catching
it, and it is deliberately loose. Any change to the tree walk, to `parts` versus `children`, or to
how bounds are derived shows up here as a `MIN_NODES` failure or a silent zero that means nothing.
The real floor is the per-scene evaluated counts in `perf-results/phase0-gallery-lint.json`.

**The batcher removes an accidental safety net the lint was relying on.** DDB-104's `addPart`
narrowing was survivable partly because today's engine batches all text to one flush, so a
`Rectangle` cannot paint over a `Text` at all: the bug is unrepresentable rather than uncaught. That
cover expires with the batcher, in the same PR whose goldens are being re-minted.

**`perf-results/phase0-layout-lint.json` is a dated record, not a live before.** Captured 2026-09-08
at devicePixelRatio 1.25 while everything else runs at 1, predating DDB-104, and its eight scenarios
sum to 1,633 rather than the 1,002 the log reports for six screens. Re-capture at dpr 1 rather than
citing either number.

**Combat's lint is not run-to-run stable after a card is played.** 72 of its 355 rows differed run to
run in the phase 0 baseline
(`docs/AI_TECHNICAL_DECISIONS/visual-golden-harness.md:111-112`). Repeat runs before claiming a
delta on that state.

**DDB-106 will fake a 16-draw-call win.** Driver selection draws 49 on first mount and 33 on every
remount. Visit it fifth or say which state was captured.

## Open, not resolved

- **RESOLVED: the double render is pixel-neutral.** Settled by running it: byte-identical captures,
  0 differing channel samples, and exact equality at zero tolerance, while the counters halve. The
  earlier session was right and this note's first draft was wrong. PR 1 needs no re-mint.
- **NEW, and it replaces that one: why is it pixel-neutral?** Every input to the blend arithmetic
  was verified and the arithmetic still gives the wrong answer. If glyph fragments never take an
  intermediate alpha then this engine has no text anti-aliasing, which changes what phase 2 is for.
  Worth an hour before PR 8 designs the text path.
- **RESOLVED WHILE WRITING THIS: the prohibited state save-and-restore is live and stalling the
  GPU.** The card showcase logs `GPU stall due to ReadPixels` four times per load, and it is the
  application rather than the harness: the warnings appear with no screenshot taken and no
  `getImageData` call anywhere in the run. The caller is
  `renderer.getContext().getParameter(renderer.getContext().SCISSOR_BOX)` at
  `src/renderer/engine/components/Layer.ts:453` and `src/renderer/engine/ui/Panel.ts:323`, once per
  clipped container. R15.22 does not merely ban this in passing, it names the pattern: "Worldsim's
  planet renderer and render-to-texture path wrap their passes in `glGetIntegerv` save and restore;
  that pattern is prohibited here" (`docs/ui-rendering-spec/15-backend-webgl2.md`, R15.22). So the
  clip stack task is not only replacing scissor with per-draw clip data, it is deleting a
  measurable synchronous stall, and PR 5 should quote this warning disappearing as its evidence.
  It is invisible to the harness today because `expectCleanConsole` only fails on `error` and
  `pageerror` (`harness.ts:142-151`), and a driver stall notice is a `warning`.
- **Whether PR 4 is really pixel-neutral.** It depends on no two differently-coloured text runs
  overlapping anywhere, because today's per-colour text grouping is a reordering the batcher will
  not reproduce. Nobody has checked. If it fails, PR 4 merges into PR 9.
- **The re-baseline budget.** Three mints against a written budget of one. Needs a decision from
  whoever wrote the ground rule, not from whoever picks up DDB-63.
- **`expectCleanConsole` is narrower than its own comment.** It fails only on
  `message.type() === 'error'` and `pageerror` (`harness.ts:142-151`, `:274-276`). The DDB-103
  overflow surfaces as a **warning** in Chromium, so the console gate would not have caught it and
  the reason primitive-shapes is `test.fixme` is the corrupt pixels, not the console. Whether
  Playwright maps a WebGL `INVALID_VALUE` console message to `warning` or `error` was not checked.
- **The instance layout.** R5.4 deliberately leaves the clip inline-versus-`clipIndex` choice open,
  and the worked 64-byte example has no room for R4.14's rounded-clip parameters. Settle it in PR 8
  and write down why; it is not revisitable cheaply.
- **Rounded clips versus corner leak.** Panels default to `borderRadius: 5` (`Panel.ts:138`) while
  the scissor clips square. R4.14 is only recommended and chapter 12 insets content by the radius
  instead. Either answer changes goldens.
- **`stencil: false` forecloses R4.15 permanently.** Context attributes cannot change after
  creation. Decide once, at DDB-63, and record it.
- **R4.12's hit-test clip gate.** Scrolled-out rows are clickable today
  (`InputSystem.ts:262`, `Layer.ts:312`). The rule is chapter 4's, the dispatcher is phase 3. Decide
  whether phase 1 ships the gate or explicitly defers it; either is defensible, silence is not.
- **The `flush` timer section.** Under a batcher, R13.7's `render` (command generation) and `flush`
  (GPU submission) become accurate for the first time, so the names survive and the numbers stop
  comparing. Decide in PR 9, not after, and move `DeveloperOverlay.ts:129` with it.
- **R13.2's production-exclusion gap.** `FrameTimer`, `beginSection` and the snapshot field names
  ship in production because `Renderer` and the frame loop use them unconditionally. Phase 1
  rewrites both the counters and the overlay's numbers, so it is the natural place to close it, and
  the PR that replaces `renderer.{glDrawCalls,vertices,textCharacters}` with R13.12's counters is
  the one that decides whether the gap widens or closes.
- **Which of the 26 goldens move at PR 8 is reasoned, not measured.** Radius, the ramp and the
  border formula are certain; `antialias: false` depends on how many rect edges are fractional at
  dpr 1, which nobody counted. Show the diff images in the PR rather than asserting a subset.
- **Board hygiene.** DDB-65 needs splitting into three and DDB-67 into two, DDB-63's blocker
  relationship to DDB-65 needs inverting, DDB-68 loses its test half to PRs 4, 5 and 8, and the
  card-showcase deletion needs its own item filed with `discovered_from` DDB-59. None of that has
  been done.
