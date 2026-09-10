# LegacyGLBackend: moving the old GL path behind the draw seam without moving a pixel

DDB-55 phase 1, PR 3. Landed 2026-09-09.

## The problem

PR 1 shipped `src/renderer/engine/draw/` with no consumers. This PR gives it one, and it has
to do that while the 26 committed screenshot goldens hold still, because the whole claim of the
change is that it is structural. The ordering re-baseline is a separate PR that does nothing else.

Two things stand in the way of "just call the draw API instead".

The old renderer defers text. `TextRenderer` holds runs in a batch and paints them at a flush, and
`Renderer.enableScissor` and `disableScissor` flush before they touch GL state, so within a clip
scope text paints above every shape submitted in that scope, and across scopes shapes paint above
earlier text. R2.2 names this bug in the spec, in the past tense, describing this engine:

> Every draw call is valid at any point between `beginFrame` and `endFrame`; there are no "modes"
> to enter (no separate text batch to begin and end). The sibling TypeScript engine had a text
> batch that opened in the frame loop and flushed on scissor changes, which reordered text above
> every shape drawn in the same clip scope.

The goldens are pictures of that. Fixing it here would move them.

And the frame loop exists twice. `src/index.ts` drives `Game`; `src/gallery/index.ts` drives
`SceneHost`, holds its own `Renderer`, and called the same five text-batch and scissor methods
itself. `SceneHost` has no renderer reference at all. Moving one and not the other breaks seven
gallery screenshots and eight lint specs.

## Options considered

**A. Additive adapter.** `LegacyGLBackend` holds a `Renderer` and calls its existing public
`drawRectangle`, `drawCircle`, `drawPolygon`, `drawText` and scissor methods, one per command. No GL
moves. Smallest diff, lowest retyping risk.

Rejected on the seam. "Nothing outside the backend calls `Renderer.draw*`" would be a convention
rather than a fact: eight public drawing methods survive with no callers, findable by autocomplete,
and the delete-legacy convention in CLAUDE.md says one home for a thing, not two. It also makes the
later PRs worse, because deleting the backend would then delete a delegation layer and leave the GL
where it was.

**B. Move the bodies.** The bodies of `drawQuad`, `drawRectangle`, `drawCircle`, `drawPolygon`,
`drawText`, `triangulatePolygon`, the scissor trio and the text-batch trio move into
`LegacyGLBackend` as private methods keyed off `DrawCommand.kind`, and `Renderer` keeps only what
makes it a device. Roughly 500 of 697 lines leave `Renderer.ts` in the same commit as eight consumer
migrations.

Taken. The risk it carries (a mistyped expression in a large move) is exactly the risk the visual
suite measures, in 35 seconds, over 26 images. The risk option A carries is one no gate measures.

For the ordering hack, two placements were on the table.

**A'. A reserved `legacyText` rung in `LAYER_NAMES` at ordinal 5**, plus a `legacyTextOrder` flag on
`DrawApi` that emits a barrier at every clip push and pop. Text sorts into the reserved rung, so it
lands after every shape in its domain, and `DrawStats.layerCounts.legacyText` makes the hack
measurable.

Rejected. The ladder orders draws by what they mean; this uses it to order draws by what they are
made of, and R3.14 gives the batcher one sort key so both cannot be expressed. It is correct only
because this codebase contains zero `pushLayer` calls: with one, a modal rectangle at ordinal 30
would sort above modal text at ordinal 5, which is the "text invisible under button backgrounds"
incident chapter 3's review log records verbatim. Putting a fake rung in `layers.ts`, the file that
holds chapter 3's normative ladder, is a bad resting state for a reader who has no reason to expect
one.

**B'. Keep the deferral in the backend** as a pure `legacyTextOrder(commands)` that stable-partitions
shapes before text, plus a `legacyTextOrderBarrier(draw)` called from `Layer.render` and
`Panel.render`.

Half rejected, half unnecessary. The barrier is required, but calling it from two permanent files
puts half a temporary hack where it outlives its excuse; the flag on `DrawApi` does the same job and
the consumers never learn the hack exists. And the partition turned out to be dead code, which is
the next section.

## What was measured, and what it changed

Three experiments, all on this branch, all against the full chromium project.

**The reorder function does nothing, so it was deleted.** `legacyTextOrder(commands)` was written,
shipped, and then short-circuited to a no-op: all 21 chromium goldens still passed. The reason is
structural rather than lucky. A text command does not paint where it sits in the array; it queues a
run in `TextRenderer`, and `LegacyGLBackend.flushText` draws all of them at the end of the batch. So
the deferral is already reproduced by keeping `TextRenderer` untouched, and reordering the array
underneath it changes nothing that reaches a pixel. The temporary mechanism is therefore one thing,
not two.

**The barrier is load-bearing, and it is worth exactly three goldens.** With `legacyTextOrder: false`
and no other change, `developerScreen`, `cardShowcaseScreen` and `combatScreen` fail and the other
eighteen chromium specs pass. Those three are precisely the screens that clip. Without the barrier
the whole frame is one domain, so text submitted before a clip survives to the end of it and paints
over content drawn inside the clip.

**No clip nests inside another, in any state a gate captures.** Both clip sites were instrumented to
log whether the scissor was already enabled on entry, and all 14 captured states (6 screens, 8
scenes) were driven: `developerScreen` and `cardShowcaseScreen` push one clip each, `combatScreen`
pushes four as siblings of an unclipped root, every gallery scene pushes none, and every single entry
read `already=false`. That is what makes R4.3's intersection indistinguishable from the old
replace-then-restore today. It is a property of the current screens, not of the design: a new screen
that puts a scrollable `Panel` inside an overflow-hidden layer changes behaviour, correctly, toward
intersection, and nothing will warn about it.

**The four "GPU stall due to ReadPixels" warnings are not the scissor read-back.** This one
contradicts the premise the work started from and is worth stating plainly. The card showcase logs
four of them per load. `getParameter(SCISSOR_BOX)` was assumed to be the cause; the instrumentation
above shows that branch never executes on that screen, because nothing nests. Bisecting instead
found `TextRenderer.flush`: suppressing the text flush drops the count from 4 to 0. `TextRenderer` is
untouched by this PR, so the count after the change is still 4. Deleting the read-back is still
right, because R15.22 names `getParameter` in the frame loop by name and the surrounding
save-and-restore is the exact pattern the rule prohibits, but it buys conformance and dead-code
removal, not the stall.

## Decision

`LegacyGLBackend` is the only file in the codebase that talks to GL drawing code, and every consumer
moved onto `DrawApi` in the same commit.

- `Renderer` keeps the canvas, the context, the resize handler, the projection and view matrices,
  `clear`, `useShader`, `getContext`, `getFontAtlas`, and gains `shader`, `projection` and `view`
  accessors for the backend. It has no drawing methods, no buffers, no `TextRenderer` and no
  `FrameTimer`.
- `LegacyGLBackend implements DrawBackend`, constructed `new LegacyGLBackend({ renderer, frameTimer })`.
  It owns the four buffers, the `TextRenderer`, and the moved bodies.
- Components reach GL through `RendererContext.getInstance().draw`. `getRenderer()` stays for its two
  remaining callers: both bootstraps build a `Shader` from `getContext()`, and `Input` measures a
  caret through `getFontAtlas()`.
- `createLegacyDrawApi({ renderer, frameTimer })` builds the whole seam, and both bootstraps call it.
  `windowFrame()` supplies `beginFrame`'s argument to both. Neither page spells the options itself,
  so they cannot drift.
- The one temporary piece is `DrawApiOptions.legacyTextOrder`, which ends a sort domain at every clip
  push and pop.

## Numeric decisions that exist only to keep the goldens still

**Polygon and Triangle push the box as a transform** (`[w/2, 0, 0, h/2, cx, cy]`) and submit their
normalized points unchanged, rather than pre-multiplying on the CPU. `concat(IDENTITY, m)` is exact,
and the `Mat2D` to `mat4` reshuffle produces the same sixteen floats `mat4.translate` then
`mat4.scale` produced, so the uniform the shader receives is unchanged rather than merely equivalent.
Pre-transforming would move the multiply from float32-on-GPU to float64-on-CPU and could shift a
vertex by a ULP.

**A rectangle's border is keyed off width alone with a black fallback.** `Renderer.drawQuad` stroked
`strokeColor || [0, 0, 0, 1]` whenever `strokeWidth > 0`, so a style with a border width and no
border colour strokes black today. Passing `border: undefined` when the colour is null would have
deleted those strokes.

**`cornerRadius` is not passed as `radius`.** The current fragment shader has no rounded-rect SDF and
draws square corners; sending the radius would describe something the backend does not draw.

**`scissorBox` is the deleted `Layer.ts` expression with its terms renamed**, and it reads
`canvas.height / ratio` rather than `FrameDescription.viewport.height` on purpose, because that is
what the old code measured against. It is a pure exported function with a unit test that asserts it
against the old formula written out longhand, because it is the single most load-bearing line here.

**A polygon's stroke is a separate `drawPolyline` command.** R2.11's `drawPolygon` has no border
field, and the legacy stroke was a `LINE_LOOP` over the fill's own vertices, which is exactly a
closed polyline. The two commands are adjacent in submission order, so fill still paints before
stroke.

**The circle stroke's `bufferData` came across unchanged.** It reallocates the shared dynamic buffer
mid-frame and is DDB-103's overrun. Fixing it here would change what `primitive-shapes` draws in the
commit that claims to change nothing.

**`submit` returns `null`, not a `GpuWork`.** The shape draws could be counted, but the text draws
happen inside `TextRenderer.flush` where the backend cannot see them, so any number would omit most
of a text-heavy frame. R13.5 prefers "nobody counted" to a partial count. `FrameTimer` still receives
every `recordDrawCall` the moved bodies always made, so no displayed number changes.

## What the recording backend now disagrees with

`RecordingBackend.ts` says, about itself:

> A recording backend that sorted for itself would let two backends disagree about what a frame
> looked like, and the required order tests would then be asserting one backend's private behaviour
> rather than the system's.

`LegacyGLBackend` does that from the other end: it paints text after the shapes of the same batch,
and no other backend does. For the life of this PR, R2.22's promise that a test can assert what would
have been drawn and in what order is true of the API and false of the screen. That is acceptable
under three conditions, all met.

No test in this PR asserts paint order through `RecordingBackend` as a claim about pixels;
`DrawApi.test.ts` and `backends.test.ts` assert submission and partition order, which stay true. The
divergence is pinned by a named test rather than described by a comment. And the warning lives in
`LegacyGLBackend.ts`, which gets deleted, rather than in `RecordingBackend.ts`, which does not: a
caveat in a permanent file is a caveat somebody has to remember to remove, which is how a temporary
comment becomes a permanent lie.

## How this dies

    grep -rn "legacyTextOrder" src

Four files, all deletions:

1. `src/renderer/engine/draw/DrawApi.ts`: remove `legacyTextOrder` from `DrawApiOptions`, the
   readonly field, the constructor destructuring, the private `legacyTextOrderBarrier` method, and
   its three call sites in `pushClipInternal`, `pushClipReset` and `popClip`.
2. `src/renderer/engine/rendering/LegacyGLBackend.ts`: remove `legacyTextOrder: true` from
   `createLegacyDrawApi`, and the paragraph in the file header that explains it.
3. `src/renderer/engine/draw/DrawApi.test.ts`: delete the `legacyTextOrder (TEMPORARY)` describe.
4. `src/renderer/engine/components/legacyDrawOrder.test.ts`: delete the file.

Then re-mint all 26 goldens through the CI baseline job (`VISUAL_BASELINE_RUNNER` on a
`workflow_dispatch`, since `playwright.config.ts` refuses a local `-u`), and change nothing else. A
re-baseline commit that also changes behaviour has no way to say which of the two moved a pixel,
which is the whole reason this PR carries the bug forward instead of fixing it in place.

Two things make the deletion hard to half-do. `legacyDrawOrder.test.ts` asserts the exact domain
split being abandoned, so a PR that re-mints the goldens while that file still passes has not removed
the hack. And removing the flag while leaving the barrier calls, or the reverse, does not compile.

Nothing in `Layer.ts`, `Panel.ts`, `Rectangle.ts`, `Text.ts`, `Game.ts` or either bootstrap changes
when it dies, which is the main argument for putting the flag in `DrawApi` rather than at the call
sites. The rest of the legacy path (`Renderer`, `TextRenderer` including its per-colour grouping,
`RendererContext.getRenderer`, `Input`'s `getFontAtlas`) dies later, with the WebGL2 backend and
chapter 6.

## Consequences

**Section timings moved wholesale and are no longer comparable with the phase 0 baseline.** Shapes
used to reach GL at their draw sites inside `render`, so that section held nearly all of the frame's
submission and `flush` held the text tail. Now `render` is the tree walk plus whatever a clip
boundary submits mid-walk, and `flush` is the last domain. No pixel changes and no gate reads the
split. `FrameTimer`'s own doc comment was rewritten to say so rather than leave the old explanation
standing.

**The overlay's draw-call count will fall on the clipped screens.** A draw R4.2a's cull rejects never
reaches `drawElements`, where a fully-scissored rect still issued the call and still counted. The
overlay is hidden by default so no golden shows it, but it is a real change in a number someone may
be tracking.

**`expectCleanConsole` is now a diagnostic gate too.** `onDiagnostic` goes to `console.error` in a
development build, so any R2.1 finding fails 13 screenshot specs at once. That is the enforcement
this PR wants; the two details it makes unforgiving are that `LegacyGLBackend.fontAtlasNames` must
contain the exact string `Text` passes (both are `DEFAULT_FONT` in `rendering/fonts.ts`, R11.8's
`body` role), and that every push must be paired inside the same guard.

**`Screen`, `ScreenManager` and the seven screen subclasses lost a `Renderer` nobody read.** Verified
by grep before the change and by `tsc` after it. `Game` no longer holds one either.

**Frame one now batches text where it used to draw it immediately.** `Renderer` created its
`TextRenderer` lazily on the first `drawText`, so `beginTextBatch` was a no-op on the first frame and
that frame's text rendered unbatched. The backend constructs it eagerly, which is what lets
`fontAtlasNames` answer R2.18 honestly from construction. No capture reaches frame one; every golden
settles over many frames behind `assetsReady` and a two-frame tree comparison.

## What this does not close

- R2.14 still throws. `Input.ts:185` still measures through `FontAtlas.measureText`, which returns
  the width at the atlas's 32 px base with no `fontSize` scaling; routing it through a spec-shaped
  `measureText({ size })` would move the caret and move `scene-input-showcase`. Chapter 6.
- No `shadow`, `line` or `image` command has a legacy body. Nothing submits one; the backend reports
  the kind once to the console rather than dropping it silently.
- R4.2a still exempts text from the bounds cull, so a scrolled list of labels still submits every
  hidden run.
- DDB-103's dynamic-buffer overrun moved with the circle stroke and is unfixed.
