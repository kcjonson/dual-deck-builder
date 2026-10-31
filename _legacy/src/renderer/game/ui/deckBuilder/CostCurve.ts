import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import type { CardLookup } from '../DriverDetailView';

const { space, fontSize } = tokens;

/**
 * The curve in its own pixels: a column per cost, each a count over a bar
 * over the cost, the bars growing up from one baseline. An empty cost keeps
 * a dash of a bar so the baseline reads across it, as the Crew wireframe
 * draws it.
 */
export const COST_CURVE = {
	/** Costs 0 to 3, the last taking anything dearer ("3+"). */
	costs: 4,
	column: 24,
	gap: space.space_2,
	bar: { width: 16, max: 32, empty: 2 },
	label: { size: fontSize.fs_xs, line: 14 },
	rowGap: space.space_0_5,
} as const;

/** The curve's height: a count, the tallest bar, and a cost. */
export const COST_CURVE_HEIGHT = COST_CURVE.label.line * 2 + COST_CURVE.bar.max + COST_CURVE.rowGap * 2;

/** Copies at each cost, 0 to `COST_CURVE.costs - 1` and up, of the cards the lookup knows, from copies by card type. */
export function costCounts(deck: Readonly<Record<string, number>>, cards: CardLookup): number[] {
	const counts = new Array<number>(COST_CURVE.costs).fill(0);
	for (const [type, copies] of Object.entries(deck)) {
		const card = cards(type);
		if (!card) continue;
		counts[Math.min(Math.max(card.cost, 0), COST_CURVE.costs - 1)] += copies;
	}
	return counts;
}

/**
 * A deck's cost curve (Game Flow 3.2): how many of its cards cost 0, 1, 2,
 * and 3 or more, as bars scaled to the tallest. Built once; new counts
 * resize the bars and rewrite the figures in place.
 */
export class CostCurve extends Stack {
	private readonly columns: { count: Text; bar: Stack }[] = [];
	private shown: readonly number[] = [];

	constructor({ id }: { id: string }) {
		super({ id, direction: 'horizontal', gap: COST_CURVE.gap, crossAlign: 'end' });
		for (let cost = 0; cost < COST_CURVE.costs; cost += 1) {
			const column = new Stack({
				id: `${id}_cost_${cost}`,
				width: COST_CURVE.column,
				height: COST_CURVE_HEIGHT,
				distribution: 'end',
				crossAlign: 'center',
				gap: COST_CURVE.rowGap,
			});
			const count = figure({ id: `${id}_cost_${cost}_count`, text: '0', color: 'text' });
			const bar = new Stack({
				id: `${id}_cost_${cost}_bar`,
				width: COST_CURVE.bar.width,
				height: COST_CURVE.bar.empty,
				style: { backgroundColor: 'line_edge' },
			});
			column.addChild(count);
			column.addChild(bar);
			column.addChild(figure({ id: `${id}_cost_${cost}_label`, text: cost === COST_CURVE.costs - 1 ? `${cost}+` : String(cost), color: 'text_dim' }));
			this.addChild(column);
			this.columns.push({ count, bar });
		}
	}

	/** The copies at each cost, as last shown. */
	public get counts(): readonly number[] {
		return this.shown;
	}

	public set counts(counts: readonly number[]) {
		if (counts.length === this.shown.length && counts.every((count, index) => count === this.shown[index])) return;
		this.shown = [...counts];
		const tallest = Math.max(1, ...counts);
		this.columns.forEach(({ count, bar }, index) => {
			const copies = counts[index] ?? 0;
			count.text = String(copies);
			bar.height = copies > 0 ? Math.max(COST_CURVE.bar.empty, Math.round((COST_CURVE.bar.max * copies) / tallest)) : COST_CURVE.bar.empty;
			bar.style = { backgroundColor: copies > 0 ? 'text' : 'line_edge' };
		});
	}
}

function figure({ id, text, color }: { id: string; text: string; color: 'text' | 'text_dim' }): Text {
	return new Text({
		id,
		text,
		height: COST_CURVE.label.line,
		style: { fontRole: 'mono', fontSize: COST_CURVE.label.size, color },
		lineHeight: COST_CURVE.label.line / COST_CURVE.label.size,
		verticalAlign: 'middle',
		wrap: 'none',
	});
}
