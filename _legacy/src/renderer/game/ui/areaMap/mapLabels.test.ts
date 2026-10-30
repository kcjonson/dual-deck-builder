import { LABEL_LAYOUT } from './areaMapStyle';
import { LabelLayout } from './mapLabels';

describe('LabelLayout', () => {
	const label = { width: 40, height: 10 };

	it('places a label on the first clear side of its symbol, the gap from its edge, right, left, above, then below', () => {
		const layout = new LabelLayout();
		layout.reset(400, 400);
		const away = 5 + LABEL_LAYOUT.gap;
		expect({ ...layout.placeBeside({ x: 200, y: 200, radius: 5, ...label }) }).toEqual({ x: 200 + away, y: 195, ...label });
		// The right is taken now: the next goes left, then above, then below, then nowhere.
		expect(layout.placeBeside({ x: 200, y: 200, radius: 5, ...label })?.x).toBe(200 - away - 40);
		expect(layout.placeBeside({ x: 200, y: 200, radius: 5, ...label })?.y).toBe(200 - away - 10);
		expect(layout.placeBeside({ x: 200, y: 200, radius: 5, ...label })?.y).toBe(200 + away);
		expect(layout.placeBeside({ x: 200, y: 200, radius: 5, ...label })).toBeNull();
	});

	it('keeps labels inside the view, off blocked symbols, and a pad apart', () => {
		const layout = new LabelLayout();
		layout.reset(100, 100);
		// Past the right edge, so on the left.
		expect(layout.placeBeside({ x: 80, y: 50, radius: 2, ...label })?.x).toBeLessThan(80);
		expect(layout.isClear(0, 0, 10, 10)).toBe(true);
		layout.block(20, 20, 10, 10);
		expect(layout.isClear(31, 20, 10, 10)).toBe(false);
		expect(layout.isClear(30 + LABEL_LAYOUT.pad, 20, 10, 10)).toBe(true);
		expect(layout.isClear(95, 0, 10, 10)).toBe(false);
	});

	it('places one with no clear side anyway on its first, when asked, and then keeps others off it', () => {
		const layout = new LabelLayout();
		layout.reset(400, 400);
		// A small block where the label's only side, below, would go.
		const below = 200 + 5 + LABEL_LAYOUT.gap;
		layout.block(190, below + 2, 5, 5);
		expect(layout.placeBeside({ x: 200, y: 200, radius: 5, ...label, sides: ['below'] })).toBeNull();
		const anyway = layout.placeBeside({ x: 200, y: 200, radius: 5, ...label, sides: ['below'], anyway: true });
		expect({ ...anyway }).toEqual({ x: 180, y: below, ...label });
		// Taken: a label overlapping it, clear of the small block, isn't clear; one beside it is.
		expect(layout.isClear(150, below, 35, 10)).toBe(false);
		expect(layout.isClear(100, below, 40, 10)).toBe(true);
	});

	it('places on the first side without checking where text can\'t be measured, and starts each frame empty', () => {
		const layout = new LabelLayout();
		layout.reset(400, 400, false);
		layout.block(0, 0, 400, 400);
		expect(layout.placeBeside({ x: 200, y: 200, radius: 5, ...label })?.x).toBe(200 + 5 + LABEL_LAYOUT.gap);
		layout.reset(400, 400);
		expect(layout.isClear(0, 0, 400, 400)).toBe(true);
	});
});
