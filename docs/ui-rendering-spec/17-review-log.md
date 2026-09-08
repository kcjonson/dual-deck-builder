# 17. Review log

Status: closed (2026-09-07). Reviews 02 and 04 resolved into draft 2, reviews 01 and 05 into draft 3, review 03 into draft 4.

The first draft was reviewed from five lenses by independent reviewers instructed to challenge, not confirm: a graphics engineer with web verification (01), a UI framework architect (02), the worldsim maintainer checking provenance against the C++ source (03), the implementer of the sibling TypeScript engine (04), and a consistency editor (05). The reports are kept verbatim under [review/](review/README.md). This chapter records what was done with each finding. Resolutions: accepted (the rule changed as proposed), modified (changed, but differently; the reason is given), noted (recorded in the implementation specification or a migration note rather than in a rule), deferred (agreed, left for a later revision), rejected (with the reason).

## 17.1 Review 02, UI framework architect

Thirty findings, five blockers. All five blockers and every major finding were accepted; chapters 8, 9, and 10 were rewritten, chapters 11 and 12 rewritten in the following pass, and chapters 3 and 13 edited.

| Id | Severity | Subject | Resolution |
|---|---|---|---|
| U1 | blocker | Definite-axis rule plus `layout(bounds)` freezes hug containers (worldsim's own recorded defect) | accepted: R10.1 and R10.5 separate authored sizing mode from per-pass resolved size; regression test added to 10.9 |
| U2 | blocker | Promotion resetting the content offset changes what `position` means; popups need screen geometry R8.13 forbade | accepted: R3.8 resets only the clip; R8.13 exposes `screenBounds`, `screenQuad`, `localToScreen`, `screenToLocal`; the 3.9 examples rewritten. Review 04's alternative (`positioned: 'screen'`) was considered and not adopted, to keep one coordinate rule |
| U3 | blocker | Deferred callbacks break consume-in-callback, re-entrancy, validators, open-on-press | accepted: R8.25 makes callbacks synchronous inside dispatch with the re-entrancy rule generalised from the slider |
| U4 | blocker | No hit-target model; a button with a label child loses hover and click | accepted: R8.29 `pointerEvents` (`auto`, `passthrough`, `unit`, `none`); R9.4 descent rules; R9.8 `hovered` on ancestors; R9.31 click on the nearest common ancestor |
| U5 | blocker | Drag and drop was one sentence; capture prevents drop targets from highlighting | accepted: R9.12 drag service with threshold, `dragenter`, `dragover`, `dragleave`, `drop`, `dragend`, `accept()`; public `hitTest`; `dropActive` state; threshold tokens |
| U6 | major | Mouse-only input model | accepted: R9.1 pointer identity, `pointercancel`, `contextmenu`; R9.30 chords and primary pointer; R9.10 implicit touch capture; injection grammar amended |
| U7 | major | No controller or spatial navigation | accepted: R9.26 `focusDirection`, R9.27 `activate` and `cancel` with `inputMode`; the gamepad adapter is R15.40 |
| U8 | major | Tab order from registration order is not tree order | accepted: R9.18 derives order from the tree; R9.20 scopes are subtree roots |
| U9 | major | Focus on press for non-focusables, focus fixup, programmatic focus modality, roving groups | accepted: R9.23 nearest focusable ancestor and `preventFocus`; R9.28 fixup; R9.29 focus groups; R9.22 modality |
| U10 | major | Events dispatched between frames against stale layout | accepted: R9.2 queues events and dispatches at frame start with layout on demand; R8.16 updated |
| U11 | major | Exclusive state precedence hides the focus ring under hover | accepted: R11.11 boolean flags; R11.12 layered resolution with the ring independent |
| U12 | major | Style objects and variant tables had no defined merge; open property set | accepted: R11.14 closed set, rejected rather than ignored; R11.15 resolution order with per-state overrides |
| U13 | major | No component transform | accepted: R8.26 |
| U14 | major | No keyed reconciliation or state-preserving move | accepted: R8.5 `moveChild`; R8.27 `reconcileChildren` |
| U15 | major | `update` opt-in, clock, and tween underspecified | accepted: R8.17 `requestUpdate`; R8.28 clock and animator; naming unified on `clock` |
| U16 | major | Layout gaps: hug main axis, fill minimums, shrink-to-fit, `alignSelf`, weights, anchors, negative gap, safe alignment | accepted: R10.2, R10.3, R10.4 (minimums required), R10.7, R10.8, R10.10, R10.15; percent wording corrected |
| U17 | major | Ink overflow contradicts R8.8; uniform margin only | accepted: R8.8 ink overflow and `inkExtent`; per-side margin in R8.2 and R8.11 |
| U18 | major | Non-modal dialogs light-dismissed; roots hand-ordered | accepted: R12.21 `dismissOnOutsidePress` default false; R8.21 overlay service; R3.15 updated |
| U19 | minor | Trigger switching, secondary-button reopen, tooltips during press and drag | accepted: R9.13, R12.14, R12.22 |
| U20 | major | Snapshot too thin; lint lacks the rules that catch the board's bugs; ids | accepted: R13.22 schema widened; R13.25 gains `text-overflow`, `unreachable-interactive`, `target-size`; R13.26 gains contrast and missing-id; R8.4 ids and `findById` |
| U21 | major | Hotkeys unscoped; text fields must own printable keys; repeat | accepted: R9.15, R9.17, R9.27 |
| U22 | minor | Per-notch wheel language; no latching | accepted: R9.3 and R9.32; chapter 4 and 12 defer to them; `scroll_step` kept for keyboard scrolling only |
| U23 | minor | Capture details | accepted: R9.10 |
| U24 | minor | `opacity: 0` semantics | accepted: R3.27 and R8.3 |
| U25 | minor | Base callbacks, `cursor`, async textures | accepted: R8.2 callbacks and `cursor`; R12.5 placeholder and residency |
| U26 | minor | Relayout boundaries and the non-invalidating list | accepted: R8.18 |
| U27 | minor | Catalog contracts too thin or non-standard | accepted for checkbox, context menu, scroll container, menu, slider, text input, toast; modified for the tab bar: controlled and uncontrolled modes rather than firing `onSelect` on a fallback |
| U28 | major | Missing components | accepted: Popover, FocusGroup, RadioGroup, ScreenTransition required; NumberInput, Scrollbar, Counter recommended; the `transition` layer added to R3.5 |
| U29 | minor | Root sizing and `onLayout` | accepted: R8.21 |
| U30 | nit | Tokens for prose numbers, layout protocol names, naming | accepted: R11.3 `control` tokens; `measure` and `assignSize`; glossary additions; `codePoint` |

## 17.2 Review 04, implementer

Forty-four findings from reading the specification against the sibling codebase. Findings that overlap review 02 (I1, I3, I20, I22, I25, I26, I27) resolved with it. The rest:

| Id | Severity | Subject | Resolution |
|---|---|---|---|
| I2 | blocker | Font asset pipeline unspecified | modified: R6.2 fixes the metrics schema and the licence rule generically; faces, tool, script, and paths are project decisions recorded in the implementation specification, section 5 |
| I4 | major | Icons need a generator; six glyphs uncovered | accepted: R12.6 icon atlas through the font pipeline; R6.3 corrected to six glyphs and points at the icon atlas |
| I5 | major | Screens silently rely on text-above-shapes | noted: chapter 14.6 migration notes; the four sites are phase 1 tasks |
| I6 | major | `children[n]` indexing and implicit children | accepted: R8.6 no implicit children, `getChildren()` never the render view |
| I7 | major | Components recursing into children themselves | accepted: R8.1 `render()` emits own draws only |
| I8 | major | Idempotent unmount and mount-on-add | accepted: R8.15 |
| I9, I10 | major | Window reads and two combat layouts | noted: migration; the combat stack is now the chapter 10 worked example |
| I11 | major | Override semantics on buttons | accepted with U12: R11.15 |
| I12 | major | Rounded corners for the first time; rounded clip | accepted: R12.19 and R12.20 inset content by the radius unless the rounded clip exists |
| I13 | major | Polygon edges lose multisampling | accepted: R5.17 CPU feather is now SHOULD |
| I14 | major | Estimates reflow; bold weight | accepted: R11.8 weight table; R6.12 cache keyed on role; reflow noted in 14.6 |
| I15 | major | Jest fit; no vitest bench | accepted: R14.1 and R15.41 no DOM at import; chapter 13 mapping row for tinybench |
| I16 | major | Playwright, SwiftShader, old Electron | accepted: R14.5 goldens from CI only; R15.42 Chromium floor with feature detection; the Electron upgrade ordering is in the implementation specification |
| I17 | major | Dev-only exclusion and gallery entry | accepted: chapter 13 mapping row for the `DefinePlugin` constant and the separate entry |
| I18 | major | Token generator placement and drift | accepted: R11.2 committed module with a drift test |
| I19 | major | Electron `file://` assets | accepted: R15.34 concrete |
| I21 | major | Wall-clock timers in UI code | accepted: R8.17 |
| I23 | major | Screen transitions | accepted with U28: ScreenTransition (R12.38), R8.22; the cross-fade is optional |
| I24 | major | Targeting scrim placement | modified: the 3.9 example uses a `raised` passthrough scrim with promoted targets; the reviewer's late-root variant also works and is not prohibited |
| I28 | minor | Sprites, particles, polylines, pinch scope | accepted: 12.9 and R2.10 |
| I29 | minor | Hand clipping versus hover lift | noted: migration (the hand does not clip) |
| I30 | minor | `fontFamily` alias | accepted: R11.14 |
| I31 | minor | Text position semantics | accepted: R12.4 top-left line box |
| I32, I33 | minor | Accessor codemod; half-open edges | noted: 14.6 |
| I34 | minor | Wheel step token | modified: `scroll_step` kept for keyboard scrolling; wheel uses normalised deltas |
| I35 | minor | TypeScript lib | accepted: R15.41 |
| I36 | minor | Matrix library | out of scope for the specification; noted for the implementer |
| I37 | minor | R5.29 versus R15.2 | accepted: R5.29 defers to R15.2 |
| I38 | minor | Frame domains without a world | accepted: R3.21 |
| I39 | minor | Snapshot ids | accepted with U20: R8.4 |
| I40 | minor | `char` derivation in the browser | accepted: R15.39 |
| I41 | minor | Text decoration | accepted: R12.4 and R11.14 |
| I42 | minor | Explicit focus scopes for target cycling | deferred: R9.20 scopes are subtree roots; an explicit-set scope is a candidate addition once the targeting flow is designed |
| I43 | nit | Provenance counts and tenses | accepted: R6.3, R8.24, R8.22, R2.2 corrected |
| I44 | nit | Missing review log | resolved by this chapter |
| chapter 14 | | Scoring corrections for the sibling engine | accepted: seven rows corrected, one row added |

## 17.3 Review 01, graphics engineer

Thirty-seven findings against draft 2 (one blocker, sixteen major), with a verification log of the primary sources fetched. All accepted; chapters 4 to 7 were rewritten as draft 3 and chapters 1, 2, 3, 12, 13, and 15 edited.

| Id | Severity | Subject | Resolution |
|---|---|---|---|
| G1 | major | Effective layer could go down; a host already high has nowhere to send its popup | accepted: R3.6 `max(own, parent)` with an authoring error; R3.6a hosted-high rule, overlay `bringToFront`, popups closed when a modal opens or an ancestor scrolls |
| G2 | major | Group opacity undefined against layers, clips, domains, target format | accepted: R3.26 rewritten (nested domain, premultiplied transparent target, no escape, fallback to scalar, pooled targets) |
| G3 | major | Mandated comparison sort; O(n log n) per frame | accepted: R3.10 per-layer partition; fast-path test reworded; `reorderedGroups` |
| G4 | minor | R3.2 forbade a free occlusion drop | accepted as MAY with the `occluded` counter |
| G5 | minor | Promotion under a rotated ancestor inherits the rotation | accepted: `detachTransform` in R3.8 |
| G6 | major | Fragment clip test on `gl_FragCoord` drags ratio, height, and a y flip into the shader | accepted: R4.4 tests an interpolated logical position; R5.28 drops those uniforms; chapter 7 updated |
| G7 | major | No CPU cull of draws outside the clip | accepted: R4.2a with the `culled` counter |
| G8 | minor | GPU-side "no clip" sentinel | accepted: R4.1 |
| G9 | major | Nested rounded clips undefined | accepted: R4.14 nesting rule; R12.19 inset when nesting |
| G10 | minor | Rotated clips under-clip with the AABB | accepted: oriented-rect clip as an option in R4.7 with a development warning |
| G11 | blocker | Border-over-fill formula produced a halo and let the backdrop through translucent borders | accepted: R5.8 exact coverage compositing in premultiplied form; R5.23 references it; pixel tests added |
| G12 | major | Quads not inflated for the ramp; ramp unspecified; shadow padding at two sigma | accepted: R5.6 linear one-pixel ramp, R5.7 inflation, R5.11 three-sigma padding |
| G13 | minor | Spread must grow corner radii; cite the CSS section | accepted: R5.11, R5.12 |
| G14 | minor | Gradients must interpolate premultiplied | accepted: R5.9 |
| G15 | major | The 64-byte instance could not hold the required fields | accepted: R5.4 gives a worked layout with side tables; the 15.11 attribute count corrected |
| G16 | major | "One GPU draw per texture switch" needed resident atlases and texture-agnostic shapes | accepted: R5.20 resident set, `textureSlotsExhausted`; R6.4 |
| G17 | major | Buffer ring too shallow; per-flush versus per-frame uniform block contradiction | accepted: R5.27 ring sizing; R5.28 and R15.15 per-flush slots; R15.11 |
| G18 | minor | Conflation seams between abutting quads; feather details | accepted: R5.10, R5.17, R7.8a |
| G19 | major | Pixel range 4 at 32 px below msdfgen's minimum under 16 px at ratio 1 | accepted: R6.4a range ratio of 1/6, clamp, raster fallback, scored small-size fixture, no token below 11 px |
| G20 | minor | Glyph coverage formula | accepted: R6.5 |
| G21 | minor | Run-snapping rationale wrong | accepted: R6.16 |
| G22 | major | `Intl.Segmenter` is not a line breaker | accepted: R6.13 explicit break opportunities and tests |
| G23 | minor | Emoji fallback must feed measurement and the ratio | accepted: R6.4c |
| G24 | major | Hairline rule and test asserted half thickness at ratio 2 | accepted: R7.8 per-edge and width snapping; R7.8a; test corrected |
| G25 | minor | Snapping must use `dpr * uiScale`; input conversion order | accepted: R7.2 defines `ratio`; R7.14 |
| G26 | nit | The ratio reaches more places than three | accepted: R7.2 lists them |
| G27 | major | One frame-spanning timer query includes idle bubbles; disjoint reads conflict with R15.22 | accepted: R13.16 per-pass queries; R15.22 exception; R15.24 |
| G28 | minor | Fence needs a flush; the fallback is latency | accepted: R15.23; R13.19 `gpu.latencyMs` |
| G29 | minor | Flush reasons listed impossible events; `drawCalls` ambiguous | accepted: R13.12, R13.13 rewritten |
| G30 | minor | Derivatives undefined, not zero, in non-uniform flow | accepted: R15.8 |
| G31 | minor | Chromium 134 not 128; SwiftShader wording; WebKit and `device-pixel-content-box` | accepted: R15.42, R15.33, R15.4, the chapter 13 mapping row, verification dates |
| G32 | minor | Drags need `setPointerCapture` on the canvas | accepted: R15.39 |
| G33 | nit | `Intl.Segmenter` lives in the ES2022 lib | accepted: R15.41 |
| G34 | major | Blend modes beyond `over` | accepted: R5.22a (`additive` free; `multiply` and `screen` split) |
| G35 | major | Render targets, resource lifetime, art residency, upload budgets unspecified | accepted: section 5.8a with default budgets as recommended values; counters in R13.14 |
| G36 | minor | Per-frame allocation of argument objects; instanced rotation | accepted: R5.26, R2.4 |
| G37 | nit | Multi-window and colour space | accepted: chapter 1 non-goals; R15.2 |

## 17.4 Review 03, worldsim maintainer

Run against draft 2 with the draft 3 chapters landing alongside. Every "worldsim does X" statement in chapters 0 to 16 was checked against the C++ source at main c2e06dd (2026-07-06), the development log, and the git history. Of about ninety checked statements, roughly seventy were accurate with file-level evidence, a dozen overstated or misattributed, four wrong in a way that would mislead a port (W1, W23, W31, W40 by the report's own summary), and one structural fact was missing (W60). Part 2 of the report critiques the fifteen design changes from worldsim's point of view; part 3 gives a migration order, now chapter 16.4. Resolved into draft 4.

| Id | Severity | Subject | Resolution |
|---|---|---|---|
| W1 | major | R3.14 named the wrong forwarders: three shapes forward a thread-local z, nine composites forward their own with offsets, Text, Button, and Dialog chrome forward nothing | accepted: R3.14, 3.11, and chapter 16 item 1 rewritten |
| W2 | minor | The two incidents are live code (task list view, entity info view), not logged; dialog chrome is at z 0 | accepted: R3.14 and 3.11 |
| W6 | minor | "For a month" was three weeks; previews beat dialogs, committed construction beat panels | accepted (the duration had already been cut from R3.21 in draft 3) |
| W7 | minor | Two extra flushes, not one, behind the +0.9 ms | accepted: R3.24 |
| W8 | minor | The first text incident was a separate text batch, not immediate drawing | accepted: 3.11 |
| W9 | minor | The popup-clicks incident is a consequence, not a logged symptom; cite the hand ordering | accepted: 3.11 |
| W12 | minor | Worldsim records one draw group per glyph, so R6.18 is a change, not a codification | accepted: R6.18, 16.1, item 29 |
| W14 | minor | No code comment flags the clip-transform hazard | accepted: chapter 16 intro; the draft 3 text of 4.6 no longer makes the claim |
| W16 | minor | One recorded clip-conversion bug, in the opposite direction; the Y flip is code, not an incident | accepted: the draft 3 R4.4 no longer makes the claim |
| W17 | major | Worldsim's scroll container does gate hit testing on its viewport | accepted: R4.12 and the chapter 14 row |
| W18, W19 | nit | Cite `ClipTypes.h` for R4.16; 35 shapes, not items | accepted |
| W20 | minor | The undefined `smoothstep` covers every line, circle, polygon, and icon stroke | accepted: R5.2, item 7 |
| W23 | major | Forced-opaque borders also discard the line tokens' alphas, a visible fidelity bug today | accepted: R5.8, item 8 raised, 16.4 step 3 |
| W24, W25 | minor, nit | 15 to 20 ALU, not 25; the zero uniform was the baked entity pass | accepted: 5.9, R5.28 |
| W26 | minor | `glGetIntegerv` is used by the planet renderer and render-to-texture, not every raw pass | accepted: R2.15, R15.22, item 26 |
| W30 | nit | Cite the ASCII-only atlas follow-up for R6.3 | accepted |
| W31 | major | Worldsim has no ellipsis | accepted: chapter 14 row |
| W32, W33 | nit | Kerning is an addition; the text shape ignores the family | accepted: R6.9, the chapter 14 row, item 31 |
| W35 | minor | All worldsim hit tests use closed edges; the mix is margin box versus content box | accepted: R8.12 |
| W36 | minor | Composites render their own children outside the sorted walk | accepted: R8.1, the chapter 14 row, item 30 |
| W37 | minor | Per-side margin is new | accepted: R8.2 |
| W38 | major | Hover is recomputed through a per-frame synthesised move event, not widget polling; the fix is two-sided | accepted: R9.8, 9.10, item 12 |
| W40 | major | No bubbling was a recorded decision with reasons | accepted: R9.6 acknowledges it and 9.10 answers the three reasons |
| W41 | minor | Stat and tab bar, not dropdown | accepted: R10.14 |
| W43 | minor | `totalWeight` 0 giving zero is a change | accepted: 10.9 |
| W44 | major | Motion tokens unused; `z_modal` and `z_panel` are used, the library's popups use literals | accepted: chapter 11 intro, item 18 |
| W45 | nit | The port changes dialog, tooltip, and toast timings from 100 and 300 ms to the tokens | accepted: R11.13 says so |
| W46 | minor | The theme header was deleted as the last step of the cutover, not because of drift | accepted: R11.2 |
| W47 | major | The tab bar draws hover; the defect is exclusive state priority | accepted: R11.11 |
| W48 | nit | The `control` category is new | accepted: R11.3 |
| W49 | minor | Style-property row: typed structs | accepted: R11.14 and the row |
| W51, W52, W53 | minor | Menu additions marked; two placement routines and a flag; absent components listed once | accepted: R12.11, R12.30, 14.5 |
| W55, W56 | minor | The metrics ring was lock-free from the start; cite d8f480c for the JSON bug | accepted: 13.12 |
| W57 | nit | The snapshot emits id and type today | accepted: the chapter 14 row |
| W58, W59 | minor | Chapter 14 cells and gap items as listed | accepted |
| W60 | major | Worldsim positions are absolute; R8.10 is a change and 16.3 overstated what is unchanged | accepted: R8.10, R8.11, item 28, 16.3 qualified |
| W61 | minor | Missing gap items | accepted: items 29 to 32 |
| W63 | minor | R1.6's letter fails worldsim's process-wide draw API, which 16.1 accepts | accepted: R1.6 scoped to services; the chapter 1 and 14 rows reworded |
| W64, W65 | nit | UI scale is recorded, not built; a year of development, not production | accepted: R7.5, README |
| W3, W4, W5, W10, W11, W13, W15, W21, W22, W27, W28, W29, W34, W39, W42, W50, W54, W62 | | Verified accurate | no change |

Design critique (part 2 of the report), by its numbering:

| Item | Subject | Resolution |
|---|---|---|
| 1 | Named layers: accept; land integers first with names as a constexpr table; the lint must exempt layer differences; the world domain keeps numeric keys | accepted: R3.23 allows any integer key in a non-UI domain, the `sibling-overlap` lint rule exempts differing effective layers, 16.4 step 2 gives the integer form |
| 2 | Inside as the default border position | accepted as written |
| 3 | Premultiplied alpha is cross-cutting and buys nothing visible on an opaque window | modified: R5.22 stays required for the shared design and says a native implementation may defer it on an opaque target |
| 4 | Mount context incrementally, with a shim and two arena invariants | accepted: 8.8 states the invariants; 16.4 step 7 |
| 5 | Take the pre-pass, framework hover, and capture; do not require bubbling | modified: R9.6 stays required (the dialog, list row, and card contracts depend on ancestors seeing unconsumed events) and now says the bubble path is the hit walk's ancestor stack; 9.10 answers the recorded reasons; 16.4 step 5 orders the migration so the bubble comes last and each earlier step is observable |
| 6 | Tombstone removal; `reconcileChildren` recommended | accepted: 8.8 allows tombstones; R8.27 lowered to SHOULD with the deck builder's requirement recorded; checklists split |
| 7 to 12 | Invalidation, layout before render, tree primitives, flat mode, three-state clip, per-pass sizes: accept | no change, except that R4.1 now allows a private no-clip encoding when empty draws are never uploaded |
| 13 to 15 | Transform, animator, and drag service should not fail a project with no use for them | modified: the rules stand; chapter 14, R14.9 lets an implementation score a required item not applicable with a recorded justification |
| tail | Arenas and handles, polled input, HTTP transport, C++ method conventions, typed style structs, the draw API as a process-wide instance | accepted: 8.8 (storage), R9.1 (mouse-only defaults), R8.23 (accessors scoped to languages with them), R11.14 (typed structs), R1.6 (draw API) |

The recommended order (part 3 of the report) is chapter 16.4.

## 17.5 Review 05, consistency editor

Run against draft 2 while draft 3 edits were landing (the reviewer noted the drift and kept its citations valid). Verified by tooling rather than by eye: every cited rule id exists (729 citations, 373 unique ids, no dangling references), no rule is defined twice, both chapter 13 JSON examples parse, no em dashes, no banned vocabulary, sentence-case headings throughout. Findings and resolutions:

| Id | Severity | Subject | Resolution |
|---|---|---|---|
| C1 | major | Glossary said promotion resets clip and offset; R3.8 and R4.8 say offset survives | accepted: glossary entry corrected |
| C2 | major | Glossary layer list missing `transition` | accepted |
| C3 | major | Glossary "visual state" described the exclusive model chapter 11 replaced | accepted: entry rewritten to the flag set |
| C4 | minor | Drag threshold token named differently in chapters 9 and 11 | accepted: R9.12a uses the two R11.3 tokens |
| C5 | minor | Snapshot `state` claimed the full flag set while `enabled` is top level | accepted: R13.22 prose |
| C6 | minor | Focus scope defined as a set in the glossary, a subtree root in chapter 9 | accepted: glossary entry |
| X2 to X5, X7 | major | Rule numbering out of file order in chapters 8, 9, 12, 15; letter suffixes undocumented | modified: the convention in chapter 00 and the README now state that a number identifies a rule, not a position, that revisions insert at the logical place with the next unused number or a letter suffix, and that numbers are never reused; nothing was renumbered, so existing citations stay valid |
| X8, K6 | major | Chapter 14's scoring table lagged the revised required items of chapters 3, 8, 9, 12 | accepted: table re-scored against draft 3 with the missing rows and chapter 12 split into groups |
| K1 | minor | Per-corner gradients: MAY versus recommended | modified: R5.9 raised to SHOULD (the design language depends on gradients) |
| K2 | minor | Multiple atlases per flush: MAY versus recommended | modified: R6.4 raised to MUST (the resident texture set requires it); checklist split |
| K3 | major | Perf capture script MUST scored recommended | accepted: chapter 13 checklist split |
| K4 | minor | Cross-origin isolation SHOULD (Electron) scored optional | accepted: row scoped to Electron and raised |
| K5 | minor | Goldens and perf comparison are gates but scored recommended | accepted: chapter 14 rows raised to required |
| K7 | nit | One row with two levels | accepted: split in chapter 1 |
| K8 | minor | "Out of scope" used as an undefined level | accepted: defined in chapter 00 as an unscored label |
| T3 | minor | "scroll offset" for `contentOffset` in two fixtures | accepted |
| T4 | nit | `margin.topLeft` shorthand | accepted: explicit components in R10.9 |
| S2 | minor | Unicode ellipsis inside code spans | accepted |
| R1 | | R11.12 as one 200-word sentence | accepted: ordered list |
| R2 | | R9.12 bundled eight behaviours | accepted: split into R9.12a to R9.12e |
| R3 | | R3.9 is guidance numbered as a rule | accepted: marked informative |
| R4 | nit | Chapter 9 opener listed topics instead of the decision | accepted |
| M1 | minor | Duplicate 14.6 heading | accepted: checklist is 14.7 |
| M2 | nit | Pipes inside a code span in a table row | accepted: reworded |

## 17.6 Open questions carried out of the review

- Whether an explicit-set focus scope (I42) is needed, or whether the targeting flow is a focus group over the targetable vehicles (R9.29).
- Whether `minSize` on text should default to the longest word or to zero when the container clips (R10.4 chooses the CSS answer; the deck builder's dense HUD rows will test it).
- Whether the off-screen composite for group opacity (R3.26) becomes required once screen transitions and fading panels are common.
- Worldsim adopts the layer ladder (chapter 16, item 1) in its integer form first, in one change with the sort test (chapter 16.4, from review 03); whether the names follow at the next token regeneration is that project's call.
