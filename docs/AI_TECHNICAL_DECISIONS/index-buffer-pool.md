# Index storage as a pool of per-upload buffers (DDB-195)

## Problem

Combat fell from 60 to about 36 FPS on a Mac with a Radeon Pro 560X (ANGLE Metal, Chrome) when the WebGL2 backend landed in #70 (DDB-63). Bisected across the epic's merges with the GPU timer off: 16.6 ms paced at 6e7f6ee, #68 and #69; 27.9 ms from #70 on. Paced, the missing time sat outside the frame loop's sections (the browser waiting on the GPU process); unthrottled, it showed up inside `render` and `flush`, where GL calls block.

#70 put indices in one `StreamRing` buffer sized for three frames of the heaviest screen, about 1.1 MB at the legacy vertex's stride. Shrinking only that buffer to 256 KB, with the 8 MB vertex ring unchanged, brought combat back to 16.7 ms.

After the uber shader (#76) the derived index ring is about 786 KB (the stride went from 88 to 128 bytes, and `antialias` went off), and combat measures 16.6 to 17.3 ms paced on main. The regression is masked, not gone: forcing the index ring to 4 MB on post-#76 main puts combat at 32.7 ms paced and 27.9 ms unthrottled. The ring doubles whenever a frame outgrows it, so a heavy enough screen would have walked back over the cliff on its own.

## Mechanism

A standalone page (its own canvas and context, 4 MB unless noted, six uploads a frame, 3000 indices each, paced) isolated it:

| variant | frame ms |
| --- | --- |
| 256 KB buffer, write then draw, six times | 16.6 |
| 4 MB buffer, write then draw, six times | 26.4 |
| 4 MB, six writes, drawArrays instead of drawElements | 16.7 |
| 4 MB, no writes, six drawElements | 16.7 |
| 4 MB, one write, then six drawElements | 16.7 |
| 4 MB, six writes, then six drawElements | 16.7 |
| 4 MB, 16-bit indices, write then draw, six times | 34.5 |
| pool of 18 separate 16 KB buffers, one per upload | 16.7 |
| pool of 18 separate 4 MB buffers, one per upload | 31.2 |

So:

- The cost is paid by a `drawElements` that reads an element buffer written since its last draw, and it scales with the whole buffer, not with the bytes written.
- It is not copy-on-write of an in-flight buffer. Six writes into the same live buffer followed by six draws cost nothing extra, and a pool of large buffers, each written once and never reused within three frames, is as slow as the ring.
- It is not the index type, since 16-bit is as bad. So 16-bit indices are not a fix.
- It is index-specific. In the game, the 8 MB vertex ring written the same way costs nothing.

That is the signature of index bookkeeping a backend redoes over a dirtied element buffer's whole contents on the next draw: primitive-restart ranges or an index range. Which one ANGLE's Metal backend runs was not confirmed from its source. The fix does not depend on which.

Unthrottled headless measurements were useless for this. The first second after any change runs sub-millisecond frames before back-pressure sets in, and the frame-count windows the probe first used landed inside it. Only the paced runs above are trusted.

## Options considered

- **Shrink the ring or size it to need.** Works while the ring stays small, but the ring grows by doubling under load and every upload keeps paying for the whole ring. It treats the symptom.
- **16-bit indices where an upload has at most 65536 vertices.** Measured as bad as 32-bit at the same buffer size.
- **Orphan the buffer each frame (`bufferData`).** Measured worse: 29 ms at 4 MB. It also allocates per frame (R15.11).
- **Write all of a frame's indices before any draw.** The six-writes-then-six-draws row shows it would work. But domains are flushed as the tree walk reaches barriers, so a domain's indices cannot be written before an earlier domain draws without deferring all GPU work to `endFrame`, which is an architecture change.
- **A buffer per upload, sized to the upload.** The draw-time work becomes proportional to the indices actually written, whatever the frame's total. R5.27 names this shape ("a ring of at least three buffers per flush"). Chosen.

## Decision

`rendering/IndexBufferPool.ts`, GL-free like `StreamRing`, owns slot bookkeeping. `WebGL2Backend` owns one element buffer per slot and binds the upload's slot into the vertex array before writing it at offset 0.

- Each upload gets the smallest free slot that fits. A slot is free once the frame that last wrote it is two frames old (R5.27). Smallest-fit keeps a slot grown for the heaviest upload from being dirtied by every small one, which would bring the size-proportional cost back.
- When no free slot fits, a new one is created at the next power of two at or above 16 KB. Slots are never resized or freed, so a screen's working set stops allocating after two frames (tested). The pool starts with 24 slots of 16 KB, eight uploads a frame three frames deep, so ordinary screens never allocate in a frame (R15.11).
- Context loss resets the pool to its initial slots and recreates their buffers.
- The vertex stream stays a `StreamRing`. Its size costs nothing on this driver, and one ring keeps attribute pointers moving by offset only.

The same pool with 4 MB minimum slots measured 30.5 ms paced on combat, which confirms the pooling alone is not the fix; the per-upload sizing is.

## Result

Same Mac, post-#76 main against this branch, GPU timer off, median frame ms, paced / unthrottled, two runs each:

| screen | pre-#70 (6e7f6ee) | main | this branch |
| --- | --- | --- | --- |
| combat | 16.6 / 10.4 | 16.6-17.3 / 5.5-6.2 | 16.6-16.8 / 4.9-8.4 |
| main menu | 16.7 / 6.9 | 16.6 / 1.3-1.5 | 16.7-17.0 / 1.3-2.6 |
| card showcase | n/a | n/a | 16.6-16.9 / 3.5-5.0 |

What changed is the sensitivity. Combat's cost no longer depends on how large the index storage has grown, and it can't be driven back over the cliff by the ring doubling. Unthrottled figures move by a factor of two run to run on light screens (see the perf capture decision record); the paced ones are stable.

No pixel change: the same indices are drawn from the same vertices, and only the buffer they are read from and its offset differ. The screenshot suite is the check.

## Trade-offs

- An element buffer bind per upload. It is vertex array state and there is one upload per sort domain, so it is a handful of binds a frame.
- 24 small buffers (384 KB) replace one 786 KB buffer.
- If ANGLE ever does this work for vertex buffers too, the vertex ring would need the same treatment. Nothing measured says it does.
