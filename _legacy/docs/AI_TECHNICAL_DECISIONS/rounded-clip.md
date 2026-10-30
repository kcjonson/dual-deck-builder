# The rounded clip in the uber shader (DDB-190)

DDB-190, filed from DDB-64, DDB-55. 2026-10-02. Rules: R4.14 (recommended), R5.3, R5.4.

## The problem

The draw API has recorded R4.14's rounded clip since DDB-65: `pushClipRounded(rect, radius)` puts the innermost rounded clip's rect and radius on the captured clip, outer rounded clips contribute their bounding rect, and two nesting warn once a frame. Nothing read it. The encoder wrote the clip rect and dropped the radius, so a rounded clip drew square, and the `clipping` gallery scene left 4.7's rounded clip out rather than bake a square one into a golden.

R4.14 asks for the clip's SDF parameters as per-draw data and a second SDF on `v_pos` in the fragment stage, anti-aliased over one device pixel, multiplying coverage, with no batch break.

## Options considered

**Inline in the instance.** The rounded rect and radius are five values. As float32 that is 20 bytes on every instance; as half floats relative to the clip rect (offsets clamped to the radius plus a pixel, past which they change nothing inside the clip) it is 10, which still means three new words, 116 bytes against 104. Either way every instance pays, and most draws on every screen have no rounded clip. DDB-191 had just taken the instance from 536 bytes to 104.

**Two words of per-corner radii on the clip rect.** Exact when the rounded rect's corner is the clip rect's corner and when it is a radius or more away; an approximation in between (a square scroll clip a few pixels inside a rounded panel), which is the case worth getting right.

**R5.4's shared table.** Taken. R5.4 already SHOULDs "values shared by many draws in a flush (clip rects and rounded-clip parameters ...) stored once per flush in a uniform block ... and referenced by an index per instance". The instance's fourth mode byte was unused, so the index costs nothing.

## Decision

- `RoundedClipTable` (`rendering/RoundedClipTable.ts`) holds the frame's rounded clips, eight floats an entry: centre and half size, then the radius (clamped to the half extent, R5.5) and three unused lanes, two std140 vec4s. Up to 255 entries, indexed 1 to 255 by the instance's `mode` word, byte 3; 0 means none. The encoder's `begin` asks the table for the draw's index, so every instance of a group carries it. Consecutive draws under one push share its captured `RoundedClip` and are found by identity; an equal clip pushed again is found against the last entry; anything else appends. A radius of 0 gets no entry.
- The table is per frame rather than per flush. Indices never need renumbering between uploads, and entries are only ever appended, so an entry a draw has already been issued against is never rewritten.
- The table lives in the frame uniform block behind the projection (`UBER_FRAME_BLOCK`; `uber.vert`'s `Frame` gains `vec4 uRoundedClips[510]`). The block was already a three-slot ring selected by `bindBufferRange`; a slot is now 8,448 bytes instead of 256 (8,224 of block, aligned). The backend writes the projection at `beginFrame` as before, and before each upload's draws appends whatever entries the encoder added since the last one, one `bufferSubData`, usually none. The bytes count toward `bytesUploaded`.
- The vertex stage reads the entry when the index is non-zero and passes it down as two flat varyings, (centre, half size) and the radius, negative for none. The fragment stage, after the rect test, evaluates `sdRoundedBox` on `vPosition` and ramps it over one device pixel, the length of `vPosition`'s screen derivative, taken with the others before any discard. The result multiplies colour and coverage, so R5.23's coverage discard applies to it as to any other edge. Every mode goes through it, text included.
- The clip rect is still the intersection of every clip, and is still tested first with R4.4's half-open rule. Inside a rect on the device grid (R7.8a snaps it at push), the first pixel in from a straight edge has its centre half a device pixel inside the rounded rect, where the ramp is already at full coverage, so straight edges keep exactly the pixels they kept and only the corners change.
- `pushClipRounded` under a scale now scales the radius into screen space with the rect, by the smaller axis scale, so the combat stage's scaled tree rounds the way it looks. Under a translation the radius is unchanged. Under a non-uniform scale the true corner is an ellipse and the clip's is a circle at the smaller scale, so along the longer axis the clip under-clips: content shows slightly past the true corner, by at most the radius times the difference in scale. Nothing draws a rounded clip under a non-uniform scale today.
- A frame with more than 255 rounded clips draws the rest with their bounding rect and says so in the console once per overflow episode: the first overflowing frame reports, and the report re-arms only after a frame that fits, so a screen that stays over the limit does not log every frame. Nothing on any screen comes near it.
- `RoundedClipTable.test.ts` reads `uber.vert` and checks its `ROUNDED_CLIP_VECTORS` is twice `ROUNDED_CLIP_CAPACITY`, since Jest mocks the shader sources and nothing else ties the two.

## What moved

`scene-clipping` gains a third row: every primitive kind cut at a rounded clip's corners, a square scroll clip inside a rounded panel keeping the panel's corners, and a circular mask with a clamped capsule. Its golden is re-minted; the section is taller, which also changes the developer screen's scroll extent (its scrollbar thumb). Nothing else draws a rounded clip, so no other pixel moves.

Pixel tests in `tests/visual/web/uberShader.spec.ts`: the corner cut with whole straight edges at ratios 1 and 2, a glyph cut by a rounded clip in the same draw, and 4.7's nested case (inner radius, outer bounding rect, the warning raised). `WebGL2Backend.test.ts` checks that entries land behind the projection before the draw that reads them, that rounded clips split nothing, and that a frame of 256 clips gives the last one index 0, writes 255 entries inside the slot, and reports once across two such frames. The encoder tests check that raster small text (image mode) carries the index like everything else.

## A known tension with R5.27 and R15.15

The frame slot is bound with `bindBufferRange` at the first draw of the frame. When a later sort domain brings a new rounded clip, its entry is appended into that slot after earlier draws of the same frame were issued against the same bound range. The bytes are right: GL orders the write after those draws, and they never index the new entry. But a driver cannot know which part of a bound uniform range a shader reads, so on ANGLE (Metal, D3D11) the write can cost a shadow copy of the buffer or an implicit wait. That is the hazard R5.27 ("writing into a region the GPU may still be reading is prohibited") and R15.15 (one uniform write per flush, into its own slot) are there to avoid.

It is rare today: only the gallery draws rounded clips, and its entries arrive in the first domain. DDB-231 makes it routine (an overlay domain with a rounded panel after the base domain), so before or with DDB-231, either measure it on ANGLE Metal with `perf-capture.mjs` or give each flush its own slot holding the projection and the cumulative table, R15.15's shape, and bind that.

Settled by DDB-231 with the slots, not a measurement: an upload that adds entries after a draw has read the bound slot takes a fresh one with the projection and the whole table. See [component-rounded-clip.md](./component-rounded-clip.md).

## Not done

- Components did not use it. DDB-231 added `clipRadius` to the component contract and moved Panel and ScrollContainer onto it ([component-rounded-clip.md](./component-rounded-clip.md)).
- The table is not per flush, and its index is a byte, not R5.4's 16 bits; 255 rounded clips a frame is far past any screen.
- Rounded clips under rotation stay on R4.7's axis-aligned bounds, with the warning that already fires; the oriented clip is optional.
