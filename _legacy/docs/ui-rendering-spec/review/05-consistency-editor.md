# R5 consistency editor findings

Spec dir: `docs/ui-rendering-spec/`. Full read of README.md and chapters 00-16 complete. Cross-reference audit, rule-id sequencing audit, and style greps complete (verified with grep, PowerShell regex, and an actual JSON parser where noted, not eyeballing).

**Caveat on scope drift.** This directory is under active concurrent revision by some other process in this same worktree. Partway through this review, every chapter file's mtime and byte size changed (line counts held steady, so this review's file:line citations remain valid), README's status line changed from "draft 1... Under review (see `17-review-log.md`)" to "draft 2... reviews 02 and 04 resolved, 01, 03, and 05 pending (see `17-review-log.md`)", and `17-review-log.md` (which the task brief said "does not exist yet") appeared on disk. Per my instructions I did not read chapter 17 or the review/ or research/ subfolders and did not use them as a source for any finding below; a handful of grep sweeps over `*.md` incidentally matched lines in 17-review-log.md and those matches were discarded, not cited. Worth knowing: the review numbering in that status line ("01, 03, and 05 pending") lines up with this file's own name (R5), so this pass is very likely "review 05" in that external tracking system, and some findings below may already be logged there under different IDs. Findings below are sourced only from chapters 00-16 and README as instructed.

Legend: severity = major | minor | nit.

---

## 1. Cross-chapter contradictions

**C1 (major).** Promotion's reset scope: glossary contradicts R3.8.
Location: `00-glossary-and-conventions.md:51` vs `03-render-order.md:35` (R3.8); `04-clipping.md:21` (R4.8) agrees with R3.8.
Problem: the glossary's Promotion entry says promotion "resets the inherited clip **and offset**." R3.8 says the opposite explicitly: promotion "resets the inherited clip stack to `none`... and nothing else: not the coordinate origin, **the content offset**, the transform, opacity, or `visible`." R4.8 restates R3.8's version. Two of three passages agree that offset survives promotion; the glossary says it doesn't. A reader who only checks the glossary will implement scrolled-content promotion wrong (e.g. a menu inside a scrolled list would jump position on promotion instead of following the trigger).
Proposed change: in `00-glossary-and-conventions.md:51`, change "and resets the inherited clip and offset" to "and resets the inherited clip (chapter 3, R3.8)".

**C2 (major).** Layer ladder: glossary is missing the `transition` layer chapter 3 added.
Location: `00-glossary-and-conventions.md:41` vs `03-render-order.md:32` (R3.5).
Problem: the glossary's Layer entry lists eight layers: `` `base`, `raised`, `overlay`, `modal`, `popup`, `toast`, `tooltip`, `drag` ``. R3.5 (the normative source) lists nine, ending in `transition`: "back to front: `base`, `raised`, `overlay`, `modal`, `popup`, `toast`, `tooltip`, `drag`, `transition`." This is exactly the kind of drift a revision leaves behind: chapter 3 added `transition` (per its own R3.9 rationale and R12.38's ScreenTransition) and the glossary summary was never updated to match. No other chapter's layer mentions contradict the nine-layer list; this is the one place it's incomplete.
Proposed change: in `00-glossary-and-conventions.md:41`, append `` , `transition` `` to the parenthetical list.

**C3 (major).** "Visual state" glossary definition describes the exclusive-state model chapter 11 explicitly rejected.
Location: `00-glossary-and-conventions.md:61` vs `11-style-and-theme.md:29` (R11.11) and `:30` (R11.12).
Problem: the glossary defines Visual state as a single resolved value from a closed set including `normal` and `disabled`: "the resolved interaction state of a component (`normal`, `hover`, `pressed`, `focusVisible`, `disabled`, `selected`, `open`, `active`)." R11.11 explicitly rejects a singular/exclusive model: "Every interactive component carries a set of boolean state flags... States compose; there is no single winning state," and even calls out the sibling engine's and worldsim's old exclusive-state bugs as the thing being fixed. The flag vocabularies also differ: glossary's `hover`/`disabled` vs R11.11's `hovered`/`enabled` (inverted sense), and the glossary is missing `focused` and `dropActive` entirely. The glossary entry describes the model the chapter explicitly replaced.
Proposed change: rewrite the glossary entry to "Visual state: the component's set of composable boolean state flags (`hovered`, `pressed`, `focused`, `focusVisible`, `enabled`, `selected`, `open`, `active`, `dropActive`) that style resolution layers together; no flag is exclusive. Chapter 11."

**C4 (minor).** Drag-threshold token named differently in the two chapters that use it.
Location: `09-input-and-focus.md:33` (R9.12) vs `11-style-and-theme.md:13` (R11.3).
Problem: R9.12 cites a single token: "(token `drag_threshold`: 4 for mouse and pen, 10 for touch)." R11.3's `control` category, which is exhaustively enumerated (the one category in that rule that names every token by exact identifier), instead lists two tokens: `drag_threshold_mouse`, `drag_threshold_touch`. Same concept, incompatible names; an implementer generating the token module from R11.3 has no `drag_threshold` to satisfy R9.12's citation.
Proposed change: in `09-input-and-focus.md:33`, change "(token `drag_threshold`: 4 for mouse and pen, 10 for touch)" to "(tokens `drag_threshold_mouse`: 4 and `drag_threshold_touch`: 10)".

**C5 (minor).** Tree-snapshot `state` object doesn't actually carry the full flag set it claims to.
Location: `13-observability-and-performance.md:87` (prose) and `:78-79` (JSON) vs `11-style-and-theme.md:29` (R11.11).
Problem: R13.22's prose says "`state` is the chapter 11, R11.11 flag set." R11.11 defines that set as nine flags: `hovered, pressed, focused, focusVisible, enabled, selected, open, active, dropActive`. The example JSON's `state` sub-object carries only eight of them; `enabled` is instead reported as a separate top-level field (line 75: `"enabled": true`). The claim overstates what the sub-object actually contains.
Proposed change: in `13-observability-and-performance.md:87`, change "`state` is the chapter 11, R11.11 flag set" to "`state` is the chapter 11, R11.11 flag set minus `enabled`, which is reported at the top level".

**C6 (minor).** "Focus scope" defined as a set of focusables in the glossary, as a subtree root in chapter 9.
Location: `00-glossary-and-conventions.md:38` vs `09-input-and-focus.md:51` (R9.20).
Problem: glossary: "Focus scope: **the set of focusables** Tab cycles through while a modal is open." R9.20: "A focus scope **is a subtree root**. Pushing a scope... makes that root the active scope; the order is derived from its subtree on demand." One definition is a collection, the other is the node the collection gets derived from. In practice these agree on behavior, but a reader citing "focus scope" from the glossary alone would model it as data rather than as a mount point.
Proposed change: in `00-glossary-and-conventions.md:38`, change to "Focus scope: a subtree root that becomes the active Tab-cycling scope while it holds focus (a modal opening pushes one). Chapter 9."

**Checked, no contradiction found:** default border position (only `05-primitives-and-shading.md:20`, R5.7, states a default; nothing elsewhere disagrees); clip-stack states (three states, `none`/`rect`/`empty`, stated identically at `02-draw-api.md:20`, `04-clipping.md:12`, `04-clipping.md:21`, `README.md:25`); frame phase order (input -> update -> layout -> render -> snapshot, identical in `01-architecture.md:38` R1.4, `08-object-model.md:42` R8.16, and consistent with the finer-grained input/update/layout/render/flush/present breakdown in `13-observability-and-performance.md:20` R13.7); hit-test conventions and `pointerEvents` defaults (chapters 3, 8, 9, 12 agree throughout, including per-component defaults in chapter 12 matching R8.29's auto/passthrough/unit/none rules); who owns dialog roots (chapters 3, 8, 12 agree the overlay service in the mount context owns them, R8.21 cited consistently); `clock`/`animator` naming (no "scheduler" anywhere in chapters 00-16; only `clock` and `animator` are used, consistently); `setLayoutSize` vs `assignSize` (only one place, R8.1, mentions `setLayoutSize` at all, explicitly as worldsim's alternate name for the spec's `assignSize`; chapter 10 uses only `assignSize`); `margin` as number-or-per-side (R8.2 establishes "per side, a number as shorthand" and every other mention is consistent with that shape); tooltip content shape (only one definition, R12.22).

---

## 2. Dangling or wrong cross-references

**X1 (informational, clean).** Full-corpus existence/prefix audit.
Method: extracted every `R<n>.<n>[letter]` token from chapters 00-16 and README (729 citation instances, 373 unique ids), and separately every rule actually defined (373 ids, one per definition line). The two sets are identical: every cited rule id exists somewhere in the corpus. Also checked every `chapter N, RX.Y` citation for N matching X's own chapter prefix: zero mismatches. No dangling or misattributed-chapter citations found anywhere.

**X2 (major).** Rule numbering scrambled within chapter 8.
Location: `08-object-model.md`.
Problem: file-order sequence of rule ids is 1,2,3,4,5,6,7,**27**,8,9,10,11,12,13,**26**,14,15,16,17,**28**,21,22,18,19,20,**29**,23,24,25. Five regression points where a later rule appears before earlier ones it should follow: R8.27 (line 26) before R8.8 (line 27); R8.26 (line 36) before R8.14 (line 40); R8.28 (line 44) before R8.21 (line 45); R8.22 (line 46) before R8.18 (line 50); R8.29 (line 56) before R8.23 (line 60). Rules 21/26/27/28/29 (the "draft 2, revised after review" additions) were each inserted at their contextually relevant spot in the prose rather than appended after R8.25, contrary to the numbering policy in `README.md:60` ("add new rules at the end of a chapter").
Proposed change: either append a note to chapter 00's conventions documenting that a revision may insert a new whole-numbered rule at its logical prose position (since that's clearly what happened here and in X3/X4), or physically move these five rules to the end of the chapter's rule list, keeping their numbers.

**X3 (major).** Rule numbering scrambled within chapter 9.
Location: `09-input-and-focus.md`.
Problem: six regression points: R9.30 (line 14) before R9.4 (line 18); R9.31 (line 24) before R9.10 (line 28); R9.27 (line 45) before R9.18 (line 49); R9.29 (line 56) before R9.26 (line 57); R9.26 (line 57) before R9.24 (line 58); R9.32 (line 62) before R9.25 (line 66). Same pattern as X2: rules 26/27/30/31/32 are post-review insertions placed by topic, not appended at chapter end.
Proposed change: same as X2.

**X4 (major).** Rule numbering scrambled within chapter 12.
Location: `12-component-catalog.md`.
Problem: six regression points: R12.36 (line 27) before R12.11 (line 31); R12.35 (line 38) before R12.18 (line 42); R12.34 (line 47) before R12.22 (line 51); R12.38 (line 53) before R12.24 (line 57); R12.39 (line 58) before R12.25 (line 59); R12.37 (line 64) before R12.30 (line 68). The new components the review added (R12.33 Popover, R12.34 FocusGroup, R12.35 RadioGroup, R12.36 NumberInput, R12.37 Scrollbar, R12.38 ScreenTransition, R12.39 Counter) are each filed next to the related existing section instead of at the chapter's end.
Proposed change: same as X2.

**X5 (minor).** Rule numbering out of sequence within chapter 15.
Location: `15-backend-webgl2.md`.
Problem: one regression point: R15.42 (line 72) before R15.35 (line 76). The whole 15.8a block (R15.39-R15.42, "Platform adapter details") sits before 15.9 and 15.10 (R15.35-R15.38), even though those are lower-numbered. Same insertion pattern as X2-X4 but a single swapped block rather than pervasive scrambling, and this chapter isn't one the task brief flagged as heavily revised.
Proposed change: same as X2, lower priority.

**X6 (informational, clean).** No rule id is defined twice anywhere in the corpus (checked by counting definition lines per id across all of chapters 00-16; max count was 1).

**X7 (minor).** Lettered sub-rule insertions aren't documented as a sanctioned numbering mechanism.
Location: `05-primitives-and-shading.md:21` (R5.7a, between R5.7 and R5.8); `06-text.md:15-17` (R6.4a, R6.4b, R6.4c, between R6.4 and R6.5).
Problem: these four rules use a letter suffix to insert next to their related parent rule, which (unlike X2-X4) keeps file order and number order in agreement, but the mechanism itself is never described anywhere in chapter 00's conventions (`00-glossary-and-conventions.md:5-12`) or the README's numbering policy (`README.md:58-60`), both of which say only that new rules go "at the end of a chapter."
Proposed change: add one sentence to chapter 00's conventions naming the letter-suffix pattern as the way to insert a rule adjacent to a related one without renumbering.

**X8 (major).** Chapter 14's aggregate scoring table (R14.4) was not updated for the revised required-item lists in chapters 3, 8, 9, and 12.
Location: `14-testing-and-conformance.md:27-101` (R14.4) vs `03-render-order.md:130-145`, `08-object-model.md:81-97`, `09-input-and-focus.md:87-106`, `12-component-catalog.md:76-89` (each chapter's own checklist).
Problem: this is exactly the drift the task brief asked about, and it's the single most consequential finding in this review since R14.4 is the table that scores worldsim and the sibling engine's conformance.
- Chapter 3 has 10 required checklist items; R14.4 carries only 9 chapter-3 rows. Missing: "Tree order: parent first, children by stable local `zIndex`, invisible skipped" (`03-render-order.md:137`).
- Chapter 8 has 13 required checklist items; R14.4 carries 8 chapter-8 rows (one of them, "No registration in constructors," is misfiled among the chapter-1 rows at `14-testing-and-conformance.md:33` instead of grouped with the rest). Missing entirely: "Properties of R8.2 with propagation rules and `pointerEvents`" (`08-object-model.md:86`); "`transform` ignored by layout, honoured by render and hit testing" (`08-object-model.md:90`, = R8.26, added by the review); "Read-only `screenBounds` and conversions; no window reads" (`08-object-model.md:91`); "Clock and animator with tweens, reduced motion, retargeting" (`08-object-model.md:94`, = R8.28, added by the review); "Overlay service owning overlay roots; roots sized from the viewport; `onLayout`" (`08-object-model.md:96`, = R8.21, added by the review).
- Chapter 9 has 15 required checklist items; R14.4 carries 9 chapter-9 rows. Missing entirely: "Queued dispatch at frame start against current geometry" (`09-input-and-focus.md:92`); "Click on the nearest common ancestor with a drag threshold" (`09-input-and-focus.md:96`, = R9.31, added by the review); "Drag-and-drop service with `dragenter`, `dragover`, `dragleave`, `drop`, `dragend`, `accept()`" (`09-input-and-focus.md:98`, = R9.12); "`activate` and `cancel` actions; `inputMode`" (`09-input-and-focus.md:101`, = R9.27, added by the review); "Directional focus" (`09-input-and-focus.md:103`, = R9.26, added by the review); wheel latching (part of R9.32, also added by the review) isn't distinguished from wheel normalisation in the one surviving row.
- Chapter 12's entire 8-row, roughly-35-component checklist (`12-component-catalog.md:78-88`) is scored as a single "Catalog" line (`14-testing-and-conformance.md:93`), whose evaluation text ("mostly (no image, checkbox, toggle)" / "no (button, input, panel only)") predates the four components the review made newly required (Popover, FocusGroup, RadioGroup, ScreenTransition) and says nothing about whether either engine has them.

Every gap lines up with rules added in the "draft 2, revised after review" pass (chapters 3, 8, 9, 10, 11, 12 per the task brief), which means R14.4 is currently scoring both reference implementations against the pre-review rule set for these four chapters.
Proposed change: add the missing rows to R14.4 for chapters 3, 8, and 9 (scored "not assessed" until re-audited against the current rules), regroup the misfiled "No registration in constructors" row with the other chapter-8 rows, and either expand chapter 12's "Catalog" row into per-group rows or add a note in 14.5 flagging that it predates the four newly-required components.

---

## 3. Terms used before definition or inconsistently

**T1.** "Visual state" vs the composable "state flags" model: see **C3** above (same finding, both categories 1 and 3 per the task brief).

**T2.** "Focus scope" as a set vs a subtree root: see **C6** above.

**T3 (minor).** "Content offset" (the defined term) vs "scroll offset" (used informally in test-fixture prose).
Location: `04-clipping.md:53` and `13-observability-and-performance.md:111`, both: "an animated scroll offset," vs `04-clipping.md:25` (R4.9) and `00-glossary-and-conventions.md:23`, which define and use only `contentOffset`.
Problem: the formally introduced property throughout chapters 3, 4, 8, 9, 10 is `contentOffset`; "scroll offset" never gets defined as an alias and appears only in these two required-tests/fixture descriptions, which could read as a second, different mechanism to someone skimming just those sections.
Proposed change: change both occurrences of "an animated scroll offset" to "an animated content offset."

**T4 (nit).** `margin.topLeft` / `padding.topLeft` used as if they were real fields.
Location: `10-layout.md:27` (R10.9): "`contentOrigin = position + margin.topLeft + padding.topLeft`".
Problem: R8.2 defines `margin` as `{ top, right, bottom, left }` and chapter 10 defines `padding` the same way; neither object has a literal `.topLeft` member anywhere else in the spec. This reads as informal vector shorthand for "(left, top)" but is written exactly like a property access.
Proposed change: replace with explicit component math, e.g. `contentOrigin = position + (margin.left, margin.top) + (padding.left, padding.top)`.

**Checked, no issue:** "component" vs "node" vs "element" (component is the domain term throughout; "node" is reserved for generic tree-theory phrasing and schema naming like "Node schema" in R13.22; the one bare use of "element," at `03-render-order.md:93`, is explicitly about CSS elements in a rationale paragraph about prior art, not this spec's own vocabulary); "layer" vs "domain" vs "band" (chapter 3's own terms section, `03-render-order.md:20`, defines a layer as "a named stacking band inside a domain," so "band" is the descriptive word for what a layer is, not a competing concept); `dpr` vs "pixel ratio" ("pixel ratio" never appears without the "device" qualifier anywhere in the corpus); "snapshot" vs "tree JSON" (glossary explicitly aliases them: "Snapshot (tree snapshot): the JSON serialisation of the live tree..."); `scheduler` vs `clock` (no "scheduler" anywhere in chapters 00-16; naming is uniformly `clock`/`animator`).

---

## 4. Conformance checklists

**K1 (minor).** Per-corner gradients: rule says MAY (optional), checklist says recommended.
Location: `05-primitives-and-shading.md:23` (R5.9: "Fill **MAY** be a per-corner colour... to give linear gradients") vs `:86` (checklist: "Per-corner gradients | recommended").
Problem: chapter 00's conventions map MUST/SHOULD/MAY to required/recommended/optional 1:1 (`00-glossary-and-conventions.md:7`). R5.9 uses MAY; the checklist scores it one level higher than the rule text supports.
Proposed change: change the checklist row's level from "recommended" to "optional" (or change R5.9 to SHOULD if recommended really is the intent).

**K2 (minor).** Multiple atlases per flush: rule says MAY, checklist says recommended.
Location: `06-text.md:14` (R6.4: "several atlases **MAY** share a frame and a flush") vs `:77` (checklist: "Multiple atlases per flush | recommended").
Problem: same pattern as K1.
Proposed change: change the checklist row's level to "optional."

**K3 (major).** Perf capture script: rule says MUST, checklist folds it into a "recommended" row.
Location: `13-observability-and-performance.md:124` (R13.38: "A capture script **MUST** drive the gallery through a fixed list of scenarios... **MUST** be off during capture") vs `:187` (checklist: "Perf capture script and comparison table | recommended").
Problem: R13.38 is unconditional MUST-level for the capture script itself; the checklist bundles it with R13.39's SHOULD-level comparison tool into a single row and scores the pair "recommended," silently downgrading a required item.
Proposed change: split the row into "Perf capture script (R13.38) | required" and "Comparison table (R13.39) | recommended."

**K4 (minor).** Cross-origin isolation: rule says SHOULD (for Electron), checklist says optional.
Location: `15-backend-webgl2.md:56` (R15.28: "Electron controls its own headers and **SHOULD** enable isolation") vs `:128` (checklist: "Cross-origin isolation for timer precision | optional").
Problem: the checklist item isn't scoped to Electron the way R15.28 is, so as written it under-states what R15.28 actually requires there. Lower confidence than K1-K3 since a browser deployment genuinely doesn't control this, which is a defensible reading of "optional" for the general case.
Proposed change: either scope the checklist row to "(Electron)" and raise it to "recommended," or soften R15.28 to MAY if the browser case is meant to set the bar.

**K5 (minor).** Chapter 14's own merge gates treat goldens and perf comparisons as mandatory; its checklist calls them recommended.
Location: `14-testing-and-conformance.md:20` (R14.7: merge gate for any UI change includes "screenshot goldens either unchanged or updated with the change reviewed visually") and `:21` (R14.8: merge gate for any renderer change includes "a perf capture comparison showing no regression") vs `:121-122` (checklist rows, both "recommended").
Problem: R14.7 and R14.8 both fold these into the gate that must pass before a change merges, which reads as required in substance, but the checklist scores them recommended (SHOULD-level).
Proposed change: raise both checklist rows to "required," or reword R14.7/R14.8 to make clear goldens and perf comparisons are conditional rather than gating.

**K6 (major).** Chapter 14's aggregate table (R14.4) is stale relative to the revised chapters. Full detail filed as **X8** in category 2 (the task brief's own wording for this check, "chapter 14's aggregated table rows that no longer match the chapters' required items after the revision," is category 4's, so recording it here too): missing rows for chapters 3, 8, 9, and a collapsed, pre-review "Catalog" row for chapter 12.

**K7 (nit).** Checklist row scored with two levels at once.
Location: `01-architecture.md:78`: "| Null and recording backends | required, recommended |".
Problem: every other checklist row in the corpus carries exactly one level; this row bundles the null backend (R2.21, MUST) and the recording backend (R2.22, SHOULD) under one comma-separated cell. Not wrong, but it's the only row in 17 chapters' worth of checklists formatted this way, and it doesn't machine-parse the way the rest of the table does.
Proposed change: split into two rows, "Null backend | required" and "Recording backend | recommended" (chapter 2's own checklist at `02-draw-api.md:79-80` already does exactly this split; chapter 1's row could just mirror it).

**K8 (minor).** "Out of scope" used as an undefined fourth conformance level, and inconsistently with how another chapter handles the same situation.
Location: `10-layout.md:75`: "| Wrap, grid | out of scope |" vs chapter 00's conventions (`00-glossary-and-conventions.md:7`) and the README's conformance-levels section (`README.md:42-44`), both of which define exactly three levels (required/recommended/optional = MUST/SHOULD/MAY); and vs `12-component-catalog.md:89`, where R12.10's "Out of scope for the baseline: multi-line, undo, IME composition..." (`12-component-catalog.md:26`) is folded into the ordinary "optional" row instead of getting its own "out of scope" row.
Problem: chapter 10 is the only checklist in the corpus using a level outside the defined three-level system, and chapter 12 handles the identical situation (a feature the prose calls "out of scope") differently, by just calling it optional.
Proposed change: either add "out of scope" as a defined fourth level in chapter 00's conventions (it's a meaningfully different claim than "optional," which implies MAY-implement; "out of scope" implies not-even-attempted), and apply it to chapter 12's out-of-scope items too, or fold chapter 10's row into "optional" to match chapter 12's convention.

---

## 5. Style compliance with the house rules

**S1 (clean).** Em dashes: zero found. Checked with two independent methods (`grep` against the raw UTF-8 byte sequence for U+2014, and a PowerShell scan comparing every line against `[char]0x2014`) across all of README.md and chapters 00-16. No file:line to report.

**S2 (minor).** Fancy Unicode ellipsis character (`…`, U+2026) used inside code-like text, where the house style calls for ASCII.
Location: `15-backend-webgl2.md:14` (R15.4: `` `matchMedia('(resolution: …dppx)')` ``) and `15-backend-webgl2.md:29` (R15.13: `` `vertexAttribDivisor(…, 1)` ``).
Problem: both instances put a literal "…" inside a backtick code span standing in for an omitted argument/value, which reads as broken example code (neither is valid JS as printed) as well as violating "no fancy unicode... ellipses as one character, type the ASCII versions."
Proposed change: line 14, change `'(resolution: …dppx)'` to something like `'(resolution: 2dppx)'` (a concrete example value); line 29, change `vertexAttribDivisor(…, 1)` to `vertexAttribDivisor(index, 1)`.

**S3 (clean).** Banned vocabulary (delve, leverage, robust, seamless, comprehensive, crucially, utilize, trailing "ensuring," etc.): ran the full banned-word list from the house style guide against every file. Five raw hits, all false positives on inspection: "dynamic entities" / "dynamic indexing" (`03-render-order.md:111`, `05-primitives-and-shading.md:43`, `15-backend-webgl2.md:32`, legitimate technical use of "dynamic," not the marketing adjective), "absolutely positioned" (`08-object-model.md:50`, a CSS/layout term, not the banned intensifier), and "the screenshot harness" (`13-observability-and-performance.md:120`, a test-harness noun, not the banned verb). No genuine violations found.

**S4 (clean).** "It's not X, it's Y" constructions and "not X but Y" negation-pivots: zero matches anywhere in scope.

**S5 (clean).** "Key takeaways" / "Summary" / "Conclusion" / TL;DR scaffolding headings: zero matches. Every chapter ends its normative content in a Rationale section, then Required tests, then the Conformance checklist, none of which are summary-scaffolding in the banned sense.

**S6 (clean).** Emoji: zero matches in any file.

**S7 (clean).** Heading case: every heading in every file (about 140 headings total) is sentence case; none found in Title Case.

**S8 (clean).** "**Bold lead-in:**" bullet pattern: zero matches anywhere. The document doesn't lean on bold text at all; nearly every bullet is a plain numbered rule or glossary entry.

**S9 (not applicable / clean).** Bullets padded to three: this document's lists are almost entirely numbered rules, glossary entries, and checklist/table rows rather than persuasive prose, so the "pad to three items" tell doesn't really apply; spot-checked a sample of prose bullet lists (e.g. `01-architecture.md` 1.2, `12-component-catalog.md` 12.9) and found no forced-third-item padding.

---

## 6. Readability (sampled)

**R1.** One sentence bundling six distinct decisions.
Location: `11-style-and-theme.md:30` (R11.12), first sentence.
Problem: "Style resolution layers the flags over the variant's base look in a fixed order: base (...) -> hover wash (...) -> pressed treatment (...) -> `open`, `active`, and `dropActive` accents (...) -> disabled treatment (...) -> focus ring (...)." is one sentence describing six sequential stages, each with its own trigger condition and visual detail, chained with arrow notation standing in for actual sentence structure.
Proposed change: turn the six stages into an ordered list (one item per arrow segment); the arrow order becomes the list order, which is more scannable than a 200-plus-word single sentence and easier to cite by stage in a future rule.

**R2.** One rule bundling the entire drag-and-drop protocol.
Location: `09-input-and-focus.md:33` (R9.12).
Problem: a single rule id covers starting a drag, the activation threshold, ghost promotion, per-move hit-testing and event synthesis, accept semantics, drop, cancellation, and tooltip suppression, roughly eight distinct testable behaviors under one citation.
Proposed change: split into lettered sub-rules (R9.12a start/threshold, R9.12b ghost and hit-testing during drag, R9.12c accept/drop/dragend, R9.12d cancellation, R9.12e tooltip suppression) following the pattern chapter 5 already uses for R5.7a; this also makes the required-tests list (`09-input-and-focus.md:79`) and any future conformance table able to cite the specific sub-behavior that's missing instead of "drag and drop, partially."

**R3.** A rule that's guidance, not a requirement, and reads that way.
Location: `03-render-order.md:36` (R3.9).
Problem: "Intended use of each layer. `base`: ordinary screen content. `raised`: content that must float above its siblings' neighbours but is not a popup..." is advisory content (when to reach for which layer) with zero RFC 2119 keywords anywhere in the rule. Consistent with that, it has no corresponding conformance-checklist item (chapter 3's checklist scores the layer *ladder*, promotion, and clip reset, at `03-render-order.md:136`, but never "intended use"). It reads correctly as prose; the issue is only that it's numbered and cited like a testable rule (e.g. `03-render-order.md:81`: "sets `layer: raised`... valid targets are promoted to `overlay`" doesn't actually cite R3.9, so nothing currently depends on it being a rule).
Proposed change: no functional change needed; consider moving it to the chapter's Rationale section or explicitly labeling it non-normative, so a reader scanning for testable requirements doesn't have to determine that on their own.

**R4 (nit).** Chapter opening that lists topics rather than stating a decision.
Location: `09-input-and-focus.md:5`.
Problem: most chapters open with a one-line decision ("The draw API is the only way pixels reach the GPU"; "Every public number in this specification is a logical pixel"). Chapter 9's opener instead lists what the chapter covers ("This chapter defines the event model..., the hit-test walk..., bubbling, pointer capture, the drag-and-drop protocol, popup dismissal, keyboard routing..., and focus...") without stating a governing decision up front. Minor relative to the rest of the document, which is otherwise consistently decision-first.
Proposed change: lead with the actual governing decision (e.g., "Hit testing mirrors the paint order in reverse; that's the one rule everything else in this chapter hangs off") before the topic list.

---

## 7. Markdown hygiene (sampled)

**M1 (minor).** Duplicate section number.
Location: `14-testing-and-conformance.md:107` ("## 14.6 Migration notes for an engine that reorders text") and `:113` ("## 14.6 Conformance checklist").
Problem: two different `##` headings both numbered 14.6. Every other chapter's section numbers are unique and sequential.
Proposed change: renumber the second one (Conformance checklist) to 14.7.

**M2 (nit).** Table row with unescaped literal pipes inside a code span.
Location: `13-observability-and-performance.md:149`, the "Scene control" row of the backend-mapping table: `` `GET /api/control?action=scene|pause|resume|reload|exit|vsync` ``.
Problem: the pipes inside that backtick span are literal OR-separators for an enum of query values, not column separators, and GitHub's renderer is code-span-aware so it displays fine there, but a naive/strict Markdown table parser (a docs generator, a linter) that splits cells on every `|` regardless of code spans will see 8 columns instead of 3 for this one row. It's the only row like this in the whole corpus; every other table cell with special characters is fine.
Proposed change: escape the internal pipes (`scene\|pause\|resume\|reload\|exit\|vsync`) or reword to prose ("the `action` query param takes `scene`, `pause`, `resume`, `reload`, `exit`, or `vsync`").

**M3 (clean).** JSON validity in chapter 13: both fenced JSON blocks (`13-observability-and-performance.md:29-41`, the frame snapshot, and `:71-84`, the node schema) were extracted and parsed with an actual JSON parser (PowerShell `ConvertFrom-Json`), not just eyeballed. Both are valid JSON.

**M4 (clean at time of writing).** README relative links: all 19 links (chapters 00-16, 17, `research/README.md`, `review/README.md`) resolve to files that exist on disk right now. Caveat: per the scope-drift note at the top of this file, `17-review-log.md` did not exist when this review began (matching the task brief's "17 does not exist yet") and appeared mid-session; had this check been run at the start, that one link would have been dangling.

**M5 (clean).** Heading levels: no skipped levels (h1 -> h3 without h2, etc.) anywhere in the 17 in-scope files.

**M6 (clean).** Code fences: every fenced block is paired (fence-count per file is even everywhere a fence appears: `01-architecture.md` and `02-draw-api.md` have one pair each, `13-observability-and-performance.md` has two pairs, everything else has zero).

---

## Summary

Checked README plus chapters 00-16 in full against the seven categories; the spec directory changed under me mid-review (see the caveat at the top), but line counts held steady so citations below are current. Two genuinely major cross-chapter contradictions: the glossary says promotion resets clip and offset while R3.8/R4.8 say offset survives promotion, and the glossary's layer list is missing the `transition` layer chapter 3 added (C1, C2). The glossary's "Visual state" entry also describes the exclusive single-state model chapter 11 explicitly replaced with composable flags (C3). Rule numbering is scrambled (file order disagrees with numeric order) throughout chapters 8, 9, and 12, all three of the "heavily revised" chapters, plus a milder case in 15 (X2-X5); every scrambled id traces to a rule the review added and inserted by topic instead of at chapter end. The most consequential finding is that chapter 14's aggregate scoring table never got updated for chapters 3, 8, 9, and 12's revised required-item lists, so it's currently scoring both reference implementations against a pre-review rule set, missing rows for R8.21/26/28, R9.12/26/27/31/32, R3's tree-order rule, and four newly-required chapter-12 components (X8/K6). Five checklist rows disagree with their own chapter's RFC 2119 keyword (three MAY-as-recommended, one MUST-as-recommended, one SHOULD-as-optional; K1-K5). Style compliance is otherwise clean: no em dashes, no banned vocabulary, no "it's not X, it's Y," no emoji, no summary scaffolding, sentence-case headings throughout, both chapter-13 JSON examples parse as valid JSON. Minor Markdown issues: a duplicate "14.6" section number and one table row with unescaped pipes in a code span.
