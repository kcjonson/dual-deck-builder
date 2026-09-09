# A composite's own drawings are not its children

DDB-104. Normative: R13.25, R13.25.1, R13.29, R13.28, R3.18, R8.1, R8.6, R8.8.

## Context

R13.29 makes `lint().count === 0` a merge gate, and the implementation spec's ground rules put that
gate on the gallery first and on each screen as it migrates. When the gallery landed, not one of its
eight scenes could reach zero: 4, 1, 8, 1, 9, 3, 1, 3, thirty in all. The screens were worse, 1,044
between six of them.

The cause was not a layout defect on any of those scenes. Every `Panel` builds a background
`Rectangle` and a content `Layer` at its own size and adds both as children; every `Button` adds a
background and a label; `Input` adds four. Rule 1 asks whether two visible siblings overlap, those
pairs always overlap, and so every composite in the codebase reported its own construction as a
finding. Twenty-eight of the gallery's thirty were exactly that. Across the screens the same shape
accounted for 378 containments and 55 coincident boxes.

R13.25.1 already exempts a pair that declares a different `zIndex` or a different effective layer,
and phase 0 emits neither, so nothing was ever exempted.

## Options considered

**1. Emit `zIndex` and an effective layer, so R13.25.1's existing exemption does the work.** The
spec-faithful-looking answer, and the one the ticket proposed first. Rejected on the spec's own
text: R3.18 fixes a composite's internal order as shadow, background fill, decorations, content,
chrome and forbids `zIndex` tricks for it by name, and R3.19 makes the layer half structurally
impossible for a widget's own parts. Worse in practice than in principle: no component in this
renderer ever reorders its children, so every ordinal emitted would be inert on pixels and would
exist only to move the lint count. R3.14 records that exact pattern as the root of worldsim's
ordering bugs. It also silences the partial overlaps that are rule 1's only real catches.

**2. Teach rule 1 about structural pairs.** Add a third clause to R13.25.1: a background beneath its
own content is a declared construction. Rejected because it amends the MUST-provide rule itself,
turning an exemption the spec states as a closed pair into an open one, and because the enclosure
test it needs is widest exactly where a broken composite ends up, with content shrinking inside a
backdrop that stayed large. The same information costs the same to declare either way and is
strictly safer applied earlier.

**3. Change what the tree says.** Taken, in the cheap form. `Panel.render` calls
`this.background.render()` and `this.contentLayer.render()` by name; it never walks a child list to
find them, and `Panel.addChild` redirects a caller's child into the content layer so it cannot reach
that array at all. The snapshot was calling those two nodes siblings of the caller's children, which
they are not, and rule 1 was correctly reporting what the snapshot told it. The tree was wrong, not
the rule.

**4. Scope the gate.** A committed ledger of accepted violations that fails on any new one. Kept only
its good half, the gate itself. The ledger is refused: measured, the gallery needs no waivers, and
this repository has twice written down that widening a gate is how a suite dies.

## Decision

`Layer.addPart(child)` marks a child as the parent component's own rendering. Same array, same order,
same paint result as `addChild`; one private boolean behind a `get isPart()`. Both `addChild` and
`removeChild` clear the mark, because it describes the edge and not the node. `treeSnapshot` emits
marked nodes in a `parts` array beside `children`, created lazily so the field is absent rather than
empty. `layoutLint`'s walk takes a `siblings` flag, false for a parts group, and that flag gates rule
1's pairing and nothing else.

What is deliberately unchanged, because the value of this fix is that it is not a new exemption:
rule 1's geometry predicate, `EPSILON`, both existing exemptions, the both-sides requirement in
`declaresDifferentStacking`, the file's absence-never-exempts invariant, R13.27's visibility and
roots handling, and R13.28's violation shape. No `zIndex` is invented. Ten call sites, in `Panel`,
`Button`, `Input` and `DeveloperOverlay`.

Measured, three runs, byte-identical: the gallery goes 30 to 0 and every one of the eight scenes
reads 0, so R13.29 is armed literally as `count === 0` with no reinterpretation. The capture is
committed at `perf-results/phase0-gallery-lint.json` and `tests/visual/web/lint.spec.ts` asserts it
inside the existing Screenshots job. Of the thirty, twenty-eight were withdrawn as part-against-part
pairs and two were a real defect, described below.

## What this makes the lint blind to, stated without softening

Rule 1 no longer pairs a part with anything. Three consequences, and the last is the one that is easy
to miss.

**A part against another part.** A `Button` icon drawn over its own label, or a `Panel` header band
whose height stops being subtracted so the title lands on the first content row, reports nothing.
R12.19's Panel has a title, a kicker and an actions slot, so phase 5's Wave A manufactures exactly
this class.

**A caller-added child against a part.** Demonstrated rather than reasoned: an opaque rectangle added
to a `Button` with `addChild`, covering its label exactly, lints 0 on all eight scenes. Before this
change it would have been reported, so this is a real loss of coverage and not only a withdrawal of
noise.

**Rule 6 is narrowed too, not just rule 1.** `unreachable-interactive` takes the same group, so a
part covering an interactive child, or the reverse, is no longer compared. Latent today because rule
6 is dormant for want of `focusable` and `pointerEvents`, and DDB-73 has to decide it when the
dispatcher supplies them.

What still covers those. Rules 2, 3, 4, 5 and 7 all run over parts, so a part that escapes its owner,
collapses, or leaves the viewport is reported; recursion into a part is not cut, so a container part
still lints its own contents. Every gallery scene has a committed screenshot golden, and the
covering-rectangle case above turned that golden red in the same run in which the lint stayed silent,
which is the honest description of the cover: the picture catches it, the tree does not. And today's
engine batches all text to a single flush at frame end, so a `Rectangle` cannot paint over a `Text`
at all, which makes the background-over-its-own-label bug unrepresentable rather than merely
uncaught. That last cover expires with phase 1's batcher (DDB-65).

Two smaller holes, both found by an adversarial pass and both closed. The mark was sticky in the
first draft: `addChild` did not clear it, so a layer that had ever been anyone's part stayed one and
would be laundered out of rule 1's pairing under a new parent. And parts and children were numbered
from their own positions, so a part and a child of the same type under one owner both printed
`Type[0]`; since the path is the only identity R13.28 gives a violation and the only key a baseline
diff can match on, the two groups are now numbered across their concatenation and split afterwards.

## The gate has to prove it measured something

`count === 0` is satisfied by measuring nothing, which is not a hypothetical: making `treeSnapshot`
return no roots left all eight scenes green, and nothing else on the path notices, because
`openScene` waits on `__app.status()` and never reads the tree. So the spec asserts a node floor
before it asserts the count. The probe is `outside-viewport`'s `evaluated`, the one rule that tests
every visible candidate exactly once. The floor is 4 rather than the real per-scene counts, because a
tight bound would be a second baseline to re-approve on every scene edit and the failure it guards
against returns zero, not three.

## The defect this found

Not a manufactured example. `TextExamplesSection` positions its three alignment samples as bare
points, and `Text` resolves alignment against the node's own box, so the right-hand sample drew a
text width past the section and off the viewport entirely. Nobody had noticed because the developer
screen scrolls that section out of view; the gallery mounts it alone, which is what made it visible.
Giving each sample a column of the row fixes it, and it is the only pixel change here, confirmed
against the committed goldens: 24 of 26 pass untouched and the two that differ are `scene-text` in
both projects. "Right aligned" appears in that golden for the first time.

## Spec departures

`parts` is a field R13.22's node schema does not name, and that is an addition rather than an
application of the file's omission convention, so it is recorded as a departure. The justification:
R13.22 describes the tree R8.6 permits, where a library container MUST NOT insert implicit children,
and it names this codebase's `Panel` as the anti-pattern. The schema has no shape for something the
object model says cannot exist, so any faithful serialization of today's `Panel` departs from R13.22
somewhere, and this puts the departure in a named field instead of in a silently wrong `children`
array. R8.8 is the affirmative half: a composite MAY build its visuals from child shapes, and
whatever it draws follows R3.18 internally.

Scoping "siblings" in R13.25 to exclude a parts group is an argument, not a reading, and is stated as
one. R3.18 prescribes the order in which a composite's parts cover one another, and R13.25 offers no
vocabulary in which "two parts overlap" could be a finding without a role enum the lint does not
have.

## Deletion trigger

This construction is forbidden by the spec it serves, so the fix must not outlive it. When DDB-73 and
DDB-79 land, no component calls `addPart`, the field stops appearing, and DDB-80 removes `addPart`,
`isPart`, `SnapshotNode.parts`, `LintNode.parts`, the `siblings` parameter and this document. The
`addPart` call sites are a greppable to-do list of the composites that must become direct draws, and
`compositeParts.test.ts` pins the current four so a new one is a review question rather than a number
somebody updates. A `parts` array still appearing after phase 3 means that migration is incomplete.

## What stays open

Screen lint zero. The six capturable screens sit at 1,002 after this change, down from 1,044, and
DDB-104 cannot get them to zero because almost none of the remainder is a layout defect: 398 are
`zero-or-negative-size` bucketed `unmeasured-text`, which is a violated R13.21 precondition since
`Text` sizes come only from `Layer.layout()` and the frame loop never calls it; 291 are content
scrolled out of a container; 245 are sibling-overlap, of which roughly 223 are the same
background-sibling construction hand-rolled in `Card`, `Vehicle` and the screens; 68 are
child-outside-parent. Owners: DDB-70, DDB-71 and DDB-73 for the text, DDB-85 for the scroll
containers, DDB-79 for the game-code families, DDB-91 for the gate on every screen.

The residue worth a person is about 22 sibling-overlaps, and they are the lint earning its keep:
twelve coincident deck-preview `Layer`s stacked at identical boxes, which reads as a rebuild that
never cleared; the synergy panel over both driver panels (DDB-102); the combat turn banner over the
enemy battlefield, which may be an intended overlay and needs a call; and `Vehicle`'s portrait and
structure-track containments, which want nesting when DDB-79 rebuilds them.
