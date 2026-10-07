# Seeded PRNG and named streams (DDB-281)

Date: 2026-10-06. Code: `src/renderer/game/core/Rng.ts`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Seeds and determinism.

## Context

Nothing in the game was seeded. `Math.random` is called directly in `Deck.shuffle`, `RandomAIStrategy`, `AIEvaluator`, and `Model` ids. Area map generation needs more than a seeded generator: one 32-bit campaign seed, a named stream per stage (`params`, `terrain`, `highways`, `growth`, `pois`, `stops`, `scenery`, `names`) derived by hashing the seed, the stage name, and the stage's attempt number, and a stream per stop keyed by the stop's id and its roll count. Seeds are shown in campaign history and typed into the Map Lab, and a seed has to mean the same map in every engine and every release until a deliberate generator version bump. So the algorithm, the stream derivation, and how many draws each call takes are all part of the contract, and every generator stage and save depends on them.

## Decisions

**sfc32 is the generator.** The options:

- mulberry32: one 32-bit word of state, so its period is 2^32, and it can't produce every 32-bit output. Fine for the screenshot harness's `Math.random` stand-in, too thin for a campaign.
- xoshiro128**: good quality, but two `Math.imul` per draw and a guard against the all-zero state.
- PCG32: needs 64-bit multiplies, which JS only has through BigInt, and BigInt is slow.
- sfc32 (chosen, as the spec suggested): 128 bits of state, one of them a counter, so no stream cycles in fewer than 2^32 draws and the expected period is around 2^127. It passes PractRand and BigCrush, and a step is only adds, xors, and shifts, which are exact in int32 math and cheap in V8.

The step is PractRand's reference, returned as a uint32: `t = a + b + counter++; a = b ^ (b >>> 9); b = c + (c << 3); c = rotl(c, 21) + t`.

**A stream is its uint32 seed.** `new Rng({ seed })` coerces the seed with ECMAScript ToUint32 (`seed >>> 0`), expands it SplitMix-style into three words, word i = fmix32(seed + i * 0x9e3779b9) for i = 1 to 3, where fmix32 is MurmurHash3's finalizer, then seeds the way PractRand's `sfc32::seed(s1, s2, s3)` does: a, b, and c from the words, counter 1, and 15 draws thrown away. The finalizer means neighbouring seeds, the 1, 2, 3 someone types into the Map Lab, start out unrelated. `rng.seed` rebuilds the stream from its start, so a log or a save can name any stream with one number.

**`fork` hashes (seed, name, attempt) into the child's seed.** `fork(name, attempt = 0)` returns `new Rng({ seed: MurmurHash3_x86_32(bytes, parentSeed) })`, where the bytes are each UTF-16 code unit of the name as a little-endian uint32, then the attempt as a little-endian uint32: 4 * (length + 1) bytes, with no tail. The attempt is an integer from 0 to 2^32 - 1; anything else throws a RangeError.

How a child gets its seed:

- From the parent's next draw. Simplest, but siblings would then depend on the order they were forked in and on every draw the parent made first, which is the coupling streams exist to remove. Rejected.
- A hash to a full 128-bit child state. No 32-bit collisions, but a stream could no longer be written down as one number and `seed` would stop describing it. Rejected.
- A hash to a uint32 seed. Chosen.

For the hash, FNV-1a is already in the repo (`engine/ui/Avatar.ts`), but without a finalizer it mixes poorly on short inputs that differ in their last character, and `stop:1`, `stop:2` is exactly that. MurmurHash3_x86_32 is a standard function with a strong finalizer and published test vectors, so a stream seed can be recomputed with any MurmurHash3 library. Code units rather than UTF-8 bytes because `charCodeAt` is what JS hands over without an encoder, and it's defined for every string, lone surrogates included.

What falls out:

- `fork` never reads or advances its parent, so sibling streams don't depend on fork order or on how far the parent has drawn.
- A name and an attempt can't run together: the byte length fixes where the name ends, so `fork('a', 98)` and `fork('ab')` differ.
- For a fixed name and attempt, the child seed is a bijection of the parent seed (every Murmur step and the finalizer are invertible), so two campaign seeds never share a stage stream.

**Every draw's cost in draws is fixed.** A stage's output depends on how many draws each call takes, so these are as pinned as the algorithm:

| Call | Result | Draws |
| --- | --- | --- |
| `next()` | uint32 | 1 |
| `float()` | `next() * 2^-32`, in [0, 1) | 1 |
| `int(min, max)` | `min + draw % span`, span = max - min + 1, redrawn while the draw is in the last incomplete block (`draw - draw % span > 2^32 - span`) | 1, more with probability under span / 2^32 |
| `pick(items)` | `items[int(0, length - 1)]` | as `int` |
| `shuffle(items)` | Fisher-Yates in place, from the last index down | 1 per index above 0 |
| `weighted(entries)` | the first entry whose running weight total exceeds `float() * total` | 1 |

- `int` takes safe-integer bounds spanning at most 2^32 values and throws a RangeError otherwise. Rejection keeps it free of modulo bias; for spans up to 1,000 a redraw happens less than once in 4 million calls. It always takes at least one draw, even when min equals max, so pinning a parameter's range to one value doesn't shift the draws after it.
- `pick` and `weighted` throw a RangeError on an empty list. `weighted` also throws on a weight that is negative, NaN, or infinite, and on weights that sum to zero or overflow. Zero weights are skipped in the walk, so one is never chosen, even at the lowest or highest draw.

**The same draws in every engine.** Everything but `weighted` is integer math: `Math.imul`, shifts, `>>> 0`, and double arithmetic on integers below 2^53, which is exact. `float` scales by a power of two, also exact. `weighted` adds and multiplies doubles, which every conforming engine rounds identically. There's no `Math.sin`, `exp`, `log`, or `pow` anywhere in the module, so a seed draws the same numbers in V8, SpiderMonkey, and JavaScriptCore.

**How generation is meant to use it.** One root per campaign, `new Rng({ seed: campaignSeed })`. Each stage forks its stream by the spec's stage name and its attempt number, `root.fork('terrain', attempt)`, and forks again from that for any sub-stream rather than sharing one. A stop's contents can fork from the root by id and roll count, ``root.fork(`stop:${id}`, rollCount)``, which a save rebuilds from the campaign seed with nothing else stored; the stops and campaign work settles that. No stream is ever saved mid-sequence.

## Consequences

- Golden tests pin the raw sequence for three seeds, six fork seeds (an empty name, an emoji name, and the largest attempt among them), and a run of every derived draw. When they were pinned, the raw values were cross-checked against PractRand's sfc32 and SMHasher's MurmurHash3_x86_32 compiled from C (the C hash matched MurmurHash3's published test vectors), and the derived draws against an independent Python mirror. Changing any of it changes every map, so a deliberate change ships with a generator version bump (Area Map Generation, Saving).
- Stream seeds are 32 bits, so streams can collide: with n streams in one campaign the chance any two share a seed is about n^2 / 2^33, roughly 1 in 8,600 for 1,000 streams. Two colliding streams draw the same sequence for unrelated purposes, which nobody can see.
- Measured in V8 (Node 24): `next` and `float` about 7 ns, `int`, `pick`, and a shuffle's per-item draw 14 to 20 ns over spans that vary, and no garbage collection across 50 million draws once optimized. A fork is a hash over the name plus 15 warm-up draws. A map's draws add up to well under a millisecond against generation's 200 ms budget.
- `Deck.shuffle`, `RandomAIStrategy`, `AIEvaluator`'s driver shuffle, and `Model` ids still call `Math.random`. Moving them onto `Rng` (and `Model` ids onto a counter, since ids don't need randomness) is follow-up work.
