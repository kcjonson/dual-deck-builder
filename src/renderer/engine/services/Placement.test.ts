import { PlacementService, place, pointAnchor } from './Placement';

const VIEWPORT = { x: 0, y: 0, width: 400, height: 300 };
const SIZE = { width: 100, height: 60 };

describe('place (R12.30)', () => {
	it('puts the box on the preferred side, offset from the anchor and aligned to its start', () => {
		const placed = place({ anchor: { x: 50, y: 40, width: 80, height: 20 }, size: SIZE, side: 'bottom', offset: 4, gap: 8, viewport: VIEWPORT });
		expect(placed).toEqual({ x: 50, y: 64, width: 100, height: 60, side: 'bottom', flipped: false, constrained: false });
	});

	it('places on each of the four sides', () => {
		const anchor = { x: 150, y: 120, width: 40, height: 20 };
		const options = { anchor, size: { width: 50, height: 30 }, offset: 4, gap: 8, viewport: VIEWPORT };
		expect(place({ ...options, side: 'top' })).toMatchObject({ x: 150, y: 86, side: 'top' });
		expect(place({ ...options, side: 'bottom' })).toMatchObject({ x: 150, y: 144, side: 'bottom' });
		expect(place({ ...options, side: 'left' })).toMatchObject({ x: 96, y: 120, side: 'left' });
		expect(place({ ...options, side: 'right' })).toMatchObject({ x: 194, y: 120, side: 'right' });
	});

	it('aligns centre and end along the anchor edge', () => {
		const anchor = { x: 150, y: 40, width: 40, height: 20 };
		expect(place({ anchor, size: SIZE, align: 'center', offset: 0, gap: 0, viewport: VIEWPORT }).x).toBe(120);
		expect(place({ anchor, size: SIZE, align: 'end', offset: 0, gap: 0, viewport: VIEWPORT }).x).toBe(90);
	});

	it('flips to the opposite side when the preferred one overflows and the other has more room', () => {
		const placed = place({ anchor: { x: 50, y: 260, width: 40, height: 20 }, size: SIZE, side: 'bottom', offset: 4, gap: 8, viewport: VIEWPORT });
		expect(placed).toMatchObject({ y: 196, side: 'top', flipped: true, constrained: false });
	});

	it('flips horizontally too', () => {
		const placed = place({ anchor: { x: 360, y: 100, width: 20, height: 20 }, size: SIZE, side: 'right', offset: 4, gap: 8, viewport: VIEWPORT });
		expect(placed).toMatchObject({ x: 256, side: 'left', flipped: true });
	});

	it('stays on the preferred side when neither side fits but it has more room, and constrains to that room', () => {
		const placed = place({ anchor: { x: 50, y: 100, width: 40, height: 20 }, size: { width: 100, height: 250 }, side: 'bottom', offset: 4, gap: 8, viewport: VIEWPORT });
		// Below: 300 - 8 - 124 = 168; above: 100 - 4 - 8 = 88.
		expect(placed).toMatchObject({ y: 124, height: 168, side: 'bottom', flipped: false, constrained: true });
	});

	it('shifts along the edge to stay inside the viewport less the gap', () => {
		const right = place({ anchor: { x: 360, y: 40, width: 30, height: 20 }, size: SIZE, offset: 4, gap: 8, viewport: VIEWPORT });
		expect(right.x).toBe(292);
		const left = place({ anchor: { x: 2, y: 40, width: 30, height: 20 }, size: SIZE, align: 'end', offset: 4, gap: 8, viewport: VIEWPORT });
		expect(left.x).toBe(8);
	});

	it('shrinks a box wider than the viewport to it on the cross axis', () => {
		const placed = place({ anchor: { x: 10, y: 10, width: 10, height: 10 }, size: { width: 600, height: 20 }, offset: 4, gap: 8, viewport: VIEWPORT });
		expect(placed).toMatchObject({ x: 8, width: 384, constrained: true });
	});

	it('places against a point anchor', () => {
		const placed = place({ anchor: pointAnchor({ x: 200, y: 150 }), size: SIZE, offset: 16, gap: 8, viewport: VIEWPORT });
		expect(placed).toMatchObject({ x: 200, y: 166 });
	});

	it('respects a viewport that does not start at the origin', () => {
		const bounds = { x: 100, y: 100, width: 200, height: 100 };
		const placed = place({ anchor: { x: 120, y: 170, width: 20, height: 20 }, size: { width: 60, height: 40 }, offset: 4, gap: 4, viewport: bounds });
		expect(placed).toMatchObject({ y: 126, side: 'top', flipped: true });
	});
});

describe('PlacementService', () => {
	it('clamps against the mount context viewport, read at each call', () => {
		const logical = { width: 400, height: 300 };
		const service = new PlacementService({ viewport: { logical } });
		expect(service.place({ anchor: { x: 380, y: 10, width: 10, height: 10 }, size: SIZE }).x).toBe(292);
		logical.width = 800;
		expect(service.place({ anchor: { x: 380, y: 10, width: 10, height: 10 }, size: SIZE }).x).toBe(380);
	});
});
