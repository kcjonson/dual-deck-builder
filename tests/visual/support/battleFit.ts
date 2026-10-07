import { LANE_ORDER, ROW_ORDER, RoadLane, RoadRow, RoadSlot, isShoulder } from '../../../src/renderer/game/mechanics/Road';
import { DOCK_HAND_CAP, computeRoadLayout, roadSlotRect, tokenScaleFor } from '../../../src/renderer/game/screens/combat/CombatLayout';

/**
 * The battle screen's fit check (DDB-141), ported from the mock's `lint`
 * (docs/design/battle-screen/index.html) onto the tree snapshot. The engine's
 * layout lint runs beside it; this adds what only the battle screen knows:
 * which boxes are tokens, chips and cards, the road's slots, and its rules.
 *
 * - overflow: text past its box, either way. A wrapped text counts, which
 *   the engine lint lets off: taller than its box, or wider when a word
 *   longer than the wrap width gets a line to itself. An ellipsis is the
 *   design's own cut (the mock's `trunc`) and does not. A keyword text's
 *   words past its box count.
 * - offscreen: a token, card, driver tab, End Turn, or the detail view and its
 *   keyword boxes past the frame by more than one stage pixel.
 * - collision: tokens, intent pills, range chips, lane heads and row labels
 *   overlapping by more than two stage pixels each way, between owners; and
 *   a hand card under End Turn.
 * - token-scale: a slot too small for its token at x1, from the road's own
 *   uncapped scale for that token's height (`tokenScaleFor`), since the token
 *   itself never draws below x1 and so cannot show it.
 * - slot: two tokens in one slot, a token in a lane its team can't use (its
 *   own formation and the other team's shoulder only), a flanker in a row
 *   with nobody in the other team's formation, or a token not in the slot
 *   its id names.
 * - hand-cap: a driver holding more cards than the dock is designed for
 *   (seven, `DOCK_HAND_CAP`), whatever their own hand limit.
 *
 * Not ported: the mock's `.hitchip` and `.predict`. The incoming total is
 * drawn inside its token's box (`EndTurnPreview.drawTotal`), so the token
 * collisions cover it; the hit check is paint-only, placed at render time,
 * and has no box in the tree to measure.
 * - parked: a parked subtree, which the engine lint checks at rest; none of
 *   these states parks the dock, so a park here would hide what it covers.
 *
 * Pure over the document, so it runs in the test process.
 */

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface FitNode {
	id: string | null;
	type: string;
	bounds: Rect;
	screenBounds: Rect;
	margin?: { top: number; right: number; bottom: number; left: number };
	visible: boolean;
	opacity?: number;
	parked?: { x: number; y: number };
	text?: { content: string; measured?: { w: number; h: number }; overflow?: string; wrap: string };
	labels?: string[];
	state?: { hovered?: boolean };
	parts?: FitNode[];
	children: FitNode[];
}

export interface FitDocument {
	viewport: { width: number; height: number };
	roots: FitNode[];
}

export type FitCheck = 'overflow' | 'offscreen' | 'collision' | 'token-scale' | 'slot' | 'hand-cap' | 'parked';

export interface FitFinding {
	check: FitCheck;
	detail: string;
}

interface Visited {
	node: FitNode;
	path: string;
	/** The nearest token at or above it. */
	token: FitNode | null;
	parent: FitNode | null;
}

/** Every visible node, depth first, parts before children as the snapshot orders them. */
function visibleNodes(document: FitDocument): Visited[] {
	const out: Visited[] = [];
	const walk = (nodes: FitNode[], path: string, token: FitNode | null, parent: FitNode | null): void => {
		for (const node of nodes) {
			if (!node.visible || node.opacity === 0) continue;
			const here = `${path}/${node.id ?? node.type}`;
			const owner = node.type === 'Vehicle' ? node : token;
			out.push({ node, path: here, token: owner, parent });
			walk([...(node.parts ?? []), ...node.children], here, owner, node);
		}
	};
	walk(document.roots, '', null, null);
	return out;
}

function find(nodes: Visited[], id: string): FitNode | null {
	return nodes.find((entry) => entry.node.id === id)?.node ?? null;
}

const overlap = (a: Rect, b: Rect): { x: number; y: number } => ({
	x: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
	y: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
});

const round = (value: number): number => Math.round(value * 100) / 100;
const describe = (rect: Rect): string => `${round(rect.x)},${round(rect.y)} ${round(rect.w)}x${round(rect.h)}`;

const TOKEN_ID = /^(player|enemy)_vehicle_(.+)_(ahead|center|behind)$/;
/** Each team's own formation lanes and the other team's shoulder (Combat Rules, "The road"). */
const USABLE_LANES: Record<'player' | 'enemy', readonly RoadLane[]> = {
	player: [RoadLane.PLAYER_INSIDE, RoadLane.PLAYER_OUTSIDE, RoadLane.ENEMY_SHOULDER],
	enemy: [RoadLane.ENEMY_INSIDE, RoadLane.ENEMY_OUTSIDE, RoadLane.PLAYER_SHOULDER],
};

/** The side and slot a token's id names (`RoadView` ids tokens by them), or null when it names none. */
export function tokenSlot(node: FitNode): (RoadSlot & { side: 'player' | 'enemy' }) | null {
	const match = TOKEN_ID.exec(node.id ?? '');
	const lane = match?.[2] as RoadLane | undefined;
	const row = match?.[3] as RoadRow | undefined;
	if (!match || !lane || !row || !LANE_ORDER.includes(lane) || !ROW_ORDER.includes(row)) return null;
	return { side: match[1] as 'player' | 'enemy', lane, row };
}

function textOverflow({ node, path, parent }: Visited): string | null {
	const text = node.text;
	if (text?.measured && text.overflow !== 'ellipsis') {
		const margin = node.margin ?? { top: 0, right: 0, bottom: 0, left: 0 };
		const width = node.bounds.w - margin.left - margin.right;
		const height = node.bounds.h - margin.top - margin.bottom;
		// Wrapped or not: a word wider than the wrap width gets a line to itself and runs past the box
		if (text.measured.h > height + 1 || text.measured.w > width + 1) {
			return `${path} "${text.content.slice(0, 40)}" measures ${round(text.measured.w)}x${round(text.measured.h)} in ${round(width)}x${round(height)}`;
		}
	}
	// A keyword text lays its words out as parts in its own space
	if (parent?.type === 'KeywordText' && node.type === 'Text') {
		const { x, y, w, h } = node.bounds;
		if (x + w > parent.bounds.w + 1 || y + h > parent.bounds.h + 1) {
			return `${path} "${node.text?.content ?? ''}" ends at ${round(x + w)},${round(y + h)} past its block's ${round(parent.bounds.w)}x${round(parent.bounds.h)}`;
		}
	}
	return null;
}

export function battleFit(document: FitDocument): FitFinding[] {
	const findings: FitFinding[] = [];
	const nodes = visibleNodes(document);
	const road = find(nodes, 'combat_road_view');
	if (!road) return [{ check: 'slot', detail: 'no combat_road_view in the tree' }];
	// Stage pixels to viewport pixels: the stage scales its whole canvas
	const k = road.screenBounds.w / road.bounds.w;
	const viewport: Rect = { x: 0, y: 0, w: document.viewport.width, h: document.viewport.height };

	for (const entry of nodes) {
		const overflow = textOverflow(entry);
		if (overflow) findings.push({ check: 'overflow', detail: overflow });
		if (entry.node.parked) findings.push({ check: 'parked', detail: `${entry.path} is parked ${round(entry.node.parked.x)},${round(entry.node.parked.y)}` });
	}

	// Off the frame
	const framed = nodes.filter(({ node }) => node.type === 'Vehicle' || node.type === 'Card'
		|| ['driver1_tab', 'driver2_tab', 'end_turn_button', 'card_detail_inspect_view', 'card_detail_inspect_keywords'].includes(node.id ?? ''));
	for (const { node, path } of framed) {
		const box = node.screenBounds;
		if (box.x < viewport.x - k || box.y < viewport.y - k || box.x + box.w > viewport.w + k || box.y + box.h > viewport.h + k) {
			findings.push({ check: 'offscreen', detail: `${path} at ${describe(box)} in ${viewport.w}x${viewport.h}` });
		}
	}

	// Collisions between owners
	const headOrLabel = (entry: Visited, part: 'head' | 'row'): boolean => entry.parent === road && (entry.node.id ?? '').startsWith(`combat_road_view_${part}_`);
	const colliders = nodes.filter((entry) => entry.node.type === 'Vehicle' || entry.node.type === 'IntentPill'
		|| (entry.node.type === 'RangeChip' && entry.node.screenBounds.w > 0)
		|| headOrLabel(entry, 'head') || headOrLabel(entry, 'row'));
	for (let i = 0; i < colliders.length; i++) {
		for (let j = i + 1; j < colliders.length; j++) {
			const a = colliders[i];
			const b = colliders[j];
			if (a.token && a.token === b.token) continue;
			if (headOrLabel(a, 'head') && headOrLabel(b, 'head')) continue;
			const { x, y } = overlap(a.node.screenBounds, b.node.screenBounds);
			if (x > 2 * k && y > 2 * k) findings.push({ check: 'collision', detail: `${a.path} overlaps ${b.path} by ${round(x)}x${round(y)}` });
		}
	}
	const endTurn = find(nodes, 'end_turn_button');
	if (endTurn) {
		const button = endTurn.screenBounds;
		for (const { node, path } of nodes.filter((entry) => entry.node.type === 'Card')) {
			const card = node.screenBounds;
			if (card.x + card.w > button.x + 2 * k && card.y < button.y + button.h) {
				findings.push({ check: 'collision', detail: `${path} reaches under End Turn (${describe(card)} against ${describe(button)})` });
			}
		}
	}

	// Each driver's half of the dock holds 7 at most (Battle Screen Design, section 4)
	for (const hand of ['driver1_hand', 'driver2_hand']) {
		const cards = nodes.filter((entry) => entry.node.type === 'Card' && entry.path.includes(`/${hand}/`)).length;
		if (cards > DOCK_HAND_CAP) findings.push({ check: 'hand-cap', detail: `${hand} holds ${cards}, over the cap of ${DOCK_HAND_CAP}` });
	}

	// The road's slots: scale, occupancy, lanes
	const layout = computeRoadLayout({ width: road.bounds.w, height: road.bounds.h });
	const occupied = new Map<string, string>();
	const flankers: { path: string; side: 'player' | 'enemy'; row: RoadRow }[] = [];
	const formationRows = { player: new Set<RoadRow>(), enemy: new Set<RoadRow>() };
	for (const { node, path, parent } of nodes.filter((entry) => entry.node.type === 'Vehicle')) {
		const need = tokenScaleFor({ slotWidth: layout.slotWidth, slotHeight: layout.slotHeight, tokenHeight: node.bounds.h });
		if (need < 1) findings.push({ check: 'token-scale', detail: `${path} needs x${need.toFixed(3)} in a ${round(layout.slotWidth)}x${round(layout.slotHeight)} slot` });

		const named = tokenSlot(node);
		if (!named) {
			findings.push({ check: 'slot', detail: `${path} doesn't name a slot` });
			continue;
		}
		const { side, lane, row } = named;
		const key = `${lane} ${row}`;
		const other = occupied.get(key);
		if (other) findings.push({ check: 'slot', detail: `${path} shares ${key} with ${other}` });
		occupied.set(key, path);
		if (!USABLE_LANES[side].includes(lane)) findings.push({ check: 'slot', detail: `${path}: the ${side} team can't use ${lane}` });
		if (isShoulder(lane)) flankers.push({ path, side, row });
		else formationRows[side].add(row);
		if (parent === road) {
			const slot = roadSlotRect(layout, { lane, row });
			const centreX = node.bounds.x + node.screenBounds.w / k / 2;
			const centreY = node.bounds.y + node.screenBounds.h / k / 2;
			if (centreX < slot.x || centreX > slot.x + slot.width || centreY < slot.y || centreY > slot.y + slot.height) {
				findings.push({ check: 'slot', detail: `${path} is drawn at ${round(centreX)},${round(centreY)}, outside its slot ${key}` });
			}
		}
	}
	// A flanker sits in the row of a vehicle it outran, so the other team's
	// formation has someone in that row (the mock's "flanks an empty row")
	for (const { path, side, row } of flankers) {
		const other = side === 'player' ? 'enemy' : 'player';
		if (!formationRows[other].has(row)) findings.push({ check: 'slot', detail: `${path} flanks an empty row: no ${other} vehicle in formation ${row}` });
	}

	return findings;
}
