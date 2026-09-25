# 2. The immediate draw API

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

The draw API is the only way pixels reach the GPU from UI code. It is immediate mode: a call describes one thing to draw this frame, returns, and holds no reference to any object. Underneath, calls accumulate into a batch that is sorted and submitted at a barrier or at the end of the frame (chapter 3). The retained tree (chapter 8) is a client of this API, not a replacement for it; game code that wants to draw a health bar or a targeting line calls it directly. This "immediate API, retained implementation" split is worldsim's founding design decision and the pattern the project owner wants kept.

Rules are numbered R2.n.

## 2.1 Frame lifecycle

- R2.1 `beginFrame()` resets the batch, the statistics counters (chapter 13, R13.12), and the state stacks. `endFrame()` flushes whatever is pending. `flush()` may be called between them as a barrier (chapter 3, R3.20). Calls outside a frame are errors in development builds and no-ops in production.
- R2.2 Every draw call is valid at any point between `beginFrame` and `endFrame`; there are no "modes" to enter (no separate text batch to begin and end). The sibling TypeScript engine had a text batch that opened in the frame loop and flushed on scissor changes, which reordered text above every shape drawn in the same clip scope.
- R2.3 The frame is single-threaded from the API's point of view. An implementation MAY build vertex data on other threads internally but the call order seen by the batcher is the submission order of chapter 3.

## 2.2 State stacks

Four stacks, all saved and restored with push and pop, all captured into each draw at submission time (nothing is GPU state):

- R2.4 Transform: `pushTransform(matrix)` concatenates; `pushTranslate(dx, dy)` is the common case and MUST be tracked as translate-only so pixel snapping (chapter 7) stays cheap. On the vertex-quad path vertices are transformed on the CPU at submission; an instanced implementation carries translation and scale per instance and MUST route rotated draws through a per-instance 2x3 transform or through the vertex-quad path; either way the rect-local SDF coordinates are unaffected. The projection is per flush, never per draw (chapter 5, R5.28).
- R2.5 Clip: `pushClip(rect)` in the current local space, converted to screen space through the current transform (chapter 4, R4.7); `pushClipRounded(rect, radius)` where supported; `popClip()`. The stack has the three states of chapter 4, R4.2.
- R2.6 Opacity: `pushOpacity(factor)` multiplies the current factor; every draw's alpha is multiplied by the current value (chapter 3, R3.25).
- R2.7 Layer: `pushLayer(name)` sets the layer key stamped on subsequent draw groups (chapter 3, R3.5); `popLayer()` restores the previous. The tree walk pushes a layer when it enters a promoted subtree. Direct callers MAY push layers too (a targeting line in `overlay`).

## 2.3 Draw calls

Argument shapes are given as named fields; an implementation exposes them as an options object (TypeScript) or a designated-initialiser struct (C++). Every call accepts an optional `id` for inspection and produces one draw group (two for a shadowed rectangle).

- R2.8 `drawRect({ rect, fill, border, gradient, shadow, id })`: `fill` RGBA; `border` `{ color, width, radius, position }` with `position` in `inside`, `center`, `outside`; `gradient` four corner colours; `shadow` `{ color, blur, spread, offset }`. Chapter 5, R5.5 to R5.13.
- R2.9 `drawCircle({ center, radius, fill, border, id })`.
- R2.10 `drawLine({ from, to, color, width, cap, id })`; `cap` is `butt` or `round`. `drawPolyline({ points, color, width, closed, id })` MAY be provided as a convenience over capsule segments.
- R2.11 `drawPolygon({ points, indices, fill, colors, id })`: pre-tessellated triangles in `flat` mode with optional per-vertex colours (icons, vector art, animated meshes).
- R2.12 `drawImage({ rect, texture, sourceRect, tint, slice, id })`: `sourceRect` in texture pixels or UV; `slice` optional nine-slice insets. Chapter 5, R5.18 to R5.20.
- R2.13 `drawText({ text, position, font, size, color, align, verticalAlign, box, letterSpacing, transform, shadow, maxWidth, wrap, overflow, id })`: `box` optional alignment box; when `box` is absent `position` is the alignment anchor and the baseline. Layout of glyphs is chapter 6. Text goes into the same batch as shapes.
- R2.14 `measureText({ text, font, size, letterSpacing, transform, maxWidth, wrap })` returns width, height, line count, and the advance positions needed by a text field caret; it MUST use the same iteration as `drawText` so measured and rendered extents agree (chapter 6).

## 2.4 Foreign draws

- R2.15 Anything that renders outside the batcher (a world renderer, a post-process blit, a video frame) MUST call `flush()` first (chapter 3, R3.22) and MUST leave the GPU state the batcher expects when it returns, or call `invalidateState()` so the batcher rebinds on its next flush. The batcher MUST NOT query GPU state to find out (synchronous state queries stall through ANGLE; worldsim's planet renderer and render-to-texture path wrap their passes in `glGetIntegerv` save and restore).
- R2.16 Foreign draws report their GPU draws, vertices, and triangles into the batcher's counters (chapter 13, R13.15). Blend modes on ordinary draws are per-draw data (chapter 5, R5.22a); a foreign pass is needed only for effects the uber shader cannot express.

## 2.5 Resources

- R2.17 Textures and font atlases are created through the API (`createTexture`, `loadFontAtlas`) and referenced by handle in draw calls. Uploads happen outside the frame or at `beginFrame`, never inside a flush. Textures are uploaded premultiplied (chapter 5, R5.18).
- R2.18 The default font atlases for the three font roles (chapter 11, R11.8) are loaded before the first frame; `drawText` before that is a development-build error, not a silent no-op.

## 2.6 Inspection

- R2.19 `getStats()` returns the chapter 13 batcher counters for the current or last frame.
- R2.20 In development builds the batcher MAY record the draw list of a frame (call, arguments, resolved layer, clip, transform) for a debugger or a test to inspect; worldsim carried an `id` on every draw call for this and never read it back.

## 2.7 Null and recording backends

- R2.21 An implementation MUST provide a null backend where every draw call is accepted and counted but nothing touches a GPU, so the retained tree, layout, lint, and input can run in unit tests without a context. Worldsim's tests rely on draw calls being no-ops when the batcher is absent; make it explicit.
- R2.22 An implementation SHOULD provide a recording backend that returns the sorted draw list so tests can assert what would have been drawn and in what order (chapter 3, required tests). This is the one testability gap worldsim never closed.

## 2.8 Worked example

A health bar drawn by game code in the world-space UI domain:

```
pushLayer('overlay')
drawRect({ rect: bg, fill: tokens.color.bg_inset, border: { color: tokens.color.line_hairline, width: 1, radius: tokens.radius.r_pill } })
drawRect({ rect: fillRect, fill: toneColor('auto', hp / maxHp), gradient: [...] })
drawText({ text: `${hp}/${maxHp}`, box: bg, align: 'center', verticalAlign: 'middle', font: 'mono', size: tokens.fontSize.fs_xs, color: tokens.color.text_bright, shadow: { color: tokens.color.bg_void, offset: [0, 1] } })
popLayer()
```

Three groups in the `overlay` layer, in that order, one GPU draw if the mono atlas is already bound.

## 2.9 Conformance checklist

| Item | Level |
|---|---|
| `beginFrame`, `endFrame`, `flush`; no separate text batch | required |
| Transform, clip, opacity, layer stacks captured per draw | required |
| Rect, circle, line, polygon, image, text calls with the fields above | required |
| `measureText` sharing the draw iteration | required |
| Foreign draws flush first and never trigger GPU state queries | required |
| Null backend | required |
| Recording backend | recommended |
| Draw-list capture for debugging | optional |
