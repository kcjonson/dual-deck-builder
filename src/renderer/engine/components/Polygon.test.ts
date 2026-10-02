/**
 * @jest-environment jsdom
 */
import { DrawApi, RecordingBackend } from '../draw';
import type { DrawCommand } from '../draw';
import { Polygon } from './Polygon';

describe('Polygon', () => {
	let backend: RecordingBackend;
	let api: DrawApi;

	beforeEach(() => {
		backend = new RecordingBackend({ maxFrames: 1 });
		api = new DrawApi({ backend });
	});

	function drawn(polygon: Polygon): DrawCommand[] {
		api.beginFrame({ viewport: { width: 200, height: 200 } });
		polygon.render(api);
		api.endFrame();
		return [...backend.commands];
	}

	function fillIndices(polygon: Polygon): readonly number[] | null {
		const fills = drawn(polygon).filter((command) => command.kind === 'polygon');
		expect(fills).toHaveLength(1);
		const fill = fills[0];
		return fill.kind === 'polygon' ? fill.indices : null;
	}

	it('refreshes its cached triangles when the outline changes', () => {
		const polygon = new Polygon({ id: 'shape', width: 100, height: 100 });

		polygon.makeRegular(4);
		expect(fillIndices(polygon)).toHaveLength(2 * 3);

		polygon.makeStar(5);
		expect(fillIndices(polygon)).toHaveLength(8 * 3);

		polygon.points = [
			[-1, -1],
			[1, -1],
			[0, 1],
		];
		expect(fillIndices(polygon)).toEqual([0, 1, 2]);
	});

	it('skips the fill for an outline with no area but still strokes it', () => {
		const polygon = new Polygon({ id: 'flat', width: 100, height: 100, style: { borderWidth: 2 } });
		polygon.points = [
			[-1, 0],
			[0, 0],
			[1, 0],
		];

		const kinds = drawn(polygon).map((command) => command.kind);
		expect(kinds).not.toContain('polygon');
		expect(kinds.length).toBeGreaterThan(0);
	});
});
