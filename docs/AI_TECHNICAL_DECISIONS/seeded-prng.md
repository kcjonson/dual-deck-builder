# Seeded PRNG and named streams (DDB-281)

Date: 2026-10-06, hardened the same day in DDB-401. Code: `src/renderer/game/core/Rng.ts`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Seeds and determinism.

## Context

Nothing in the game was seeded; randomness came straight from `Math.random`. Area map generation needs more than a seeded generator: one 32-bit campaign seed, a `params` stream for rolling the map parameters, a named stream per stage (`terrain`, `highways`, `growth`, `pois`, `stops`, `scenery`, `names`) derived from the seed, the map attempt, the stage name, and the stage's attempt, and a stream per stop keyed by the stop's id and its roll count. Seeds are shown in campaign history and typed into the Map Lab, so a seed has to draw the same numbers in every engine and every release until a deliberate version bump. That promise covers the PRNG, not the map: the spec accepts small differences between engines in maps built with `Math.sin`, `exp`, and friends, since saves store the generated map. So the algorithm, the stream derivation, and how many draws each call takes are all part of the contract, and every generator stage and save depends on them.

## Decisions

**sfc32 is the generator.** The options:

- mulberry32: one 32-bit word of state, so its period is 2^32, and it can't produce every 32-bit output. Fine for the screenshot harness's `Math.random` stand-in, too thin for a campaign.
- xoshiro128**: good quality, but two `Math.imul` per draw and a guard against the all-zero state.
- PCG32: needs 64-bit multiplies, which JS only has through BigInt, and BigInt is slow.
- sfc32 (chosen, as the spec suggested): 128 bits of state, one of them a counter, so no stream cycles in fewer than 2^32 draws and the expected period is around 2^127. It passes PractRand and BigCrush, and a step is only adds, xors, and shifts, which are exact in int32 math and cheap in V8.

The step is PractRand's reference, returned as a uint32: `t = a + b + counter++; a = b ^ (b >>> 9); b = c + (c << 3); c = rotl(c, 21) + t`. The code keeps PractRand's names for the state words.

**A stream is its uint32 seed.** `new Rng({ seed })` takes any number and coerces it with ECMAScript ToUint32 (`seed >>> 0`), so NaN and Infinity give 0. Anything that isn't a number throws, since ToUint32 would quietly turn a seed missing from a save (`undefined`) into seed 0's map. It then expands the seed SplitMix-style into three words, word i = fmix32(seed + i * 0x9e3779b9) for i = 1 to 3, where fmix32 is MurmurHash3's finalizer, then seeds the way PractRand's `sfc32::seed(s1, s2, s3)` does: a, b, and c from the words, counter 1, and 15 draws thrown away. The finalizer means neighbouring seeds, the 1, 2, 3 someone types into the Map Lab, start out unrelated. `rng.seed` rebuilds the stream from its start, so a log or a save can name any stream with one number.

**`fork` hashes (seed, name, attempt) into the child's seed.** `fork(name, attempt)` returns `new Rng({ seed: MurmurHash3_x86_32(bytes, parentSeed) })`, where the bytes are each UTF-16 code unit of the name as a little-endian uint32, then the attempt as a little-endian uint32: 4 * (length + 1) bytes, with no tail. The name must be a string, since every number would otherwise hash to the same stream. The attempt is an integer from 0 to 2^32 - 1 and 0 when left out, but an explicit `undefined` throws (and the signature won't take a `number | undefined`), so a roll count missing from an older save fails loudly instead of quietly rebuilding roll 0. `fork` always returns a base `Rng` built from the derived seed.

How a child gets its seed:

- From the parent's next draw. Simplest, but siblings would then depend on the order they were forked in and on every draw the parent made first, which is the coupling streams exist to remove. Rejected.
- A hash to a full 128-bit child state, with roots still built from a uint32. It rules out collisions between streams (see Consequences), but a child stream could no longer be written down as one number: logs and saves would carry four words per stream, and `seed` would stop describing it. Rejected, because a collision is rare and invisible.
- A hash to a uint32 seed. Chosen.

For the hash, FNV-1a is already in the repo (`engine/ui/Avatar.ts`), but without a finalizer it mixes poorly on short inputs that differ in their last character, and `stop:1`, `stop:2` is exactly that. MurmurHash3_x86_32 is a standard function with a strong finalizer and published test vectors, so a stream seed can be recomputed with any MurmurHash3 library. Code units rather than UTF-8 bytes because `charCodeAt` is what JS hands over without an encoder, and it's defined for every string, lone surrogates included (UTF-8 would turn every lone surrogate into U+FFFD and give them one stream).

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
| `shuffle(items)` | Fisher-Yates in place, from the last index down | as `int(0, index)`, per index above 0 |
| `weighted(entries)` | the first entry whose running weight total exceeds `float() * total` | 1 |

- `int` takes safe-integer bounds spanning at most 2^32 values. Rejection keeps it free of modulo bias; for spans up to 1,000 a redraw happens less than once in 4 million calls. It always takes at least one draw, even when min equals max, so pinning a parameter's range to one value doesn't shift the draws after it.
- `pick` and `weighted` throw on an empty list. `weighted` also throws on a weight that isn't a number (`"3"`, `true`, and `null` from preset JSON all pass a `>= 0` check, and string weights would concatenate the total), on one that is negative, NaN, or infinite, and on weights that sum to zero or overflow. A zero weight is never chosen, even at the lowest or highest draw; the walk stops at the last positive weight, which matters only when a subnormal total lets the target round up to the total.
- Every argument check throws a RangeError, wrong types included, so a caller or a test has one class to expect.
- `shuffle` mutates the array and returns the same one. A consumer that needs a change event, or the original order, shuffles a copy.

**The same draws in every engine.** Everything but `weighted` is integer math: `Math.imul`, shifts, `>>> 0`, and double arithmetic on integers below 2^53, which is exact. `float` scales by a power of two, also exact. `weighted` adds and multiplies doubles, which every conforming engine rounds identically. There's no `Math.sin`, `exp`, `log`, or `pow` anywhere in the module, so a seed draws the same numbers in V8, SpiderMonkey, and JavaScriptCore, in every release until `RNG_VERSION` changes. What generation computes from those draws with transcendental functions can still differ slightly between engines, which the spec accepts.

**`RNG_VERSION` names what a seed draws.** `RNG_VERSION` is exported and asserted beside every golden, so whoever changes a pinned value has the version in front of them; nothing forces the bump. The generator version (DDB-296) builds on it.

**Root seeds come from `freshSeed()`.** It mints a seed for campaign founding and the Map Lab's new-seed button as `(Math.random() * 2^32) >>> 0`. It's the one place root seeds for generation and the campaign come from, and it reads `Math.random` on every call rather than caching it, so the screenshot harness's seeded `Math.random` reaches every stream derived from a root.

**How generation and the campaign use it.**

- One root per campaign, `new Rng({ seed: campaignSeed })`.
- The parameters roll from `root.fork('params')`.
- Each stage draws from `root.fork('map', mapAttempt).fork(stage, stageAttempt)`, and forks again from that for any sub-stream rather than sharing one. A whole-map restart moves to the next map attempt, so it never replays streams that already failed. Neither attempt cap (8 a stage, 32 a map) is hashed into any stream, so changing one moves only the seeds that reach it; those seeds do make different maps, and a cap change needs a generator version bump.
- A stop's contents roll from ``root.fork(`stop:${id}`, rollCount)``.
- Campaign-time draws fork a fresh stream per event from a persisted counter, `root.fork('recruit', n)` or `run.fork('fight', i)`. A long-lived stream never crosses a save: a stream rebuilt from its seed replays from draw 0, so a campaign drawing driver ids from one stream would issue duplicate ids after a load. No stream is saved mid-sequence, and `Rng` has no way to save one.
- Methods aren't bound. Where a library wants a `() => number`, a noise function's random source for one, pass `() => rng.float()`; `terrain.float` on its own throws on the first call.
- `Rng` isn't designed for subclassing: the constructor calls nothing overridable, and `fork` returns a base `Rng`. The tests reach edge draws with a real `Rng` whose `next` reads from a script, not with a subclass.

## Consequences

- Golden tests pin the raw sequence for three seeds, six fork seeds (an empty name, an emoji name, and the largest attempt among them), and a run of every derived draw, all at `RNG_VERSION` 1. When they were pinned, the raw values were cross-checked against PractRand's sfc32 and SMHasher's MurmurHash3_x86_32 compiled from C (the C hash matched MurmurHash3's published test vectors), and the derived draws against an independent Python mirror. Changing any of it changes every map, so a deliberate change ships with an `RNG_VERSION` bump and a generator version bump (Area Map Generation, Saving).
- Stream seeds are 32 bits, so two streams in a campaign can share one. At the spec's sizes, about 3,000 streams per campaign (300 stops rolled up to 10 times each, plus the parameter and stage streams), a probe with this fork hash found a collision in about 1 in 1,250 campaigns, nearly always between two stops' rolls. Those come in mirrored pairs (stop a's roll 5 matching b's roll 4 means a's roll 4 matches b's roll 5, because MurmurHash3 xors the attempt's block into the name's hash state), so fewer campaigns see one than the birthday estimate of 1 in 935 suggests. Two colliding streams draw the same sequence for unrelated purposes, which nobody can see, so stream seeds stay 32 bits: one number per stream in logs and saves is worth more than ruling out a collision nobody would notice.
- Measured per call, best of seven runs:

| Call | Node 24 (V8 13.6) | Electron 25 (V8 11.4) |
| --- | --- | --- |
| `next()` | 1.2 ns | 1.9 ns |
| `float()` | 1.3 ns | 2.0 ns |
| `int(1, 6)`, `int(-1000, 1000)` | 3.3 ns | 3.0 to 3.3 ns |
| `int(0, 2^31)`, which rejects about half its draws | 18 ns | 15 ns |
| `pick` from 5 items | 4.4 ns | 4.0 ns |
| `shuffle`, per item of 52 | 3.1 ns | 3.4 ns |
| `weighted` over 4 entries | 19 ns | 19 ns |
| `new Rng` | 35 ns | 37 ns |
| `fork` | 55 to 62 ns | 56 to 60 ns |

- Three choices make those numbers. The state is an `Int32Array`, because V8 holds number fields that stray outside small-integer range as boxed doubles, and `next` took 7.3 ns that way; the constructor warms up on locals and stores the state once. The bounded draw divides by `span >>> 0` and truncates the remainder with `>>> 0`, which V8 compiles to an integer divide instead of a call to Float64Mod (`pick` took 15 ns before). And the module reads `Math.imul`, `Number.isInteger`, `Number.isSafeInteger`, `Infinity`, and `Int32Array` once, at load, because inside Jest's vm context each global read costs about 0.15 us: a fork under Jest took 5.2 us before and 50 ns after, without coverage. Nothing allocates per draw, so 50 million draws run without a garbage collection, and a map's draws add up to well under a millisecond against generation's 200 ms budget.
