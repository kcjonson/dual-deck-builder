# 15. Backend notes: WebGL2 (browser and Electron)

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Everything the abstract chapters require is available in WebGL2. Nothing worldsim's renderer uses is blocked (vertex array objects, 32-bit indices, instancing, derivatives, integer attributes, uniform buffers are all core). What differs is cost and defaults: synchronous calls stall through the browser's GPU process boundary, buffer idioms that are free on native drivers are copies under ANGLE, the canvas composites premultiplied, and several capabilities worldsim leans on for tooling (timer queries) are optional in browsers. This chapter is the list of those differences as rules, plus the Electron and testing specifics.

Rules are numbered R15.n. Sources are in the research notes that produced this chapter; the load-bearing ones are the WebGL 2.0 specification's "differences from OpenGL ES 3.0" section, the GLSL ES 3.00 specification, MDN's WebGL best practices, and the ANGLE and Chromium project notes.

## 15.1 Context

- R15.1 The implementation requires WebGL2. There is no WebGL1 path; the sibling engine's WebGL1 context is replaced, not extended.
- R15.2 Context attributes: `antialias: false` (anti-aliasing is analytic, chapter 5), `depth: false`, `stencil: true` only if chapter 4's stencil clip is implemented, `preserveDrawingBuffer: false`, `powerPreference: 'high-performance'`, `alpha: true` and `premultipliedAlpha: true` (the defaults) with the frame cleared to an opaque colour. `alpha: false` is documented by MDN as costly on some platforms and by others as the fastest option; treat it as a measured optimisation, not a default. `drawingBufferColorSpace` is set to `'srgb'` explicitly so token colours are never reinterpreted as Display P3 by a future default; HDR and wide-gamut output are non-goals.
- R15.3 Feature detection at init, once: `EXT_disjoint_timer_query_webgl2` (GPU timer, chapter 13), `KHR_parallel_shader_compile` (non-blocking compile status), `WEBGL_debug_renderer_info` (GPU identity for the snapshot). None is required for rendering.
- R15.4 The canvas backing store is sized from a `ResizeObserver` with `box: 'device-pixel-content-box'` (Chromium and Firefox; WebKit has not implemented it), else `Math.round(clientSize * devicePixelRatio)`, which is the normal path on Safari and is covered by the resize test; `devicePixelRatio` changes are observed through a `matchMedia` query on the current resolution (for example `'(resolution: 2dppx)'`), re-registered whenever it fires. Chapter 7 owns the resulting logical viewport.
- R15.5 Context loss (`webglcontextlost`, `webglcontextrestored`) MUST be handled: cancel the frame loop, recreate every GPU resource from the CPU-side descriptions on restore. Electron blocks 3D APIs per origin after repeated GPU process crashes; the application surfaces that state rather than rendering nothing.

## 15.2 Shaders

- R15.6 GLSL ES 3.00: `#version 300 es` as the first line with nothing before it; `in`, `out`, `texture()`, an `out vec4` colour output; `precision highp float;` in the fragment shader (there is no default fragment float precision, and `mediump` is 16-bit on mobile, which overflows for distances in device pixels above 16384).
- R15.7 Sampler arrays MUST NOT be dynamically indexed; select a texture with a `switch` over a per-draw integer. A `TEXTURE_2D_ARRAY` with a per-draw layer index is the alternative for same-size atlas pages.
- R15.8 Derivatives (`dFdx`, `dFdy`, `fwidth`) are core in GLSL ES 3.00 but undefined within non-uniform control flow (section 8.8 of the specification; the sentence about returning zero concerns constant-expression initialisers, a different case). Compute every derivative-dependent quantity (the anti-aliasing footprint, the distance-field range) before the `switch` on the primitive mode and pass it in; a per-instance branch is uniform across a 2x2 fragment quad in practice, but the specification does not promise it.
- R15.9 No `double`, no 64-bit integers, no texel offsets that are not compile-time constants, no vertex attribute aliasing. Shader includes are resolved at build time by string concatenation.
- R15.10 Compile and link status are checked once at initialisation (or through `KHR_parallel_shader_compile`), never per frame; a status query is a synchronous stall.

## 15.3 Buffers and submission

- R15.11 Vertex and instance buffers are allocated once at fixed capacity with `bufferData(size)` and written with `bufferSubData` into a ring sized per chapter 5, R5.27 (at least three times the number of flushes per frame, or one large buffer with an advancing offset), never into a region the GPU may still be reading. `bufferData(null)` orphaning is a zero-fill on WebGL, not a free discard.
- R15.12 Element array buffers are separate objects from vertex buffers and are never rebound as the other kind (a D3D11 rule enforced by WebGL). The index `0xFFFFFFFF` (or `0xFFFF` for 16-bit) is primitive restart and MUST never be emitted as a real index.
- R15.13 Instanced quads use `vertexAttribDivisor(index, 1)` on each per-instance attribute, with `vertexAttribIPointer` for packed integer lanes; a unit quad from `gl_VertexID` or a four-vertex buffer with `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, n)`. Attribute 0 is always an enabled array.
- R15.14 One vertex array object per buffer set, bound once per flush; attribute pointers are not re-specified per draw.
- R15.15 Per-flush uniform state (projection, target size, sampler slot bindings; chapter 5, R5.28) lives in a `std140` uniform block with one 256-byte-aligned slot per flush in a ring of the same depth as the vertex rings (R15.11), written with one `bufferSubData` per flush (or all slots at once when the flush sequence is known at frame start) and selected with `bindBufferRange` (offsets aligned to `UNIFORM_BUFFER_OFFSET_ALIGNMENT`, commonly 256 bytes). Nothing is per draw: on ANGLE's D3D11 backend each `uniform*` call dirties and re-uploads a constant buffer. Every uniform block used by a draw MUST be fully backed by a buffer or the draw errors, so a wrong slot offset is a draw error rather than a wrong picture.
- R15.16 WebGL validates index ranges on the CPU at draw time and caches per buffer; keep dynamic buffers small and separate from static ones so validation and cache invalidation stay cheap.
- R15.17 `WEBGL_multi_draw` is Chromium and Safari only and is not relied on; batching by sorted merge (chapter 3) needs one `drawElementsInstanced` per GPU submission anyway.

## 15.4 Textures

- R15.18 Textures are allocated with `texStorage2D` and updated with `texSubImage2D`; a live texture is never re-specified with `texImage2D` (ANGLE recreates both the staging and the device texture). Uploads happen before the frame's first draw or between passes, never mid-flush; a DOM-image upload mid-frame forces an internal program switch and pipeline flush.
- R15.19 Colour textures are premultiplied on upload (`UNPACK_PREMULTIPLY_ALPHA_WEBGL` for DOM sources, or offline) and uploaded with `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE` so the browser does not colour-manage them; distance-field atlases additionally skip premultiplication (chapter 6, R6.4b). UI textures use `LINEAR` filtering without mipmaps unless they are drawn at less than half size.
- R15.20 Atlas ceiling is 4096 by 4096 (supported by every reported WebGL2 device; 16384 by most desktops); use a texture array of pages to grow. At least 16 texture units are guaranteed.
- R15.21 The UI is rendered into 8-bit sRGB-encoded targets and blended as-is (chapter 5, R5.24); `SRGB8_ALPHA8` render targets and sRGB-decoding textures are not used for UI. There is no `FRAMEBUFFER_SRGB` toggle in WebGL, and the default drawing buffer is not sRGB-encoding, so a linear pipeline would need its own target and a final blit.

## 15.5 State and synchronisation

- R15.22 No `getError`, `getParameter`, `checkFramebufferStatus`, `readPixels` to the CPU, `getBufferSubData`, `finish`, or non-zero-timeout `clientWaitSync` inside the frame loop. GPU state is tracked in JavaScript; `checkFramebufferStatus` runs once when a target is created. Worldsim's planet renderer and render-to-texture path wrap their passes in `glGetIntegerv` save and restore; that pattern is prohibited here. The only synchronous entry points permitted in the frame loop are `getQueryParameter` with `QUERY_RESULT_AVAILABLE` or `QUERY_RESULT`, `getParameter(GPU_DISJOINT_EXT)`, and `clientWaitSync` with timeout 0, at most once per pending query per frame, only in development builds with the GPU timer enabled; production builds issue none.
- R15.23 Fences are the only synchronisation. After `fenceSync(SYNC_GPU_COMMANDS_COMPLETE, 0)` the implementation MUST call `flush()` (or pass `SYNC_FLUSH_COMMANDS_BIT` on the first wait), because an unflushed fence may never reach the GPU while the page idles; a fence never signals within the task that created it, so polling starts on the next frame with `clientWaitSync(sync, 0, 0)` or `getSyncParameter(sync, SYNC_STATUS)`; WebGL may clamp any timeout to zero. Readback for in-page screenshots goes through a `PIXEL_PACK_BUFFER`, a fence, and `getBufferSubData` once signalled.
- R15.24 The GPU timer (`EXT_disjoint_timer_query_webgl2`) is available in Chromium and Electron, off by default in Firefox (a privileged-extensions preference) and Safari (a feature flag; verified 2026-09). One `TIME_ELAPSED_EXT` query per GPU submission pass, never nested (the extension permits only one active query), results polled with `QUERY_RESULT_AVAILABLE` at least two frames later and discarded when `GPU_DISJOINT_EXT` is set (chapter 13, R13.16 to R13.19). The fence pattern of R15.23 provides "GPU finished frame N at CPU time T" as `gpu.latencyMs` where the timer is absent; it is not a GPU time.

## 15.6 Compositing and colour

- R15.25 Output is premultiplied and blended with `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` (chapter 5, R5.22); the page compositor assumes premultiplied colour, so straight-alpha output shows dark fringes wherever the canvas is not opaque.
- R15.26 `toDataURL` and `toBlob` de-multiply lossily; the screenshot hook uses the readback of R15.23 or the test runner's page capture.
- R15.27 `desynchronized: true` is not used by default; it trades tearing and a `preserveDrawingBuffer` requirement for input latency and MAY be evaluated for the Electron build with measurements.

## 15.7 Precision and timing on the CPU side

- R15.28 `performance.now()` resolution is 100 µs in a non-isolated page and 5 µs under cross-origin isolation (COOP and COEP headers); Electron controls its own headers and SHOULD enable isolation. `requestAnimationFrame` timestamps are 1 ms and shared by every callback in a frame; frame time is the delta between them (chapter 13, R13.8).
- R15.29 Frame section spans are also emitted as `console.timeStamp(label, start, end, track, group, color)` in development builds so DevTools shows them as a custom track; `PerformanceObserver` subscriptions to `long-animation-frame` and `event` give hitch and input attribution (chapter 13 mapping table).
- R15.30 Memory: `performance.measureUserAgentSpecificMemory()` (Chromium, isolated pages) reports JavaScript and DOM memory only; GPU memory is accounted by the resource layer from its own allocations.

## 15.8 Electron

- R15.31 Hardware acceleration is required for the shipped build; `app.getGPUFeatureStatus()` is logged at startup and the WebGL2 backend is reported in the perf snapshot.
- R15.32 Unthrottled measurement uses the Chromium switches `--disable-frame-rate-limit --disable-gpu-vsync` appended before `ready`. Screenshots use `webContents.capturePage`.
- R15.33 GPU-less CI (Playwright's Electron and Chromium launchers) passes `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` regardless of version; Chromium has deprecated the automatic SwiftShader fallback (removal rolled out from version 137), so without these flags context creation fails headless. Software-rendered pixels differ from hardware output, so screenshot baselines are kept per backend.
- R15.34 The engine issues no `fetch`. Metrics and token JSON are imported as modules (bundled); atlas images are bundler asset modules (`asset/resource` for the web build, `asset/inline` for the Electron renderer build so no runtime file request exists) loaded with `new Image()`. Game data follows the same rule or the main process registers a custom scheme with `protocol.handle`; a packaged Electron page runs from `file://`, where Chromium rejects `fetch` (a known open bug in the sibling project).

## 15.8a Platform adapter details

- R15.39 The browser input adapter listens to Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `wheel`, `contextmenu`) on the canvas with `touch-action: none` and `user-select: none`, never to mouse or touch events, and queues them for the frame-start drain (chapter 9, R9.2). On `pointerdown` it calls `canvas.setPointerCapture(pointerId)` and releases on `pointerup` or `pointercancel`, so moves and the release outside the canvas (or the window, in a windowed Electron build) still arrive and a drag ghost never freezes at the edge; a platform `pointercancel` is delivered to the dispatcher as a cancel. It calls `preventDefault` on `contextmenu` and on `wheel` (registered non-passive). `char` is derived from `keydown` when the key is a single printable code point and neither Ctrl nor Meta is held; IME composition is out of scope for the baseline and MAY use a hidden text element later.
- R15.40 A gamepad is a platform adapter: `navigator.getGamepads()` polled once per frame at input time, the D-pad and left stick mapped to `focusDirection` (chapter 9, R9.26), confirm and cancel buttons to `activate` and `cancel`, and the right stick to a `virtual` pointer; `inputMode` follows the last device used. Components need no gamepad code.
- R15.41 TypeScript projects compile with `strict` on and `lib` including `ES2022` (which carries `Intl.Segmenter`, chapter 6) and, for the platform adapters only, `DOM`. Engine modules MUST be importable and constructible without a DOM so the unit runner needs no browser environment (chapter 14, R14.1).
- R15.42 The development hooks assume Chromium 134 or newer for the six-argument `console.timeStamp` (`long-animation-frame` needs 123); older runtimes, including an old Electron, use `performance.measure` with `detail.devtools` (Chromium 128) or feature-detect and report `null` (chapter 13 mapping table).

## 15.9 Testing in the browser

- R15.35 Unit tests run against the null backend (chapter 2, R2.21) under the project's test runner; no WebGL mock is needed for tree, layout, lint, input, or ordering tests, and the recording backend (R2.22) covers "what was drawn".
- R15.36 Pixel and gallery tests run under Playwright: `page.mouse` and `page.keyboard` for trusted input or the in-page injection API through `page.evaluate`; `toHaveScreenshot` with `maxDiffPixelRatio` and anti-aliasing tolerance; the Clock API (`clock.install`, `pauseAt`, `runFor`) plus the renderer's injectable fixed-step clock for determinism; console capture for the log ring.
- R15.37 The gallery is addressable by URL (`?scene=name`) and exposes `window.__ui`, `window.__perf`, `window.__app`, and `window.__dev` (chapter 13 mapping table) in development builds only.

## 15.10 A WebGPU-ready boundary

- R15.38 The backend interface below the batcher is written so a WebGPU implementation can replace it without touching the batcher: render passes are explicit objects with attachments and clear operations; per-draw GPU state is an immutable pipeline key (program variant, blend, stencil, vertex layout) that the WebGL backend maps to cached state; resources bind as groups (a uniform buffer range plus a texture and sampler set) mapped to `bindBufferRange` and texture units; uniforms exist only in uniform blocks; buffers and textures are fixed-size and sub-updated; all readback is asynchronous; no synchronous error queries. Figma's port reports that restructuring their WebGL layer this way fixed bugs before WebGPU was even attempted.

## 15.11 Limits worth knowing

| Limit | Guaranteed or typical |
|---|---|
| `MAX_TEXTURE_SIZE` | 4096 everywhere; 16384 on most desktops |
| `MAX_TEXTURE_IMAGE_UNITS` | 16 |
| `MAX_VERTEX_ATTRIBS` | 16 (the packed 64-byte instance layout of chapter 5, R5.4 uses about 9, counted per declared attribute) |
| `MAX_UNIFORM_BLOCK_SIZE` | 16 KB on some mobile, 64 KB on desktop |
| `UNIFORM_BUFFER_OFFSET_ALIGNMENT` | up to 256 bytes |
| `MAX_SAMPLES` | 4 everywhere (unused: no MSAA) |
| Timer queries | Chromium and Electron only by default (verified 2026-09) |
| `WEBGL_multi_draw` | Chromium and Safari only (verified 2026-09) |
| Dual-source blending | draft extension only; no LCD subpixel text |

## 15.12 Port risks, ranked

1. Synchronous GL calls left in the frame loop (R15.22).
2. Per-draw uniform updates and buffer orphaning idioms carried over from native GL (R15.11, R15.15).
3. GLSL ES differences: version line, fragment precision, sampler indexing, derivatives in branches (R15.6 to R15.9).
4. Stencil absent unless requested at context creation; a stencil clip silently does nothing (R15.2, chapter 4).
5. Timer queries absent outside Chromium; the perf overlay must degrade (R15.24).
6. Straight-alpha output on a premultiplied canvas (R15.25).
7. sRGB framebuffer assumptions (R15.21).
8. Re-specifying live textures and mid-frame DOM uploads under ANGLE (R15.18).
9. Primitive restart index and index/vertex buffer segregation (R15.12).
10. Device limits: 4096 textures, 16 units, uniform block size and alignment (R15.20, 15.11).
11. Headless CI without the SwiftShader flags (R15.33).
12. `clientWaitSync` clamped to zero; any waiting must be polling (R15.23).

## 15.13 Conformance checklist

| Item | Level |
|---|---|
| WebGL2 context with the R15.2 attributes and context-loss handling | required |
| GLSL ES 3.00 rules of 15.2 | required |
| Fixed-capacity buffer rings, separate index buffers, no orphaning | required |
| Per-frame uniform block via `bindBufferRange` | required |
| `texStorage2D` plus `texSubImage2D`, premultiplied colour uploads, raw distance atlases | required |
| No synchronous GL calls in the frame; fence-based readback | required |
| Premultiplied blending on a premultiplied canvas | required |
| GPU timer with disjoint handling and graceful absence | recommended |
| `ResizeObserver` device-pixel sizing | recommended |
| Electron CI flags and per-backend baselines | recommended |
| WebGPU-ready backend boundary | recommended |
| Cross-origin isolation for timer precision (Electron) | recommended |
