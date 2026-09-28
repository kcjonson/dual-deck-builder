# The uber shader's packed instance layout (DDB-191)

DDB-191, filed from DDB-64, DDB-55 phase 1. 2026-09-28.

## The problem

DDB-64 shipped the uber shader with R5.4's fallback shape: four vertices per quad, 32 float32 per vertex (128 bytes), and six 32-bit indices. A quad cost 536 bytes of upload, and `bytesUploaded` rose 43 percent on every screen. R5.4 SHOULDs normalised 8-bit colours, half-float radii and widths, and per-instance storage, and its worked example is a 64-byte instance.

## Options considered

**Keep four vertices, pack each one.** The batcher's sink would hand out a byte view instead of a `Float32Array` and the vertex would shrink to about 72 bytes (positions, local position, half size and clip stay float32). That is 312 bytes a quad, 42 percent less, with the index stream and DDB-195's element buffer pool unchanged.

**Instanced quads for the SDF modes, a separate path for flat polygons.** The ticket's other option. Two formats means two draw paths, and a polygon between two rects would split the GPU draw, which R5.1's "switching primitive kind MUST NOT change GPU state" rules out.

**One instance per quad for everything, triangles included.** Taken. An instance carries its four screen-space corners, so a flat triangle (R5.17) is an instance whose fourth corner repeats its third: the quad's second triangle has no area and draws nothing. A feather-ring quad is an instance with four free corners. Every mode is one format, one buffer and one `drawArraysInstanced`, and there is no index buffer at all.

## Decision

26 words, 104 bytes, twelve attributes, all with divisor 1 (R15.13). `UBER_INSTANCE` and `UBER_ATTRIBUTES` in `UberGeometryEncoder.ts` are the layout; `uber.vert` builds six vertices from `gl_VertexID` in the order the indexed quads used, (0, 1, 2) and (0, 2, 3).

| words | lanes | type | holds |
| --- | --- | --- | --- |
| 0 to 7 | 8 | float32 | the four screen-space corners |
| 8 to 11 | 4 | float32 | half size and quad extent (SDF modes), or u0 v0 u1 v1 (image, text) |
| 12 to 15 | 4 | float32 | the clip rect (R4.1) |
| 16, 17 | 4 | half float | corner radii; the atlas unit range for text |
| 18 to 21 | 4 x 4 | rgba8, normalised | premultiplied fill at each corner |
| 22 | 4 | rgba8, normalised | premultiplied border |
| 23, 24 | 4 | half float | border width (text: shadow blur), outset, sigma or screen range, opacity |
| 25 | 4 | uint8, integer | mode, texture slot, flags, unused |

What stays float32 is everything the rasteriser or an SDF reads as a position: the corners are the same float the per-vertex layout wrote, and the local position is `sign * extent`, which is exact. Texture coordinates stay float32 too; `unorm16` moves a sample by up to 1/65535 of the texture, a sixteenth of a texel on a 4096 atlas, which a distance field turns into edge movement. The clip is inline (R5.4 allows it at this size) rather than in a per-flush table, which would have saved 12 bytes at the cost of a uniform or texture upload per flush and a lookup in the vertex stage.

The per-corner colours carry R5.9's gradients (extrapolated to the inflated corners on the CPU, as before) and R5.17's per-point polygon colours; a flat fill writes the same four.

`packing.ts` has the conversions. `toUnorm8` rounds the float32 product with 255 to nearest, ties to even, which is what a framebuffer write does, so an opaque colour lands on the byte it always did: 0.3 is 76.5 in float32 and was always written as 76, where `Math.round` would store 77.

### The batcher's contract

`GeometryEncoder` reports instances, not vertices and indices, and declares `instanceWords`, `floatWords` and `verticesPerInstance`. The sink is four typed views of one buffer (float32, uint32, uint16, uint8) and a word offset. `GpuDraw` is an instance range, `GeometryUpload` a byte range. The contract check fills a group with `FENCE_WORD` (0x00ffffff, which no lane can hold: a float32 of 2.4e-38, a half-float NaN, or a premultiplied colour brighter than its alpha) and reports a word left unwritten, the word after the group written, or NaN in a float lane. R13.12's `instances` is live; `vertices` is instances times six and `triangles` a third of that.

### The backend

- One instance ring (`StreamRing`, R5.27), 4 MB. The heaviest screen uploads about 207 KB a frame.
- `IndexBufferPool` is deleted. Nothing reads an element buffer any more, so DDB-195's ANGLE Metal cost (a draw from a freshly written element buffer paying for the whole buffer) cannot come back through this path.
- The attribute pointers move with the upload's ring offset, as before. WebGL2 has no base instance, so a GPU draw that starts partway through an upload (a blend or texture split) points them at its first instance: twelve calls per split, never per draw group. R15.14's letter says pointers are not re-specified per draw; its intent, nothing bound per draw group, holds.
- `WEBGL_provoking_vertex` is set to the first-vertex convention at creation and on restore. Every flat varying is constant across an instance, so the convention cannot move a pixel. Without it the instanced draw cost about 1 ms more GPU time a frame on ANGLE Metal whatever the draw's size (main menu, 71 instances, and combat, 736, both paid it), which fits ANGLE emulating the GL last-vertex convention for non-indexed draws; the mechanism was not confirmed from ANGLE's source.

## What moved

No golden was re-minted. The Screenshots gate passes against `main`'s goldens, and a strict comparison of local captures (`main` against this branch, chromium on SwiftShader, 1440x882) finds every difference at 1 of 255 in one channel, except four pixels at 2 in `scene-shading`. The pixels that move are translucent or partial-coverage ones whose premultiplied colour is not a multiple of 1/255: gradients (their corner colours are quantised), shadows and glows, translucent overlays, and anti-aliased edges. Largest counts: `scene-shading` 42,750 px, `scene-paint-order` 10,732, `scene-clipping` 6,035; every screen under 1,000. The harness's per-pixel threshold (0.01, a neutral shift of 3 levels) does not see them. Half floats move nothing measurable: the radii, widths and blurs in use are small integers or halves, which half floats hold exactly.

`tests/visual/web/uberShader.spec.ts` now points the attributes from `UBER_ATTRIBUTES` and draws instanced, so the chapter 5.10 pixel tests run on the new layout; all pass unchanged.

## What was measured

`bytesUploaded` per frame, identical in every sample:

| screen | before | after |
| --- | --- | --- |
| splash | 18,760 | 3,640 |
| main menu | 38,056 | 7,384 |
| developer | 118,992 | 23,088 |
| card showcase | 1,065,568 | 206,752 |
| driver selection | 486,152 | 94,328 |
| combat | 394,496 | 76,544 |
| battle result | 5,896 | 1,144 |

A quad is 104 bytes instead of 536, 81 percent less. (DDB-191's 1.73 MB for the card showcase predates DDB-70's MSDF text, which drew fewer quads.)

Frame and GPU time, `perf-capture.mjs` on the Radeon Pro 560X (ANGLE Metal), `main` at this branch's base and this branch alternated under a fresh dev server each, two rounds, captures in `perf-results/ddb-191-ab-*`. The machine had other agents' builds and browsers on it (load average 25 to 50), so absolute numbers are high; the interleaving is what makes the comparison fair.

| screen | paced GPU median, main | paced GPU median, branch | paced flush, main | paced flush, branch |
| --- | --- | --- | --- | --- |
| main menu | 2.93, 2.94 | 2.78, 2.79 | 0.10, 0.11 | 0.11, 0.09 |
| developer | 4.65, 4.65 | 4.54, 4.54 | 0.23, 0.32 | 0.19, 0.19 |
| card showcase | 5.81, 5.81 | 5.57, 5.49 | 1.44, 1.34 | 0.88, 0.83 |
| driver selection | 3.92, 3.92 | 3.71, 3.68 | 0.86, 0.63 | 0.41, 0.48 |
| combat | 4.52, 4.55 | 4.33, 4.30 | 1.01, 0.55 | 0.56, 0.50 |

Every screen is 0.1 to 0.3 ms cheaper on the GPU and the flush section (encoding plus the upload) is down by up to 40 percent. Paced frames are 16.6 to 16.9 ms on both sides. The last-vertex captures (`perf-results/ddb-191-last-vertex-*-gpu`) are the evidence for the provoking vertex change: 1.0 ms more on all three screens measured.

Unthrottled frame medians agree within noise on four screens (card showcase 2.19 and 2.38 against 2.50 and 2.14; combat 1.69 and 1.72 against 1.31 and 1.26). The developer screen does not: 1.35 and 1.19 on `main`, 5.88 and 5.44 here. It depends on history. Captured first, the developer screen runs at `main`'s speed on this branch; captured after the main menu it drops into a mode of about 5.5 ms a frame, with the time spent blocked in whichever GL call meets back-pressure. `main` never did in four captures of the same order. A 1 MB or 8 MB ring, 256-byte upload alignment, a 112-byte stride, a per-vertex corner attribute in place of `gl_VertexID`, and the provoking vertex setting each left it in place. It is unthrottled only (paced, the same screen's flush is 0.19 ms and its GPU time lower than `main`'s), and it is DDB-211's to explain on a quiet machine.

## Trade-offs and known limits

- Colours are 8-bit. A translucent colour or a gradient is quantised to 1/255 before blending, which moves such pixels by one level. `unorm16` colours would make that about a four-hundredth of a level at 20 more bytes an instance; R5.4 asks for 8-bit.
- 104 bytes is 40 over R5.4's worked example. Four float32 corners (32 bytes, where the example has a 16-byte rect) buy exact positions under any transform and let flat triangles share the format; the inline clip is the other 12.
- A triangle costs a full instance, and its second triangle is a degenerate one the GPU rejects. Polygons are a handful per screen.
- Six vertex shader invocations a quad instead of four with index reuse. The vertex stage is a few moves.
