# The resource layer and the viewport owner

DDB-66 (with DDB-186), DDB-55 phase 1. 2026-09-28.

## The problem

After the WebGL2 backend (#70) two things were still ad hoc. Textures had no owner: `FontAtlas`
made and uploaded its own GL texture, `Renderer` re-uploaded it on a restored context by name, and
`createTexture` on the WebGL2 backend threw. Nothing counted texture memory, nothing metered an
upload, and nothing could say what a lost context took with it. R5.30 to R5.35 want all of that
below the batcher.

And the canvas had three owners. `Renderer` sized the backing store from `window.innerWidth *
devicePixelRatio`, which truncates at a fractional ratio; each `Screen` listened to the window's
`resize` event and read `innerWidth` again; the gallery added a third listener; and both pages
built the frame's viewport from `innerWidth` in `windowFrame()`. At 1.25 a 1153-pixel window got a
1441-pixel buffer mapped over 1153 logical pixels, a ratio of 1.2498 that the snapping, the scissor
and the projection each approximated differently. Chapter 7 wants one owner, R15.4 wants a
`ResizeObserver`, and R7.5 defines the logical viewport from the framebuffer rather than the other
way round.

The constraint was the phase's usual one: the committed goldens are at ratio 1 and must not move.

## Options considered

**Where the texture store lives.**

A. Inside `WebGL2Backend`. Rejected: the font atlas is built by `Renderer` before any backend
exists, the null and recording backends would each need their own copy of the bookkeeping, and
R5.30 says the null backend counts textures, which is the same logic with no GPU.

B. A GL-free `TextureStore` over a three-method `TextureDevice` (allocate, upload, release).
Taken. `gpu/TextureStore.ts` has the references, the queue, the budget and the loss handling;
`rendering/WebGL2TextureDevice.ts` is the only file that calls `texStorage2D`; the null and
recording backends hold a store over `NULL_TEXTURE_DEVICE`. `Renderer` owns the live one because
it owns the context and its loss events. `DrawBackend.textures` replaced `createTexture` and
`destroyTexture` on the seam, and `DrawApi` drives the store's frame, so no backend has to.

**When storage is allocated.** At upload, not at create. A queued texture costs no GPU memory,
`residentTextureBytes` means what it says, and a texture released before its turn never touches
the GPU. An empty texture (no source) is allocated at create, since there is nothing to wait for.

**How the budget treats a texture larger than itself.** The first upload of a frame always goes.
A budget that could starve a 4 MB image forever is a bug, and R5.32's point is one hitch a frame
at most, not none.

**Where uploads bind.** On unit 31, which no draw samples (WebGL2 has at least 32 combined units
and a fragment shader reads at most 16). The alternatives were telling the backend its bindings
were stale after every upload, or restoring the previous binding, which needs a
`getParameter`. A dedicated unit makes an upload between two flushes harmless by construction.

**Where the canvas's CSS size comes from.** The page, not the script. `Renderer.resize` used to
set `style.width` from `innerWidth`, which a `ResizeObserver` on the canvas would then observe: a
feedback loop with one fixed point. Both HTML pages now give the canvas `width: 100%; height:
100%` and `CanvasViewport` only reads the box. At ratio 1 that box is `innerWidth` by
`innerHeight`, as before.

**When a resize takes effect.** At the top of the next frame (R7.3). The observer's callback only
records a pending measurement; `commit()` at the start of each loop tick resizes the backing store
(which clears it, so it happens right before it is drawn), sets the GL viewport, and then tells
the listeners, which is where screens resize their roots and the gallery re-enters its scene.
Resizing inside the callback would clear a frame that had already been drawn and might present
it empty. But observer callbacks run after the update's rAF callbacks, so waiting for the loop
presented one stretched frame per resize step where `main`'s window `resize` event presented none
(measured in review). The pages therefore run a frame straight from the observer
(`CanvasViewport.onPending` calls `FrameLoop.runNow`); that frame commits, resizes, draws and
presents before paint.

**When to trust the device-pixel box.** Only when it agrees with the CSS box times
`devicePixelRatio` to within a pixel. Chromium reports the box from the compositor's real scale
factor, and emulation changes `devicePixelRatio` without changing it: headless at a forced ratio
of 2 reports the CSS size, and a headed Retina window forced to 1 reports twice it. Trusting the
box there gave a 720x441 and a 2880x1764 logical viewport respectively (found in review, not by
the goldens, which run headless at 1). On disagreement the CSS size times the ratio, rounded, wins;
the resolution-change path offers the last device pixels to the same check.

## Decision

- `gpu/TextureStore.ts`: handles start at one reference, `retain` and `release` pair, and a
  release inside a frame frees the GPU object at `endFrame`. Sources are queued and drained at
  `beginFrame` oldest first under a 2 MB budget (R5.32); `immediate` is for UI atlases (R2.18).
  On loss every native object is forgotten; on restore each texture comes back from its kept
  source, from `reload()`, or as empty storage if it never had contents, and one with contents
  and neither is reported and counted as lost. `keepSource` is off by default (R5.33).
- `rendering/WebGL2TextureDevice.ts`: `texStorage2D` once, `texSubImage2D` for contents, never
  `texImage2D` (R15.18); colour-space conversion off, premultiplication on for colour DOM sources
  and off for masks and for `Uint8Array` texels, which are premultiplied by contract (R15.19,
  R5.18).
- `FontAtlas` creates its texture through the store as an immediate, kept `mask`, so the restore
  path is the store's and `Renderer` no longer re-uploads it by hand. Its canvas is rasterised at
  the viewport's ratio rather than a fresh `devicePixelRatio` read.
- `DrawApi`: `createTexture`, `retainTexture`, `destroyTexture` (drops one reference),
  `isTextureResident`, and a `texture-not-live` diagnostic that drops a draw of a released
  handle. `getStats` fills `residentTextureBytes`, `pendingUploads` and `evictions` from the
  store and adds the frame's texel bytes to `bytesUploaded`.
- `coords/viewport.ts`: `resolveViewport` (logical = framebuffer / (dpr * uiScale)) and
  `devicePixelsFromCss` (round, at least one pixel). `rendering/CanvasViewport.ts`: the
  `ResizeObserver` on `device-pixel-content-box` with the content-box fallback, the re-registered
  `matchMedia` resolution query, `commit()`, `onChange`, and `frame` for `beginFrame`. `uiScale`
  is honoured by the arithmetic and fixed at 1.
- `windowFrame()` is gone. Both loops commit the viewport at the top of the update section and
  open the frame from `renderer.viewport.frame`; `Screen` lost its window listener and has a
  public `resize(width, height)` that `ScreenManager.resize` forwards from `Game`'s
  subscription; the gallery's host listens to the viewport, with `SceneHost.resize`'s two guards
  (no-op on an unchanged size, defer while paused) untouched; the tree snapshot and both status
  hooks report the owner's logical size.
- `scissorBox` takes the frame's logical height, the same `canvas.height / ratio` division as
  before, now done once by `resolveViewport`.
- `coords/snapping.ts`: `snapToDevice`, `snapTextOrigin` (R7.7), `snapHairlineRect` (R7.8) and
  `snapClipRect` (R7.8a). The legacy encoder's per-glyph `Math.round` goes through
  `snapToDevice` at the frame's ratio, which it now receives at `beginFrame`.
- DDB-186: `rendering/deviceInfo.ts` detects `EXT_disjoint_timer_query_webgl2`,
  `KHR_parallel_shader_compile` and `WEBGL_debug_renderer_info` once, reads the unmasked vendor
  and renderer where allowed, and the perf snapshot carries it as `device` with
  `backend: 'webgl2'` (R15.3, R13.20, R15.31).

## Pixels

None at ratio 1, which is where every golden is. Each change that could move one is an identity
there: `Math.round(x * 1) / 1` is `Math.round(x)` exactly; `Math.round(1440 * 1)` is the old
`1440 * 1`; `fb / 1` is `innerWidth`; the scissor divides the same numbers in the same order; the
atlas canvas is the same size and uploads the same bytes with the same parameters.

What moves at other ratios, and why it is the correction rather than a regression:

- **Fractional ratios** (1.25, 1.5, 1.75 on Windows): the backing store rounds instead of
  truncating, or takes the exact device-pixel box, and the logical viewport is the framebuffer
  divided by the ratio. A window whose CSS width times the ratio is not whole used to be drawn at
  a slightly different effective ratio than everything else assumed; the edge within a pixel of
  the right and bottom borders is where it shows.
- **Ratio 2 and up**: glyphs snap to the device grid instead of whole logical pixels, so text can
  sit on a half logical pixel. Before, every glyph was rounded to a logical pixel and then
  magnified, which is up to one device pixel off at ratio 2.
- **Zoom**: a browser zoom that changes the ratio but not the device pixels now re-divides the
  same framebuffer, where the window `resize` event used to re-derive it from `innerWidth`.

## Departures

**R7.8 hairline and R7.8a clip snapping are functions, not applied.** Both are recommended rather
than required, the legacy program draws borders as geometry rather than as an SDF, and applying
them moves pixels at fractional positions on screens that have them. DDB-64's encoder writes the
rect instance and is where they belong; filed as DDB-188.

**R7.8's threshold.** The rule says a border "at or below 1 logical pixel"; chapter 7's required
test snaps a 1.3 px border at ratio 1 to one row, which the rule as written would not touch. The
helper treats a border that rounds to one logical pixel or less as a hairline, which satisfies the
test.

**Projection per frame, not per flush** (R7.4, R5.28). Unchanged from the WebGL2 backend's
recorded departure: there is one target, so the frame's viewport is every flush's viewport. The
per-flush slot arrives with render targets (R7.13).

**R5.31 texture array and residency budget, R5.34 target pool, eviction.** Phase 6 and phase 7
respectively, as the implementation spec says; `evictions` is a measured zero and
`targetSwitches` stays null because nothing measures target switches until a target exists.

**R7.14's input conversion by `uiScale`.** Input still arrives in CSS pixels, which equal logical
pixels while `uiScale` is 1. The phase 3 dispatcher owns the conversion.

**Screens still read `window.innerWidth` in their constructors and layouts.** Phase 3 moves them
onto the root; they read the same number the viewport reports at ratio 1, and differ by under a
device pixel otherwise.

**The bitmap font atlas does not follow a ratio change.** It rasterises once at the ratio it was
built with, as before. Chapter 6's distance-field atlases (DDB-70) replace it and do not need to.

## Consequences

Texture memory is accounted from the store's own allocations (R15.30), and a lost context is
survivable for anything that says how to come back. Art that arrives with phase 6 has its queue,
budget and loss handling already; what it adds is the array, the packer and eviction.

A resize is one path: `ResizeObserver` or `matchMedia`, pending, committed at a frame boundary,
heard by the GL viewport first and the screens second. Nothing in the engine reads
`devicePixelRatio` except `CanvasViewport`.
