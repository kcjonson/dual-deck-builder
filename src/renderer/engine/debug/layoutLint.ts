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
 * declared, and every one is optional, so `SnapshotDocument` is assignable to
 * `LintDocument` without a cast and a hand-built document can leave out
 * whatever it does not test.
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
 * absent `zIndex` read as 0 on one node and declared on the other would invent
 * a difference nobody declared. The serializer emits `zIndex` and the
 * effective `layer` on every node since DDB-80, so R13.25.1's exemption now
 * applies as written wherever a component sets either.
 *
 * R13.29 makes `count: 0` the merge gate. Per the implementation spec's ground
 * rules that gate applies to the gallery first and to each screen as it
 * migrates; `tests/visual/web/lint.spec.ts` holds the gallery to it.
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
	/**
	 * R8.30: how far a declared park moves this node off its rest place, in
	 * viewport space. The lint checks the subtree where it rests (`atRest`).
	 */
	parked?: LintPoint;
	/**
	 * Present only on a scroll container: the offset and the furthest it goes
	 * per axis. The lint's one scroll signal; `contentOffset` is not, since a
	 * padded panel that never scrolls reports its padding there.
	 */
	scroll?: { x: number; y: number; maxX: number; maxY: number };
	zIndex?: number;
	layer?: string;
	/** Effective opacity; a node at 0 draws nothing and takes no hits (R3.27). */
	opacity?: number;
	margin?: LintEdges;
	focusable?: boolean;
	pointerEvents?: string;
	/** The component answers the pointer itself (treeSnapshot); see `isInteractive`. */
	handlesPointer?: boolean;
	text?: LintText;
	/** A stack container's direction and gap; see rule 1's negative-gap allowance. */
	stack?: { direction?: string; gap?: number };
	/**
	 * The node's own drawings, which are not siblings of its children. See the
	 * note on rule 1 in `walk` for what the distinction changes.
	 */
	parts?: readonly LintNode[];
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
 * Run against the live game in phase 0 the rule was, in practice, a Text
 * detector: every zero-size node in every capture was a Text, because nothing
 * sized one unless a screen ran `layout()` (counts in
 * `.claude/notes/ddb55-phase0-recon.md`). Since DDB-71 a Text sizes itself
 * from the metrics service, so that flood is gone; a zero-size Text now is
 * one built where nothing could measure it (a unit test on the null backend).
 *
 * Every violation is still reported with the bucket it belongs to, so a
 * consumer filters on `bucket !== 'unmeasured-text'` to get the signal and
 * reads `rules[].buckets` for the split. The discriminator is the type *and*
 * the absence of `text.measured`, which the snapshot emits whenever the text
 * has been measured (DDB-80), so a Text whose box genuinely collapsed (an
 * empty string, an assigned zero) lands in `zero-box` and the prescribed
 * filter does not hide it.
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

/**
 * Rule 6's non-occluders. R8.29 gives `none` and `passthrough` different
 * subtree semantics, but both make the node's *own* box transparent to hits,
 * and rule 6 compares a target against a sibling's own box and never descends
 * into that sibling's children. So neither can make a target unreachable here.
 *
 * R3.27 gives `opacity: 0` the same property: the walk skips the subtree, so
 * nothing in it paints or takes a hit. Read from the effective `opacity`, and
 * only when the document carries it.
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

const MISSING_INTERACTIVITY = ['focusable', 'handlesPointer'];
const MISSING_TEXT = ['text'];
const MISSING_TEXT_MEASURE = ['text.measured'];

/**
 * Rule 5's candidates. `text` is the field that makes a node a text node; the
 * type name is the fallback signal that a candidate was there and went
 * untested when a document carries no `text` object. R12.4 names the
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

/** The overlap of two rects, or null when they share no area. A null `b` is no constraint. */
function intersect(a: LintRect | null, b: LintRect | null): LintRect | null {
	if (!a) return null;
	if (!b) return a;
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const w = Math.min(a.x + a.w, b.x + b.w) - x;
	const h = Math.min(a.y + a.h, b.y + b.h) - y;
	return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Overlapping or abutting within epsilon on both axes. */
function touches(a: LintRect, b: LintRect): boolean {
	return overlapOnAxis(a.x, a.w, b.x, b.w) >= -EPSILON && overlapOnAxis(a.y, a.h, b.y, b.h) >= -EPSILON;
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

/**
 * R13.25.6 and .7's "interactive": focusable, or a component that answers the
 * pointer and whose own box takes hits (`auto` or `unit`, or undeclared).
 *
 * R13.25.6 reads literally as focusable or `pointerEvents: auto | unit`, and
 * R8.29 makes `auto` the default for every leaf, so the literal reading counts
 * every label, icon and swatch as a control: measured with the snapshot
 * emitting `pointerEvents`, the gallery went from 0 to 146 findings and the
 * screens gained 1,229, and not one was a control (DDB-208). `pointerEvents`
 * says whether a box takes hits, not whether anything listens, so the rule
 * takes the handler from `handlesPointer` and keeps `pointerEvents` as the
 * veto it is: a `passthrough` container with an onClick hears its children's
 * bubbled clicks but its own box is never a target.
 */
function isInteractive(node: LintNode): boolean {
	if (node.focusable === true) return true;
	if (node.handlesPointer !== true) return false;
	return typeof node.pointerEvents !== 'string' || TRANSPARENT_TO_HITS.indexOf(node.pointerEvents) < 0;
}

/**
 * True only when the document says something about interactivity. A document
 * carrying `pointerEvents` alone says whether boxes take hits, which is not
 * the question, so it leaves the rules skipped rather than guessing.
 */
function declaresInteractivity(node: LintNode): boolean {
	return typeof node.focusable === 'boolean' || typeof node.handlesPointer === 'boolean';
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
	/** The nearest scroll container this node scrolls with, if any (rules 3 and 6). */
	scroller?: Candidate;
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

/**
 * The content box's size in the node's own space: `bounds` is the margin box
 * there (R13.22), so the margin comes off when the document carries it.
 * Without `margin` the two boxes are the same.
 */
function contentSize(candidate: Candidate): { w: number; h: number } {
	const margin = candidate.node.margin;
	if (!margin) return { w: candidate.bounds.w, h: candidate.bounds.h };
	return {
		w: candidate.bounds.w - num(margin.left) - num(margin.right),
		h: candidate.bounds.h - num(margin.top) - num(margin.bottom),
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
 * R13.25.2 and R13.25.3 as amended for R8.30: a parked subtree is checked
 * where it rests. A park is a declared, transient move off the component's
 * place (the battle screen's dock dropping off the bottom of the screen while
 * the raiders act, which the battle screen mock's own fit check exempts as
 * `.card.dropped`), so its offset, and only its offset, is forgiven: every
 * `screenBounds` and `inkBounds` in the subtree, and every clip the subtree
 * itself introduced, moves back by the parks above it, and the rules then
 * run as usual. A child that would escape its parent, or the viewport, at
 * rest is still reported. The document is copied only along parked
 * subtrees; one with no park is returned as it is.
 */
function atRest(document: LintDocument): LintDocument {
	if (!document || !Array.isArray(document.roots) || !document.roots.some(hasPark)) return document;
	return { ...document, roots: document.roots.map((root) => restNode(root, ZERO_SHIFT, undefined, ZERO_SHIFT)) };
}

const ZERO_SHIFT: LintPoint = { x: 0, y: 0 };

function hasPark(node: LintNode | null | undefined, depth = 0): boolean {
	if (!node || depth > MAX_DEPTH) return false;
	if (node.parked) return true;
	return (node.parts ?? []).some((part) => hasPark(part, depth + 1)) || (node.children ?? []).some((child) => hasPark(child, depth + 1));
}

function shifted(value: LintRect | undefined, by: LintPoint): LintRect | undefined {
	if (!value || (by.x === 0 && by.y === 0)) return value;
	return { x: num(value.x) - by.x, y: num(value.y) - by.y, w: num(value.w), h: num(value.h) };
}

function sameRect(a: LintRect | undefined, b: LintRect | undefined): boolean {
	if (!a || !b) return a === b;
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * One node at rest. `shift` is the parks above it; `parentClip` is the clip
 * its parent drew under and `parentClipShift` how far that clip moved, so a
 * clip handed down unchanged moves with whoever introduced it, and a new one
 * (introduced by the parent) moves by the parent's shift.
 */
function restNode(node: LintNode, shift: LintPoint, parentClip: LintRect | undefined, parentClipShift: LintPoint, depth = 0): LintNode {
	if (!node || depth > MAX_DEPTH) return node;
	const park = node.parked;
	const own: LintPoint = park ? { x: shift.x + num(park.x), y: shift.y + num(park.y) } : shift;
	if (own.x === 0 && own.y === 0 && !hasPark(node)) return node;
	const clipShift = depth === 0 || sameRect(node.clip, parentClip) ? parentClipShift : shift;
	const rested: LintNode & { inkBounds?: LintRect } = {
		...node,
		screenBounds: shifted(node.screenBounds, own) as LintRect,
		clip: shifted(node.clip, clipShift),
	};
	const ink = (node as { inkBounds?: LintRect }).inkBounds;
	if (ink) rested.inkBounds = shifted(ink, own);
	if (node.parts) rested.parts = node.parts.map((part) => restNode(part, own, node.clip, clipShift, depth + 1));
	if (node.children) rested.children = node.children.map((child) => restNode(child, own, node.clip, clipShift, depth + 1));
	return rested;
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
export function layoutLint(source: LintDocument, options: LintOptions | null = {}): LintResult {
	const document = atRest(source);
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

	/**
	 * A node's two groups, numbered as one.
	 *
	 * `pathSegment` disambiguates by position within the array it was given, so
	 * numbering `parts` and `children` separately would let a part and a child
	 * of the same type under one owner both print `Type[0]`. The path is the
	 * only identity R13.28 gives a violation and the only key a baseline diff
	 * can use, so the two are numbered across the concatenation and split
	 * afterwards on the boundary. Parts come first because that is submission
	 * order (R3.18), and a node with no parts numbers exactly as it did before
	 * the group existed.
	 */
	const toGroups = (node: LintNode, parentPath: string): [Candidate[], Candidate[]] => {
		const parts = Array.isArray(node.parts) ? node.parts : [];
		if (parts.length === 0) return [[], toCandidates(node.children, parentPath)];
		const children = Array.isArray(node.children) ? node.children : [];
		const all = toCandidates([...parts, ...children], parentPath);
		// Invisible nodes are dropped but keep their original index (R13.27),
		// so the boundary still splits the survivors correctly.
		return [
			all.filter((candidate) => candidate.index < parts.length),
			all.filter((candidate) => candidate.index >= parts.length),
		];
	};

	/**
	 * Rule 1's allowance: children of a stack with a negative gap may overlap
	 * along its main axis by up to that gap (R10.2, R13.25.1).
	 */
	const negativeGapAllowance = (parent: Candidate | null): { axis: 'x' | 'y'; allowance: number } | null => {
		const stack = parent?.node.stack;
		if (!stack) return null;
		const gap = num(stack.gap);
		if (gap >= 0) return null;
		return { axis: stack.direction === 'horizontal' ? 'x' : 'y', allowance: -gap };
	};

	/** Rule 1. Roots are a sibling group like any other (R13.27). */
	const siblingOverlap = (group: readonly Candidate[], parent: Candidate | null): void => {
		const rule = tally('sibling-overlap');
		const negativeGap = negativeGapAllowance(parent);
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
				const x = overlapOnAxis(a.screen.x, a.screen.w, b.screen.x, b.screen.w);
				if (x <= EPSILON) continue;
				const y = overlapOnAxis(a.screen.y, a.screen.h, b.screen.y, b.screen.h);
				if (y <= EPSILON) continue;
				// R13.25.1's "beyond what a negative stack gap allows": the
				// snapshot carries a stack's gap, so an overlap along its main
				// axis no deeper than the gap is the overlap the author asked for.
				if (negativeGap && (negativeGap.axis === 'x' ? x : y) <= negativeGap.allowance + EPSILON) {
					rule.exempt++;
					continue;
				}
				report('sibling-overlap', a, b);
			}
		}
	};

	/**
	 * Rule 2. Ink overflow is excluded by construction: `inkBounds` is never
	 * read. R13.25.2 names the child's *bounds*, which R13.22 defines as the
	 * margin box, so the child is compared as its margin box against the
	 * parent's content box. Without a `margin` on the document the two boxes
	 * coincide.
	 *
	 * Two exemptions. A raised child that touches its parent; see the comment
	 * inside. And one R13.25.2 does not state: a caller's child of a scroll
	 * container (the node that carries `scroll`) past it on an axis the
	 * container scrolls. A ScrollContainer's content is taller than it by
	 * definition (R12.20) and clipped to it; an escape across, on an axis it
	 * cannot scroll, is still reported, as is any part of the container's own
	 * (its scrollbar), and what overflows inside the content is compared
	 * against the content, one level down. Recorded as a departure in
	 * panel-and-scroll-container.md.
	 * @param isChild False for one of the parent's parts.
	 */
	const childOutsideParent = (child: Candidate, parent: Candidate, isChild: boolean): void => {
		const rule = tally('child-outside-parent');
		// A child in a different effective layer from its parent was raised
		// out of it, and a raise resets the inherited clip (R3.8, R4.8): an
		// open menu declared at its select hangs past the select, its row and
		// the scroller around them on purpose. R13.31 asks for exactly that
		// popup in the z-order fixture while R13.29 asks the fixture to lint
		// clean, and R13.25.1 already reads a differing layer as declared
		// intent, so it is read the same way here. Only while the child still
		// touches its parent, as an anchored menu always does: a raised child
		// nowhere near its parent is the popup built in the wrong coordinate
		// space, and nothing else in the lint would see it.
		const box = marginBox(child);
		if (declaresDifferentLayer(child.node, parent.node) && touches(box, parent.screen)) {
			rule.exempt++;
			return;
		}
		rule.evaluated++;
		if (escape(box, parent.screen) <= EPSILON) return;
		const scroll = parent.node.scroll;
		if (isChild && scroll !== undefined) {
			const outer = parent.screen;
			const acrossX = Math.max(outer.x - box.x, box.x + box.w - (outer.x + outer.w));
			const acrossY = Math.max(outer.y - box.y, box.y + box.h - (outer.y + outer.h));
			const unscrolledEscape = Math.max(num(scroll.maxX) > 0 ? -Infinity : acrossX, num(scroll.maxY) > 0 ? -Infinity : acrossY);
			if (unscrolledEscape <= EPSILON) {
				rule.exempt++;
				return;
			}
		}
		report('child-outside-parent', child, parent);
	};

	/**
	 * Where a scroller's content can be seen, or null when it cannot be: its
	 * box inside the viewport and its own effective clip. A scroller that is
	 * itself scrolled out of view counts as its whole box, once its own
	 * scroller can bring it in; one an outer, non-scrolling clip hides has
	 * nowhere to show anything.
	 */
	const scrollWindow = (scroller: Candidate, depth = 0): LintRect | null => {
		if (depth > MAX_DEPTH) return null;
		const shown = intersect(intersect(scroller.screen, viewport), scroller.node.clip ? rect(scroller.node.clip) : null);
		if (shown) return shown;
		return canScrollInto(scroller, 'meets', depth + 1) ? scroller.screen : null;
	};

	/**
	 * Whether some scroll position of the candidate's nearest scroller shows
	 * it in the scroller's window. `meets` asks for any overlap. `fits` asks
	 * for all of it on each axis, or, on a scrolling axis it is longer than
	 * the window on, for a position where it spans the window, as a tall
	 * section in a scrolled page does; an axis that does not scroll gets no
	 * such allowance. The content moves by the difference between the current
	 * offset and the new one, anywhere from 0 to the scroller's range.
	 *
	 * A candidate raised out of its scroller's layer is not clipped by it or
	 * by anything outside it (R3.8), but still moves with every scroller
	 * around it, so its window is the viewport and any of those scrollers
	 * may be the one that brings it there.
	 */
	const canScrollInto = (candidate: Candidate, mode: 'fits' | 'meets', depth = 0): boolean => {
		const nearest = candidate.scroller;
		if (!nearest) return false;
		if (declaresDifferentLayer(candidate.node, nearest.node)) {
			for (let scroller: Candidate | undefined = nearest; scroller; scroller = scroller.scroller) {
				if (scrollsInto(candidate, scroller, viewport, mode)) return true;
			}
			return false;
		}
		const window = scrollWindow(nearest, depth);
		return window !== null && scrollsInto(candidate, nearest, window, mode);
	};

	const scrollsInto = (candidate: Candidate, scroller: Candidate, window: LintRect, mode: 'fits' | 'meets'): boolean => {
		const range = scroller.node.scroll;
		if (!range) return false;
		const axis = (start: number, size: number, offset: number, max: number, windowStart: number, windowSize: number): boolean => {
			const reach = Math.max(num(max), 0);
			const lowest = num(offset) - reach;
			const highest = num(offset);
			const windowEnd = windowStart + windowSize;
			if (mode === 'meets') {
				// Some shift in [lowest, highest] with a positive overlap: the
				// open interval of shifts that overlap, against the closed range.
				return lowest < windowEnd - start && highest > windowStart - start - size;
			}
			if (reach > 0 && size > windowSize) {
				return Math.max(lowest, windowEnd - start - size - EPSILON) <= Math.min(highest, windowStart - start + EPSILON);
			}
			return Math.max(lowest, windowStart - start - EPSILON) <= Math.min(highest, windowEnd - start - size + EPSILON);
		};
		const box = candidate.screen;
		return axis(box.x, box.w, range.x, range.maxX, window.x, window.w)
			&& axis(box.y, box.h, range.y, range.maxY, window.y, window.h);
	};

	/**
	 * Rule 3. A node inside a scroll container that some scroll position
	 * brings wholly into the scroller's window is scrolled away, not outside
	 * the viewport, and is exempt (R13.25.3 as amended by DDB-208). The
	 * scroller itself is still checked, and so is anything wider than the
	 * window on an axis it does not scroll.
	 */
	const outsideViewport = (candidate: Candidate): void => {
		const rule = tally('outside-viewport');
		// Every candidate counts as evaluated, exempt or not: lint.spec.ts reads
		// this rule's `evaluated` as the scene's node count.
		rule.evaluated++;
		if (escape(candidate.screen, viewport) <= EPSILON) return;
		if (canScrollInto(candidate, 'fits')) {
			rule.exempt++;
			return;
		}
		report('outside-viewport', candidate);
	};

	/** Rule 4. `w <= 0` OR `h <= 0`; see ZERO_SIZE_BUCKETS for why the split exists. */
	const zeroOrNegativeSize = (candidate: Candidate): void => {
		const rule = tally('zero-or-negative-size');
		rule.evaluated++;
		// The content box is what draws, so the test is on screenBounds. An AND
		// here would miss the Text nodes that have a real width and a zero
		// height, which are close to a third of the live findings.
		if (candidate.screen.w > 0 && candidate.screen.h > 0) return;
		// Type alone would keep bucketing a measured Text that really did
		// collapse as `unmeasured-text`, and the filter this module prescribes
		// would then drop a real defect. A measurement present says the
		// unmeasured cause has been ruled out.
		const unmeasuredText = candidate.node.type === TEXT_TYPE && !candidate.node.text?.measured;
		const bucket = unmeasuredText ? ZERO_SIZE_BUCKETS.unmeasuredText : ZERO_SIZE_BUCKETS.zeroBox;
		rule.bucket(bucket);
		report('zero-or-negative-size', candidate, undefined, bucket);
	};

	/**
	 * Rule 5. Tests a text whose `text.measured` is present, which the
	 * snapshot emits once the metrics service has measured it (R6.11).
	 */
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
		// The document's own verdict wins when it carries one: the Text
		// compared its measure with its exact own size, and rebuilding that
		// size here from `bounds` less `margin` drifts in the last bit, which
		// under no epsilon would report a text that fits exactly.
		if (typeof text.overflow === 'string') {
			if (text.overflow === 'visible') report('text-overflow', candidate);
			return;
		}
		// Otherwise no epsilon: R13.27 scopes it to the geometry rules, and
		// measurement is exact by R6.11, so a sub-pixel excess is a real
		// excess. The box it is compared with is the local content box, the
		// space the measurement is in: `screenBounds` is scaled and rotated
		// with the node, and a quarter-turned label would otherwise swap its
		// axes.
		const box = contentSize(candidate);
		if (num(measured.w) > box.w || num(measured.h) > box.h) {
			report('text-overflow', candidate);
		}
	};

	/**
	 * Rule 6. `cover` is everything painted under the same owner: its parts
	 * and its children together, in submission order. Rule 1 keeps the two
	 * apart because R3.18 prescribes how a composite's parts overlap one
	 * another, but being covered is a question about paint and hits, and a
	 * part that paints over a caller's button takes its clicks as surely as a
	 * sibling would.
	 */
	const unreachableInteractive = (candidate: Candidate, cover: readonly Candidate[]): void => {
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
			// Scrolled out of a scroll container is not unreachable: the
			// wheel brings it back, and focus scrolls it in (R12.20). So a
			// control that some scroll position of its nearest scroller puts
			// across the scroller's window is let off, provided that window
			// can be seen at all. The document says only that some ancestor
			// clipped the control, so one that an inner, non-scrolling clip
			// inside the scroller hides is let off too; that is the price of
			// not guessing which ancestor it was.
			if (x <= 0 || y <= 0) {
				if (canScrollInto(candidate, 'meets')) {
					rule.exempt++;
				} else {
					report('unreachable-interactive', candidate);
					return;
				}
			}
		}

		for (const other of cover) {
			if (other === candidate) continue;
			if (typeof other.node.pointerEvents === 'string' && TRANSPARENT_TO_HITS.indexOf(other.node.pointerEvents) >= 0) {
				continue;
			}
			if (other.node.opacity === 0) continue;
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

	/** Rule 7, over the same candidates as rule 6. */
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

	/**
	 * @param siblings False for a group of one node's `parts`. Rule 1 asks
	 *   whether two *siblings* overlap, and R8.5's sibling relation holds
	 *   between the children a caller added. A composite's parts are not that:
	 *   R3.18 fixes their order as shadow, background, decorations, content,
	 *   chrome, so one part covering another is the construction the spec
	 *   prescribes rather than a finding. Every other rule still runs over
	 *   them: a part that escapes its component, collapses or leaves the
	 *   viewport is reported, and recursion into a part is not cut, so a
	 *   container part still lints its own contents.
	 *
	 *   Rule 1 is the only rule narrowed by this. Rule 6 is handed `cover`,
	 *   the owner's parts and children together, because a part painted over
	 *   an interactive child takes its hits (DDB-208). The gap that remains
	 *   in rule 1 is the named blind spot in the decision doc: a caller-added
	 *   child painted over a composite's own label is invisible to the lint,
	 *   and the scene's screenshot golden is what covers it today.
	 * @param cover The owner's parts and children in submission order, for
	 *   rule 6; the group itself at the roots.
	 */
	const walk = (
		group: readonly Candidate[],
		parent: Candidate | null,
		depth: number,
		siblings: boolean,
		cover: readonly Candidate[],
	): void => {
		if (siblings) siblingOverlap(group, parent);
		for (const candidate of group) {
			if (parent) childOutsideParent(candidate, parent, siblings);
			outsideViewport(candidate);
			zeroOrNegativeSize(candidate);
			textOverflow(candidate);
			unreachableInteractive(candidate, cover);
			targetSize(candidate);
			if (depth >= MAX_DEPTH || expanded.has(candidate.node)) continue;
			expanded.add(candidate.node);
			const [parts, children] = toGroups(candidate.node, candidate.path);
			// A scroller scrolls its children, not its own drawings.
			const scrolls = candidate.node.scroll !== undefined && candidate.node.scroll !== null;
			for (const part of parts) part.scroller = candidate.scroller;
			for (const child of children) child.scroller = scrolls ? candidate : candidate.scroller;
			const owned = parts.length === 0 ? children : [...parts, ...children];
			walk(parts, candidate, depth + 1, false, owned);
			walk(children, candidate, depth + 1, true, owned);
		}
	};

	const roots = toCandidates(document?.roots, '');
	walk(roots, null, 0, true, roots);

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
