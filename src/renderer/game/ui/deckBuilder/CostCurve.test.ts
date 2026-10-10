import type { Text } from '../../../engine/components/Text';
import { lookup } from '../testing';
import { COST_CURVE, CostCurve, costCounts } from './CostCurve';

describe('CostCurve', () => {
	it('counts copies by cost, the dearest bucket taking anything above it, and skips cards it can\'t look up', () => {
		// Armor Plating and Repair Kit cost 1, Ram 2, EMP Blast 3, Top Off 0.
		expect(costCounts({ armor_plating: 3, repair_kit: 2, ram: 2, emp_blast: 1, top_off: 1, no_such_card: 4 }, lookup)).toEqual([1, 5, 2, 1]);
		expect(costCounts({ emp_blast: 1 }, (type) => {
			const card = lookup(type);
			if (card) card.set({ cost: 7 });
			return card;
		})).toEqual([0, 0, 0, 1]);
	});

	it('scales the bars to the tallest, keeps a dash for an empty cost, and labels the last bucket "3+"', () => {
		const curve = new CostCurve({ id: 'curve' });
		curve.counts = [0, 8, 4, 1];
		const bars = [0, 1, 2, 3].map((cost) => curve.findById(`curve_cost_${cost}_bar`) as unknown as { height: number });
		expect(bars.map((bar) => bar.height)).toEqual([COST_CURVE.bar.empty, COST_CURVE.bar.max, COST_CURVE.bar.max / 2, COST_CURVE.bar.max / 8]);
		const counts = [0, 1, 2, 3].map((cost) => (curve.findById(`curve_cost_${cost}_count`) as unknown as Text).text);
		expect(counts).toEqual(['0', '8', '4', '1']);
		expect((curve.findById('curve_cost_3_label') as unknown as Text).text).toBe('3+');
	});
});
