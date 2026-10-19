/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { createTestContext } from '../../../engine/components/testing';
import type { DrawCommand, PolygonCommand } from '../../../engine/draw';
import { isSingleOutline } from '../../../engine/draw/triangulate';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../../engine/text/testing';
import { themes } from '../../../engine/theme/tokens';
import { MenuCover } from './MenuCover';

describe('MenuCover', () => {
	let context: MountContext;
	let backend: MeasuringRecordingBackend;
	let root: Container;
	let cover: MenuCover;

	beforeEach(() => {
		const measuring = createMeasuringDrawApi();
		backend = measuring.backend;
		context = createTestContext({ draw: measuring.api, clock: new Clock() });
		root = new Container({ id: 'root', width: 1024, height: 600, theme: 'atlas' });
		root.mount(context);
		cover = new MenuCover({ id: 'cover', width: 432, height: 480 });
		root.addChild(cover);
		context.frame.layout();
	});

	afterEach(() => {
		root.unmount();
	});

	function draws(): readonly DrawCommand[] {
		context.draw.beginFrame({ viewport: { width: 1024, height: 600 } });
		renderTree(cover, context.draw);
		context.draw.endFrame();
		return backend.commands;
	}

	it('draws every polygon as one outline, so each keeps its anti-aliased edge (R5.17)', () => {
		const polygons = draws().filter((command): command is PolygonCommand => command.kind === 'polygon');
		expect(polygons.length).toBeGreaterThan(8);
		expect(polygons.filter((polygon) => !isSingleOutline(polygon.points, polygon.indices ?? [])).map((polygon) => polygon.points.length)).toEqual([]);
	});

	it('runs the torn sheet past its box toward the sheet edges, and declares the bleed as ink', () => {
		const sheet = cover.sheetRect;
		expect(sheet.y).toBeLessThan(0);
		expect(sheet.y + sheet.height).toBeGreaterThan(cover.height);
		expect(cover.inkExtent).toBeGreaterThanOrEqual(-sheet.y);
	});

	it('prints the cartouche caption and its map in the atlas palette', () => {
		const drawn = draws();
		expect(drawn.some((command) => command.kind === 'text' && command.text.toUpperCase() === 'A ROAD ATLAS OF THE HALCYON REGION')).toBe(true);
		const highway = themes.atlas.color.accent;
		expect(drawn.some((command) => command.kind === 'polyline' && command.color.every((channel, index) => channel === highway[index]))).toBe(true);
	});
});
