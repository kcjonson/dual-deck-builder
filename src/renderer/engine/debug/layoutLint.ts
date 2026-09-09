/**
 * The layout lint of R13.25 to R13.29: a pure function over the tree snapshot
 * document of R13.22 to R13.24.
 *
 * Imports nothing. No GL, no DOM, no `window`, no reference to the rendering
 * layer, so the same code runs in Jest over hand-built objects and in the
 * browser over `window.__ui.tree()` (R13.4, R13.11 mapping row).
 *
 * The input types below are declared here rather than imported from
 * treeSnapshot so this module has no dependency on the serializer at all. They
 * are a structural superset: every field R13.22 defines that a rule reads is
 * declared, and the phase-dependent ones are optional, so today's
 * `SnapshotDocument` is assignable to `LintDocument` without a cast and stays
 * assignable as phase 2 and phase 4 add fields.
 *
 * Geometry is computed in screen space (`screenBounds`) throughout, because
 * rule 2 compares a child against its parent and rule 3 compares a node against
 * the viewport, and those live in different coordinate spaces if `bounds` is
 * used. The rect reported on a violation is the node's own `bounds`, which is
 * the field R13.28 names.
 *
 * Absence never exempts. Where a rule's exemption depends on a field the
 * snapshot may not carry (`zIndex`, `layer`, `wrap`), the exemption applies
 * only when the field is actually present on both sides of the comparison. An
 * absent `zIndex` read as 0 on both nodes would turn "no stacking declared"
 * into "same stacking declared" and silently exempt every pair in phase 0.
 *
 * R13.29 makes `count: 0` the merge gate. Per the implementation spec's ground
 * rules that gate applies to the gallery first and to each screen as it
 * migrates, so nothing here is wired into CI.
 */

export interface LintRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LintPoint {
	x: number;
	y: number;
}

export interface LintEdges {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface LintTextMeasure {
	w: number;
	h: number;
	lines?: number;
}

export interface LintText {
	content?: string;
	measured?: LintTextMeasure;
	/** Observed outcome; `clip` and `ellipsis` exempt (R6.14, R12.4). */
	overflow?: string;
	/** Authored wrap mode, `none` or `word` (R12.4). */
	wrap?: string;
}

export interface LintNode {
	id?: string | null;
	type: string;
	/** Margin box in the parent's content-box space (R13.22). */
	bounds: LintRect;
	/** Content box in viewport space (R13.22). */
	screenBounds: LintRect;
	visible: boolean;
	/** Effective clip: the intersection of every clipping ancestor. */
	clip?: LintRect;
	/** Emitted only by scroll containers, which overflow by design. */
	contentOffset?: LintPoint;
	zIndex?: number;
	layer?: string;
	margin?: LintEdges;
	focusable?: boolean;
	pointerEvents?: string;
	text?: LintText;
	children?: readonly LintNode[];
}

export interface LintDocument {
	viewport: { width: number; height: number };
	roots: readonly LintNode[];
}

export type LintRuleName =
	| 'sibling-overlap'
	| 'child-outside-parent'
	| 'outside-viewport'
	| 'zero-or-negative-size'
	| 'text-overflow'
	| 'unreachable-interactive'
	| 'target-size';

/**
 * R13.28's shape. `otherPath` and `otherBounds` are absent, not null, on a
 * single-node violation: R13.28 is silent on the point, and the nearest
 * guidance is R13.22's own convention that a field which does not apply is
 * omitted rather than emitted as a plausible default. This is an inference,
 * recorded here because it is the one place the output shape is not dictated.
 *
 * `bucket` is additive and appears only where a rule splits its findings; see
 * ZERO_SIZE_BUCKETS.
 */
export interface LintViolation {
	rule: LintRuleName;
	path: string;
	bounds: LintRect;
	otherPath?: string;
	otherBounds?: LintRect;
	bucket?: string;
}

/**
 * Per-rule diagnostics. A rule that cannot fire because the document does not
 * carry its input must not read as a silent pass, so every rule reports how
 * many candidates it tested, how many it let off, and how many it had to skip
 * for want of a field. `dormant` is the summary of that: the rule tested
 * nothing and skipped something.
 */
export interface LintRuleReport {
	rule: LintRuleName;
	violations: number;
	/** Nodes (or sibling pairs) actually tested. */
	evaluated: number;
	/** Candidates let off by a declared intent, not by passing the test. */
	exempt: number;
	/** Candidates the rule could not test because a required field was absent. */
	skippedMissingInput: number;
	/** Which fields were absent, when anything was skipped. */
	missingInput?: string[];
	dormant: boolean;
	buckets?: Record<string, number>;
}

export interface LintResult {
	count: number;
	violations: LintViolation[];
	rules: LintRuleReport[];
}

export interface LintOptions {
	/** R13.25.7: the minimum target grows from 24 to 44 under a touch profile. */
	touchProfile?: boolean;
}

/** R13.27, exactly. Rules 1, 2 and 3 measure against it. */
export const EPSILON = 0.5;

export const TARGET_SIZE_MIN = 24;
export const TARGET_SIZE_MIN_TOUCH = 44;

/**
 * Rule 4's buckets.
 *
 * Run against the live game in phase 0 the rule is, in practice, a Text
 * detector: every zero-size node in every capture is a Text, and no Rectangle,
 * Button, Panel or Layer ever reports zero. The cause is structural, not a
 * layout bug: `Text.render` reads width and height for alignment and assigns
 * neither, only `Text.layout()` writes them, and the frame loop never calls it.
 * The counts behind that claim, and how they were taken, are in
 * `.claude/notes/ddb55-phase0-recon.md`; they belong with the capture, not in
 * a comment that cannot be re-derived from the code beside it.
 *
 * Suppressing Text would hide the one class of node the rule can currently see,
 * and reporting it undifferentiated buries the case the rule exists for: a
 * Rectangle or Button that really did collapse. Every violation is therefore
 * still reported, and each carries the bucket it belongs to, so a consumer
 * filters on `bucket !== 'unmeasured-text'` to get the signal and reads
 * `rules[].buckets` for the split. The discriminator is the type *and* the
 * absence of `text.measured`, so when phase 2's measurement service lands a
 * Text whose box genuinely collapsed moves to `zero-box` on its own and the
 * prescribed filter stops hiding it.
 */
export const ZERO_SIZE_BUCKETS = {
	unmeasuredText: 'unmeasured-text',
	zeroBox: 'zero-box',
} as const;

const RULE_NAMES: readonly LintRuleName[] = [
	'sibling-overlap',
	'child-outside-parent',
	'outside-viewport',
	'zero-or-negative-size',
	'text-overflow',
	'unreachable-interactive',
	'target-size',
];

/** R13.25.6 and .7: what counts as interactive, in R8.29's vocabulary. */
const INTERACTIVE_POINTER_EVENTS: readonly string[] = ['auto', 'unit'];

/**
 * Rule 6's non-occluders. R8.29 gives `none` and `passthrough` different
 * subtree semantics, but both make the node's *own* box transparent to hits,
 * and rule 6 compares a target against a sibling's own box and never descends
 * into that sibling's children. So neither can make a target unreachable here.
 *
 * R3.27 gives `opacity: 0` the same property. R13.22 emits no opacity, so that
 * case defers to phase 3 along with the rest of R8.29's vocabulary rather than
 * being guessed at from a field that is not there.
 */
const TRANSPARENT_TO_HITS: readonly string[] = ['none', 'passthrough'];

/**
 * treeSnapshot's guards, mirrored. That module produces this one's input and
 * caps its own walk at the same depth, so a serializer-produced document is
 * never truncated here; the cap only catches a hand-built or hand-edited
 * document, where a node in its own children array would otherwise be an
 * immediate RangeError.
 */
const MAX_DEPTH = 256;

/** R6.14 and R12.4: overflow modes that make an over-long text deliberate. */
const HANDLED_TEXT_OVERFLOW: readonly string[] = ['clip', 'ellipsis'];

const MISSING_INTERACTIVITY = ['focusable', 'pointerEvents'];
const MISSING_TEXT = ['text'];
const MISSING_TEXT_MEASURE = ['text.measured'];

/**
 * Rule 5's candidates. `text` is the field that makes a node a text node, but
 * phase 0's serializer omits the whole object, so the type name is the fallback
 * signal that a candidate was there and went untested. R12.4 names the
 * component Text, so the name is schema, not an engine detail.
 */
const TEXT_TYPE = 'Text';

/** A hand-built document can carry anything; NaN would fail every comparison silently. */
function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function rect(value: LintRect | undefined): LintRect {
	if (!value) return { x: 0, y: 0, w: 0, h: 0 };
	return { x: num(value.x), y: num(value.y), w: num(value.w), h: num(value.h) };
}

function overlapOnAxis(aStart: number, aSize: number, bStart: number, bSize: number): number {
	return Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart);
}

/** How far `inner` pokes out of `outer` on its worst side. Negative when contained. */
function escape(inner: LintRect, outer: LintRect): number {
	return Math.max(
		outer.x - inner.x,
		outer.y - inner.y,
		inner.x + inner.w - (outer.x + outer.w),
		inner.y + inner.h - (outer.y + outer.h),
	);
}

function isInteractive(node: LintNode): boolean {
	if (node.focusable === true) return true;
	return typeof node.pointerEvents === 'string' && INTERACTIVE_POINTER_EVENTS.indexOf(node.pointerEvents) >= 0;
}

/** True only when the document actually says something about interactivity. */
function declaresInteractivity(node: LintNode): boolean {
	return typeof node.focusable === 'boolean' || typeof node.pointerEvents === 'string';
}

/**
 * R13.25.1: differing `zIndex` or differing effective layer is declared
 * stacking intent. Both sides must carry the field for the difference to be
 * declared; one side alone declares nothing.
 */
function declaresDifferentStacking(a: LintNode, b: LintNode): boolean {
	if (typeof a.zIndex === 'number' && typeof b.zIndex === 'number' && a.zIndex !== b.zIndex) return true;
	if (typeof a.layer === 'string' && typeof b.layer === 'string' && a.layer !== b.layer) return true;
	return false;
}

/** Same test, one field: rule 6 restricts coverage to siblings in the same layer. */
function declaresDifferentLayer(a: LintNode, b: LintNode): boolean {
	return typeof a.layer === 'string' && typeof b.layer === 'string' && a.layer !== b.layer;
}

/**
 * Paint order among siblings (R3.28): higher `zIndex` paints later, and at
 * equal or undeclared `zIndex` submission order decides. Absence falls back to
 * document order rather than to 0, so an undeclared node is neither promoted
 * nor demoted against a declared one.
 */
function paintsAbove(candidate: LintNode, candidateIndex: number, node: LintNode, nodeIndex: number): boolean {
	if (typeof candidate.zIndex === 'number' && typeof node.zIndex === 'number' && candidate.zIndex !== node.zIndex) {
		return candidate.zIndex > node.zIndex;
	}
	return candidateIndex > nodeIndex;
}

function pathSegment(node: LintNode, index: number, idRepeatsAmongSiblings: boolean): string {
	const id = typeof node.id === 'string' ? node.id : '';
	// R13.28: ids when present, `Type[index]` otherwise. The index is the
	// node's position among its parent's children, counted before invisible
	// subtrees are dropped, so a path does not shift when a sibling hides.
	if (id.length === 0) return `${node.type}[${index}]`;
	// The one deviation from R13.28's letter, and the second inference in this
	// file. Taken literally the rule gives two siblings that share an id the
	// same path, and a baseline diff then cannot tell their rows apart: they
	// silently collapse into one. Disambiguating with the index the rule
	// already defines reports the collision instead of hiding it, which is the
	// lesser of the two departures. Duplicate ids upstream are their own fix;
	// this only stops the lint from laundering them.
	return idRepeatsAmongSiblings ? `${id}[${index}]` : id;
}

function join(parentPath: string, segment: string): string {
	return parentPath.length > 0 ? `${parentPath}/${segment}` : segment;
}

interface Candidate {
	node: LintNode;
	path: string;
	/** Position in the parent's children array, invisible siblings included. */
	index: number;
	bounds: LintRect;
	screen: LintRect;
}

/**
 * The node's margin box in screen space. R13.22 makes `bounds` the margin box
 * and `screenBounds` the content box, so the margin box in the space the
 * geometry rules compare in has to be reconstructed from `screenBounds` plus
 * `margin`; `bounds` cannot be used directly because it is expressed in the
 * parent's content-box space. Absent `margin`, the content box is all the
 * document says, and inflating by a guess would invent overflow.
 */
function marginBox(candidate: Candidate): LintRect {
	const margin = candidate.node.margin;
	if (!margin) return candidate.screen;
	const left = num(margin.left);
	const top = num(margin.top);
	return {
		x: candidate.screen.x - left,
		y: candidate.screen.y - top,
		w: candidate.screen.w + left + num(margin.right),
		h: candidate.screen.h + top + num(margin.bottom),
	};
}

class RuleTally {
	violations = 0;
	evaluated = 0;
	exempt = 0;
	skippedMissingInput = 0;
	missingInput: string[] = [];
	buckets: Record<string, number> | undefined;

	skip(fields: readonly string[]): void {
		this.skippedMissingInput++;
		for (const field of fields) {
			if (this.missingInput.indexOf(field) < 0) this.missingInput.push(field);
		}
	}

	bucket(name: string): void {
		if (!this.buckets) this.buckets = {};
		this.buckets[name] = (this.buckets[name] ?? 0) + 1;
	}
}

/**
 * Run the seven required rules of R13.25 over a tree snapshot document.
 *
 * @param document An R13.23 document. Invisible subtrees are skipped entirely
 *   (R13.27), so a hidden parent hides its visible children too.
 * @param options `touchProfile` raises rule 7's minimum target to 44 px. Null
 *   is accepted as well as absent: a default parameter only fires on
 *   `undefined`, and a caller reaching this from `page.evaluate` or a JSON
 *   round trip has an easy time producing an explicit null.
 */
export function layoutLint(document: LintDocument, options: LintOptions | null = {}): LintResult {
	const violations: LintViolation[] = [];
	const tallies = new Map<LintRuleName, RuleTally>();
	for (const name of RULE_NAMES) tallies.set(name, new RuleTally());

	const tally = (rule: LintRuleName): RuleTally => tallies.get(rule) as RuleTally;

	const report = (rule: LintRuleName, subject: Candidate, other?: Candidate, bucket?: string): void => {
		tally(rule).violations++;
		const violation: LintViolation = { rule, path: subject.path, bounds: subject.bounds };
		if (other) {
			violation.otherPath = other.path;
			violation.otherBounds = other.bounds;
		}
		if (bucket) violation.bucket = bucket;
		violations.push(violation);
	};

	const viewport: LintRect = {
		x: 0,
		y: 0,
		w: num(document?.viewport?.width),
		h: num(document?.viewport?.height),
	};

	const toCandidates = (nodes: readonly LintNode[] | undefined, parentPath: string): Candidate[] => {
		if (!Array.isArray(nodes)) return [];
		// Counted over every sibling, invisible ones included, for the same
		// reason the index is: hiding a node must not rename the one beside it.
		const idCounts = new Map<string, number>();
		for (const node of nodes) {
			const id = node && typeof node.id === 'string' ? node.id : '';
			if (id.length > 0) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
		}
		const candidates: Candidate[] = [];
		nodes.forEach((node, index) => {
			// R13.27: the subtree goes with the node, not just the node.
			if (!node || node.visible !== true) return;
			const repeats = (idCounts.get(typeof node.id === 'string' ? node.id : '') ?? 0) > 1;
			candidates.push({
				node,
				path: join(parentPath, pathSegment(node, index, repeats)),
				index,
				bounds: rect(node.bounds),
				screen: rect(node.screenBounds),
			});
		});
		return candidates;
	};

	/** Rule 1. Roots are a sibling group like any other (R13.27). */
	const siblingOverlap = (group: readonly Candidate[]): void => {
		const rule = tally('sibling-overlap');
		for (let i = 0; i < group.length; i++) {
			for (let j = i + 1; j < group.length; j++) {
				const a = group[i];
				const b = group[j];
				if (declaresDifferentStacking(a.node, b.node)) {
					rule.exempt++;
					continue;
				}
				rule.evaluated++;
				// Touching edges are not overlap, so the comparison is strictly
				// greater than epsilon: an abutment gives 0, and an overlap of
				// exactly epsilon is still within tolerance.
				//
				// R13.25.1's "beyond what a negative stack gap allows" is not
				// computable here: R13.22 carries no container gap, so epsilon
				// is the whole allowance. That extension belongs with the gap
				// field, not with a guess.
				const x = overlapOnAxis(a.screen.x, a.screen.w, b.screen.x, b.screen.w);
				if (x <= EPSILON) continue;
				const y = overlapOnAxis(a.screen.y, a.screen.h, b.screen.y, b.screen.h);
				if (y <= EPSILON) continue;
				report('sibling-overlap', a, b);
			}
		}
	};

	/**
	 * Rule 2. Ink overflow is excluded by construction: `inkBounds` is never
	 * read. R13.25.2 names the child's *bounds*, which R13.22 defines as the
	 * margin box, so the child is compared as its margin box against the
	 * parent's content box. Phase 0 emits no `margin` and the two boxes
	 * coincide; phase 1 makes the difference real.
	 *
	 * No exemption for a scroll container. R13.25.2 grants none, and the intent
	 * signal that would carry one, `contentOffset`, sits on the Panel, whose
	 * only children are a background sized to the panel and a content layer
	 * sized to the panel. The rows that actually overflow are a level below it
	 * and would never have been reached by a parent-side test anyway.
	 */
	const childOutsideParent = (child: Candidate, parent: Candidate): void => {
		const rule = tally('child-outside-parent');
		rule.evaluated++;
		if (escape(marginBox(child), parent.screen) > EPSILON) report('child-outside-parent', child, parent);
	};

	/**
	 * Rule 3. Deliberately not exempting a node scrolled out of a clip: R13.25.3
	 * reads plainly, and rule 6 is the one that judges reachability.
	 */
	const outsideViewport = (candidate: Candidate): void => {
		const rule = tally('outside-viewport');
		rule.evaluated++;
		if (escape(candidate.screen, viewport) > EPSILON) report('outside-viewport', candidate);
	};

	/** Rule 4. `w <= 0` OR `h <= 0`; see ZERO_SIZE_BUCKETS for why the split exists. */
	const zeroOrNegativeSize = (candidate: Candidate): void => {
		const rule = tally('zero-or-negative-size');
		rule.evaluated++;
		// The content box is what draws, so the test is on screenBounds. An AND
		// here would miss the Text nodes that have a real width and a zero
		// height, which are close to a third of the live findings.
		if (candidate.screen.w > 0 && candidate.screen.h > 0) return;
		// Type alone would keep bucketing a phase-2 Text that really did
		// collapse as `unmeasured-text`, and the filter this module prescribes
		// would then drop a real defect. A measurement present says the phase-0
		// cause has been ruled out.
		const unmeasuredText = candidate.node.type === TEXT_TYPE && !candidate.node.text?.measured;
		const bucket = unmeasuredText ? ZERO_SIZE_BUCKETS.unmeasuredText : ZERO_SIZE_BUCKETS.zeroBox;
		rule.bucket(bucket);
		report('zero-or-negative-size', candidate, undefined, bucket);
	};

	/** Rule 5. Dormant until a measurement service supplies `text.measured` (phase 2). */
	const textOverflow = (candidate: Candidate): void => {
		const text = candidate.node.text;
		const rule = tally('text-overflow');
		if (!text) {
			if (candidate.node.type === TEXT_TYPE) rule.skip(MISSING_TEXT);
			return;
		}
		const measured = text.measured;
		if (!measured || typeof measured.w !== 'number' || typeof measured.h !== 'number') {
			rule.skip(MISSING_TEXT_MEASURE);
			return;
		}
		if (
			(typeof text.overflow === 'string' && HANDLED_TEXT_OVERFLOW.indexOf(text.overflow) >= 0) ||
			(typeof text.wrap === 'string' && text.wrap !== 'none')
		) {
			rule.exempt++;
			return;
		}
		rule.evaluated++;
		// No epsilon: R13.27 scopes it to the geometry rules, and measurement is
		// exact by R6.11, so a sub-pixel excess is a real excess.
		if (num(measured.w) > candidate.screen.w || num(measured.h) > candidate.screen.h) {
			report('text-overflow', candidate);
		}
	};

	/** Rule 6. Dormant until R8.29's vocabulary reaches the snapshot (phase 3). */
	const unreachableInteractive = (candidate: Candidate, group: readonly Candidate[]): void => {
		const rule = tally('unreachable-interactive');
		if (!declaresInteractivity(candidate.node)) {
			rule.skip(MISSING_INTERACTIVITY);
			return;
		}
		if (!isInteractive(candidate.node)) return;
		rule.evaluated++;

		const clip = candidate.node.clip;
		if (clip) {
			const clipped = rect(clip);
			const x = overlapOnAxis(candidate.screen.x, candidate.screen.w, clipped.x, clipped.w);
			const y = overlapOnAxis(candidate.screen.y, candidate.screen.h, clipped.y, clipped.h);
			// An empty intersection, not a thin one: a sliver is still a target.
			if (x <= 0 || y <= 0) {
				report('unreachable-interactive', candidate);
				return;
			}
		}

		for (const other of group) {
			if (other === candidate) continue;
			if (typeof other.node.pointerEvents === 'string' && TRANSPARENT_TO_HITS.indexOf(other.node.pointerEvents) >= 0) {
				continue;
			}
			if (declaresDifferentLayer(candidate.node, other.node)) continue;
			if (!paintsAbove(other.node, other.index, candidate.node, candidate.index)) continue;
			// Entirely covered, with the same epsilon tolerance the geometry
			// rules use: a target poking out by a third of a pixel is not
			// reachable in any useful sense.
			if (escape(candidate.screen, other.screen) <= EPSILON) {
				report('unreachable-interactive', candidate, other);
				return;
			}
		}
	};

	/** Rule 7. Dormant for the same reason as rule 6. */
	const targetSize = (candidate: Candidate): void => {
		const rule = tally('target-size');
		if (!declaresInteractivity(candidate.node)) {
			rule.skip(MISSING_INTERACTIVITY);
			return;
		}
		if (!isInteractive(candidate.node)) return;
		rule.evaluated++;

		const minimum = options?.touchProfile === true ? TARGET_SIZE_MIN_TOUCH : TARGET_SIZE_MIN;
		if (candidate.screen.w >= minimum && candidate.screen.h >= minimum) return;

		// "Spacing that compensates" is the margin box: R13.22's `bounds` is the
		// margin box and `screenBounds` the content box, so the pair already
		// expresses the reserved space around a small target. When `margin` is
		// emitted per side it is used directly; otherwise `bounds` carries the
		// same total. Both axes must reach the minimum, because horizontal
		// slack does not make a 20 px tall row easier to hit.
		const margin = candidate.node.margin;
		const outerW = margin ? candidate.screen.w + num(margin.left) + num(margin.right) : candidate.bounds.w;
		const outerH = margin ? candidate.screen.h + num(margin.top) + num(margin.bottom) : candidate.bounds.h;
		if (outerW >= minimum && outerH >= minimum) {
			rule.exempt++;
			return;
		}
		report('target-size', candidate);
	};

	// Walk-wide, not per-path: `addChild` never detaches from a previous
	// parent, so one instance can sit in two children arrays and a diamond
	// expands exponentially long before any depth cap catches it. The repeat is
	// still linted where it appears the second time; only its subtree is left
	// unexpanded, which is what treeSnapshot emits for the same shape.
	const expanded = new Set<LintNode>();

	const walk = (group: readonly Candidate[], parent: Candidate | null, depth: number): void => {
		siblingOverlap(group);
		for (const candidate of group) {
			if (parent) childOutsideParent(candidate, parent);
			outsideViewport(candidate);
			zeroOrNegativeSize(candidate);
			textOverflow(candidate);
			unreachableInteractive(candidate, group);
			targetSize(candidate);
			if (depth >= MAX_DEPTH || expanded.has(candidate.node)) continue;
			expanded.add(candidate.node);
			walk(toCandidates(candidate.node.children, candidate.path), candidate, depth + 1);
		}
	};

	walk(toCandidates(document?.roots, ''), null, 0);

	const rules: LintRuleReport[] = RULE_NAMES.map((name) => {
		const source = tally(name);
		const entry: LintRuleReport = {
			rule: name,
			violations: source.violations,
			evaluated: source.evaluated,
			exempt: source.exempt,
			skippedMissingInput: source.skippedMissingInput,
			dormant: source.evaluated === 0 && source.skippedMissingInput > 0,
		};
		if (source.missingInput.length > 0) entry.missingInput = source.missingInput.slice();
		if (source.buckets) entry.buckets = { ...source.buckets };
		return entry;
	});

	return { count: violations.length, violations, rules };
}
