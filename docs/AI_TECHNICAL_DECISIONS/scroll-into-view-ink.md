# Scrolling what a component draws into view

Date: 2026-10-06. Task: DDB-406 (DDB-256). Spec: R8.8, R9.23, R11.12, R12.20. Builds on [panel-and-scroll-container.md](./panel-and-scroll-container.md), [focus-manager.md](./focus-manager.md), and the ink bounds of [subtree-ink-cull.md](./subtree-ink-cull.md).

## Context

The focus manager asks every scrolling ancestor of a component focused by keyboard or code to `scrollIntoView` it, and `ScrollContainer` brought the component's `screenQuad`, its content box, inside the clip. Whatever the component draws past its box was left wherever that put it, so a reveal that stopped at the box's edge cut the rest:

- The walk's focus ring is 3 px outside the box. At 800x450 driver selection's deck scroller sits at its minimum height, and every Tab or arrow into the deck stopped with the card's box on the clip's bottom edge and the ring's bottom under it.
- A card face's cost hex hangs 7 px off its top-left corner, 12 px with its outline and the ring. The pile dialog cut that much off every card the arrows walked a row down or up to.
- The 80x112 mini card (DDB-311) draws its stack edges, count pill, and state tag up to 7 px out. With it, the first Tab into driver selection's left deck at 1024x600 scrolled 43.8 px and left Ramming Speed's x5 pill and the ring's bottom half under the clip.

A margin round the content protects it only at scroll 0 and at the end of the range, so the scrolls in between are the reveal's to get right.

## Decision

**The reveal is the component's `ownInkBound`.** That is its cull ink (R8.8's `inkExtent` round the box, or a component's own `cullInk`) grown by the walk's ring while it can show one. It is the bound the development build checks each of the component's draws against, so a draw outside it fails the visual suite and throws in the unit tests. With no bound (an unmeasured `Text`, a draw fixture), the box stands in. The box and the ink are carried into the scroller's unscrolled space corner by corner with `localToAncestorInto`, so a rotated or scaled component counts at its transformed extent, a scaled ancestor of the scroller changes nothing, and no matrix is built or inverted. A component the scroller doesn't hold is left alone.

**The rule is `revealDelta`, per axis, in three cases.** With the box, the ink (never less than the box), and the clip as spans:

- The ink fits the clip: all of it shows. `nearest` moves the least, `center` centres it. A component whose ink shows already doesn't move.
- The ink is taller than the clip but the box isn't: the box shows whole and the room it leaves is split between the ink above and below it, half each, unless one side needs less than half, which then gets all it needs and the other side the rest. A ring all round shows on both sides before a one-sided pill takes the room. Both blocks give this answer.
- The box is taller than the clip: `nearest` shows its top, as before, now under the ink above it, which gets at most half the clip. `center` centres the ink.

The scroll range clamps every answer, so ink past either end of the content stops at it.

**No direction, so no swing.** The last two cases depend only on where the component is, never on which side it came from, and the first is CSS's `nearest`, which a second call leaves alone. Focus going back and forth over a component too tall to show lands it in one place, and asking twice never moves twice.

**Nested scrollers each reveal the component itself, inner first,** the focus manager's existing order. The outer reads the component where the inner's scroll has just put it.

**The container scrolls vertically, so only the vertical span counts.** Ink reaching only sideways moves nothing. `revealDelta` doesn't know which axis it is on, so a horizontal scroller would apply it to x unchanged.

## Options considered

- **The box, as before.** Cuts every ring at the edge it stops on, which is the bug.
- **`subtreeInk`, the whole subtree's bound.** It covers children drawing past the component, but it's null for any subtree holding a layer, and it isn't cut by the component's own clip, so a focused nested scroller's bound is its whole content. Children past their parent's box are the lint's to catch (R13.25.2); the parent's own draws are what hang off it.
- **Only what the component draws right now.** A control's `inkExtent` is a maximum over every state (the hover glow, the press nudge) and `ownInkBound` adds the ring to it whether or not it shows, so the reveal can leave more room than this focus draws. Narrowing it needs a per-state bound no component offers, and a bound that can come out short is the one error the reveal can't have.
- **For ink taller than the clip:** `nearest` on the ink, clamped to keep the box, moves the least but cuts the ring on the far side; showing the side focus moves toward needs the direction, and a version that reads it from where the ink sits swings back on the next call; centring the ink cuts a short side's ring when the ink is lopsided. Splitting the room keeps the box and shows both sides of a ring whenever there are 3 px a side to show it in.
- **For a box taller than the clip:** CSS's `nearest`, the near edge, would show a card reached from below by its foot. Cards and text read from the top, so the top keeps winning.

## Consequences

- Every keyboard or programmatic reveal leaves room for the ink: 3 px for the walk's ring, 12 for a card face, about 30 for a control whose look can glow on hover, whose `inkExtent` counts the 26 px glow though a focused control without the pointer draws only its ring. Where the ink doesn't fit, the box is centred instead, which reads as deliberate.
- A programmatic focus under the pointer modality reveals the ring too, though it isn't drawn (`ownInkBound` grows any focusable by it).
- Content whose ink reaches past the end of its scroll range still needs a margin or padding for that ink; the reveal can't scroll past the end. The pile dialog's last row (the discard pile) has its hex and ring under the clip at the end of the range, as before.
- Scenes and goldens don't focus inside a scroller by keyboard, so no golden or lint result moves.
