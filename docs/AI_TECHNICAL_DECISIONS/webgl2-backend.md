# The WebGL2 backend: chapter 15's device under the legacy program, without moving a pixel

DDB-63, DDB-55 phase 1. 2026-09-28.

## The problem

After the batcher (#68) and the clip remainder (#69) the live path was `LegacyGLBackend`: a WebGL1
context, `bufferData` on every upload (a reallocation per domain, and WebGL1 has no source range so
each upload also allocated two `subarray` views), two per-program uniforms set through a `Shader`
class that looked up a location on every call, a font atlas made with `texImage2D`, and nothing for
context loss. Chapter 15 sections 15.1 to 15.5 require the opposite on every one of those counts.

The constraint was the one every phase 1 PR has carried: the committed goldens do not move. The
uber shader (DDB-64) and the resource layer (DDB-66) come next and are the PRs that move pixels or
add textures, so this one had to swap the device underneath the batcher and nothing else.

## Options considered

**What the backend draws with.**

A. Write the uber shader's instance encoder now. Rejected: that is DDB-64, it moves pixels
(analytic coverage replaces MSAA, premultiplied output replaces straight alpha), and doing it in the
same PR as the context swap leaves no way to say which one moved a pixel.

B. Keep `LegacyGeometryEncoder` and port the two shader files to GLSL ES 3.00 line for line. Taken.
`attribute` becomes `in` with `layout(location = n)`, `varying` becomes `in`/`out`, `texture2D`
becomes `texture`, `gl_FragColor` becomes an `out vec4`, and `uProjectionMatrix` and `uViewMatrix`
move into a `std140` block. The arithmetic is untouched. Fragment precision went from `mediump` to
`highp` (R15.6); it was measured rather than assumed to be free.

**Stream storage (R5.27, R15.11).**

A. A ring of fixed buffers rotated per flush, at least three per flush per frame. Rejected: flushes
per frame vary (combat has six domains) and each slot would need a whole domain's capacity, about
1.2 MB on the card showcase, so the ring would be tens of megabytes to be safe.

B. One vertex buffer and one index buffer, each written at an advancing offset that wraps only onto
a region two frames old. Taken. `StreamRing` is the arithmetic, GL-free and unit-tested: virtual
positions so "how old is the region I am about to overwrite" is a subtraction. When a frame outgrows
the ring, the backend replaces the buffer at double size and logs it, rather than overwriting a live
region; a ring that grows in steady state is a ring sized wrong, and the warning says so.

There are no fences behind the two-frame rule, on purpose. Two frames is R5.27's number, not one
measured with `fenceSync`, and it does not need to be: on WebGL a `bufferSubData` is ordered in the
command stream, so overwriting a region the GPU is still reading costs ANGLE a copy or a stall and
never draws a wrong picture. The age check is a performance rule, and a fence per frame to prove it
would be a synchronisation cost bought to protect against a slowdown.

Indices are relative to the upload's first vertex (the batcher's contract), so the attribute
pointers move with the upload: seven `vertexAttribPointer` calls per upload, never per draw.
Rewriting every index to be absolute within the ring was the alternative; it is a CPU pass over
every index for nothing a pointer update does not already do.

**Where the clear and the loop control go.** The clear moved into the backend's `beginFrame`, where
R15.38 wants it (a render pass has a clear operation), and both bootstraps lost their
`renderer.clear()` call. Both frame loops became a `FrameLoop`, because R15.5 requires cancelling the
loop while the context is lost and a loop that re-requests itself at the bottom of its body cannot
be cancelled.

## What was measured

Byte comparison of `page.screenshot()` against `main` at `6709f10`, both dev servers side by side in
headless Chrome, each page paused, navigated once and settled the way `tests/visual/support/harness.ts`
does it. SwiftShader at device pixel ratio 1 (the golden configuration): all six reachable screens
and all eight gallery scenes hash identically, including the unbaselined `primitive-shapes`. Hardware
Metal at ratio 2: all fourteen identical once `powerPreference` is set aside (below).

Two attributes of R15.2 were measured to move pixels.

- `antialias: false` changes 12 of the 13 committed chromium goldens and `primitive-shapes`; only
  `scene-rectangles` (whole-pixel axis-aligned rects) holds. The legacy program has no analytic
  edges, so it leans on multisampling. It stays `true` until DDB-64.
- `powerPreference: 'high-performance'` changes every capture on a dual-GPU Mac, because it selects
  the discrete GPU. That is a hardware difference, not a rendering one: SwiftShader has one device and
  the goldens cannot see it. It is kept, as R15.2 says.

Everything else measured free: `depth: false`, `highp`, `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`,
`texStorage2D` plus `texSubImage2D` for the atlas, 32-bit indices, the uniform block, and the rings.

Context loss, driven with `WEBGL_lose_context` on the combat screen: the frame counter stops, the
status line appears, and after `restoreContext` the loop resumes and the screenshot hashes the same
as before the loss. `tests/visual/web/contextLoss.spec.ts` asserts that against the committed combat
golden.

## Decision

- `rendering/WebGL2Backend.ts`: the backend, `createDrawApi`, `windowFrame`, `scissorBox`, and
  `LEGACY_PROGRAM` (sources, stride, attribute table), which is the one object DDB-64 replaces along
  with the encoder.
- `rendering/Renderer.ts`: a WebGL2 context with `CONTEXT_ATTRIBUTES`, `drawingBufferColorSpace =
  'srgb'`, `webglcontextlost` (with `preventDefault`, or no restore is ever offered) and
  `webglcontextrestored`, `addContextListener`, and a DOM status line when the context is missing or
  lost. It no longer holds a shader, matrices or GL state.
- `rendering/StreamRing.ts`, `rendering/FrameLoop.ts`, `rendering/LegacyPaintOrder.ts` (moved out of
  the deleted backend file unchanged), `rendering/program.ts` (`compileProgram`, replacing `Shader`).
- `FontAtlas.upload()`: `texStorage2D` then `texSubImage2D`, called again on restore from the atlas
  canvas, which is the CPU-side copy.
- Per-frame uniforms: three 256-byte-aligned slots (the stride is `UNIFORM_BUFFER_OFFSET_ALIGNMENT`,
  read once at creation), one `bufferSubData` per frame, one `bindBufferRange`. The sampler is set to
  unit 0 once at program creation, since GLSL ES 3.00 has no `layout(binding)`.
- Synchronous queries (link status, block index, alignment, the sampler location) happen at creation
  and restore only. `WebGL2Backend.test.ts` runs frames against a recording context and fails on any
  of R15.22's calls, on `bufferData`, `texImage2D` or a uniform setter inside a frame.
- `DrawBackend.textInk` delegates to the encoder, as the legacy backend's did.
- Blend state and the clear colour are set in `bindPipeline` behind their own dirty flag, so
  `invalidateState` (R2.15) restores them for a foreign pass that changed them, and an ordinary
  frame issues neither.
- On restore, `Renderer` clears its status line only after every listener has rebuilt; a rebuild
  that throws leaves the loop stopped and a "could not rebuild" line on screen.
- `LegacyGLBackend.ts`, its WebGL1 context and `Shader.ts` are deleted.

## Departures

**`antialias: true`** (R15.2, R5.29), above. Dies with DDB-64.

**SRC_ALPHA blending on a premultiplied canvas** (R15.25). Premultiplied output moves pixels and is
DDB-64's.

**The clip is still scissor state** (R4.1). The encoder's `clipIsState` is the seam, unchanged.

**One uniform slot per frame, not per flush** (R15.15 says per flush). The only per-flush state
R5.28 lists is the projection, the target size and the sampler bindings, and today all three are
constant across a frame, so a slot per flush would write the same 128 bytes several times. The
target size and per-flush slots arrive together with render targets.

**R15.3 feature detection and R15.4 `ResizeObserver` sizing are not here.** Neither was in this
task's scope; R15.4 changes how the backing store rounds at fractional ratios, a pixel change of its
own. R15.3 is DDB-186; R15.4 is DDB-66, the resource and coordinate task.

**The R15.38 device seam is not split out.** With one program and one texture there is nothing for a
pipeline key or a bind group to select between; DDB-64 and DDB-66 are the first to need them.

## Consequences

**`primitive-shapes` still has no golden, for a new reason.** The overrun DDB-103 was filed for is
gone (nothing calls `bufferData` in a frame, and the scene's console is clean), and circles, triangles
and convex polygons are correct. The star is not: `Polygon` triangulates with a fan from vertex 0,
which is wrong for a concave outline, so the fill spills outside it. Byte-identical on `main`, so it is
the component, not the backend. DDB-185; `scenarios.ts` points there now.

**The "GPU stall due to ReadPixels" warnings are still there**, four per page load under SwiftShader,
on this branch and on `main`. They fire once per GPU process (so only the first page of a browser
shows them), which is also why comparing two captures in one browser suggests they are gone when
they are not. The likeliest source is the first sample of the atlas texture uploaded from an
accelerated 2D canvas; the atlas is replaced by chapter 6's MSDF atlases (DDB-70), which are images.

## How the legacy half dies

Done in DDB-64; see [uber-shader.md](./uber-shader.md). What was planned: with DDB-64, delete `LegacyGeometryEncoder.ts` and its test, `LEGACY_PROGRAM`, the two files under
`src/assets/shaders/`, the `topologyChange` split reason, and `CONTEXT_ATTRIBUTES.antialias`'s
exception; set `clipIsState: false`. The rings, the uniform ring, the vertex array, `FrameLoop`, the
loss handling and `Batcher` stay. `LegacyPaintOrder` goes earlier, with `legacyTextOrder`, in the
ordering re-baseline.
