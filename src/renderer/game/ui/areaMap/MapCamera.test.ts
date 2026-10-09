import { FIT_MARGIN, MAX_ZOOM, MIN_ZOOM_SHARE, MapCamera } from './MapCamera';

/** A point through `matrix`, as the draw API transforms map space. */
function throughMatrix(camera: MapCamera, mapX: number, mapY: number): { x: number; y: number } {
	const [a, b, c, d, tx, ty] = camera.matrix;
	return { x: a * mapX + c * mapY + tx, y: b * mapX + d * mapY + ty };
}

describe('MapCamera', () => {
	it('fits the whole disc at first, centred, with the margin round it', () => {
		const camera = new MapCamera({ radius: 1000, width: 1200, height: 700 });
		const margin = 700 * FIT_MARGIN;
		expect(camera.zoom).toBeCloseTo((700 - margin * 2) / 2000, 12);
		expect(camera.center).toEqual({ x: 0, y: 0 });
		expect(camera.worldToScreen(0, 0)).toEqual({ x: 600, y: 350 });
		// North is up: the disc's top touches the margin
		expect(camera.worldToScreen(0, 1000).y).toBeCloseTo(margin, 9);
		expect(camera.worldToScreen(0, -1000).y).toBeCloseTo(700 - margin, 9);
		expect(camera.isFitted).toBe(true);
	});

	it('maps world to screen and back, and its matrix takes map space (y flipped) to the same place', () => {
		const camera = new MapCamera({ radius: 800, width: 900, height: 600 });
		camera.zoomAt(2.5, 200, 150);
		camera.panBy(-37, 12);
		for (const [x, y] of [[0, 0], [123.5, -456], [-800, 800], [10, 20]]) {
			const screen = camera.worldToScreen(x, y);
			const back = camera.screenToWorld(screen.x, screen.y);
			expect(back.x).toBeCloseTo(x, 9);
			expect(back.y).toBeCloseTo(y, 9);
			const matrix = throughMatrix(camera, x, -y);
			expect(matrix.x).toBeCloseTo(screen.x, 9);
			expect(matrix.y).toBeCloseTo(screen.y, 9);
		}
	});

	it('pans with the pointer: the world point under a drag stays under it', () => {
		const camera = new MapCamera({ radius: 1000, width: 800, height: 800 });
		camera.zoom = 1;
		const before = camera.screenToWorld(300, 420);
		camera.panBy(25, -40);
		const after = camera.screenToWorld(325, 380);
		expect(after.x).toBeCloseTo(before.x, 9);
		expect(after.y).toBeCloseTo(before.y, 9);
		expect(camera.isFitted).toBe(false);
	});

	it('zooms about a screen point, keeping the world point under it', () => {
		const camera = new MapCamera({ radius: 1000, width: 800, height: 600 });
		const anchor = camera.screenToWorld(620, 140);
		expect(camera.zoomAt(1.8, 620, 140)).toBe(true);
		const after = camera.worldToScreen(anchor.x, anchor.y);
		expect(after.x).toBeCloseTo(620, 9);
		expect(after.y).toBeCloseTo(140, 9);
	});

	it('holds the zoom between a little short of the whole disc and the closest', () => {
		const camera = new MapCamera({ radius: 1000, width: 1000, height: 1000 });
		const fitted = camera.zoom;
		expect(camera.minZoom).toBeCloseTo(fitted * MIN_ZOOM_SHARE, 12);
		camera.zoomAt(0.01, 500, 500);
		expect(camera.zoom).toBeCloseTo(camera.minZoom, 12);
		expect(camera.canZoom(0.9)).toBe(false);
		expect(camera.zoomAt(0.9, 500, 500)).toBe(false);
		expect(camera.canZoom(1.1)).toBe(true);
		camera.zoomAt(1e6, 500, 500);
		expect(camera.zoom).toBe(MAX_ZOOM);
		expect(camera.canZoom(1.1)).toBe(false);
		camera.zoom = Number.NaN;
		expect(camera.zoom).toBe(MAX_ZOOM);
	});

	it('keeps the centre on the disc, so the map never leaves the view', () => {
		const camera = new MapCamera({ radius: 600, width: 800, height: 600 });
		camera.zoom = 2;
		// Dragged far left and down: the camera heads east and north, to the rim
		camera.panBy(-1e6, 1e6);
		expect(Math.hypot(camera.center.x, camera.center.y)).toBeCloseTo(600, 9);
		expect(camera.center.x).toBeCloseTo(camera.center.y, 9);
		camera.center = { x: -5000, y: 0 };
		expect(camera.center).toEqual({ x: -600, y: 0 });
		camera.center = { x: 300, y: -400 };
		expect(camera.center).toEqual({ x: 300, y: -400 });
	});

	it('refits a fitted rect on every resize, and keeps a moved camera where it was', () => {
		const camera = new MapCamera({ radius: 1000, width: 400, height: 400 });
		camera.fit({ x: 100, y: -50, width: 200, height: 100 });
		expect(camera.center).toEqual({ x: 200, y: 0 });
		const small = camera.zoom;
		camera.resize(800, 800);
		expect(camera.zoom).toBeCloseTo(small * 2, 12);
		expect(camera.center).toEqual({ x: 200, y: 0 });

		camera.panBy(10, 0);
		const moved = camera.center;
		const zoom = camera.zoom;
		camera.resize(600, 900);
		expect(camera.isFitted).toBe(false);
		expect(camera.center).toEqual(moved);
		expect(camera.zoom).toBe(zoom);
	});

	it('fits a new map whole when the radius changes, and keeps its view of one the same size', () => {
		const camera = new MapCamera({ radius: 600, width: 800, height: 800 });
		camera.zoomAt(3, 100, 100);
		const view = { center: camera.center, zoom: camera.zoom };
		camera.radius = 600;
		expect({ center: camera.center, zoom: camera.zoom }).toEqual(view);
		expect(camera.isFitted).toBe(false);

		camera.radius = 1600;
		expect(camera.isFitted).toBe(true);
		expect(camera.center).toEqual({ x: 0, y: 0 });
		expect(camera.worldToScreen(1600, 0).x).toBeCloseTo(800 - 800 * FIT_MARGIN, 9);
	});

	it('goes back to the last rect fitted, not the whole disc', () => {
		const camera = new MapCamera({ radius: 1000, width: 800, height: 800 });
		camera.fit({ x: -200, y: -100, width: 400, height: 200 });
		const framed = { center: camera.center, zoom: camera.zoom };
		camera.panBy(120, -80);
		camera.zoomAt(0.5, 10, 10);
		camera.restoreFit();
		expect({ center: camera.center, zoom: camera.zoom }).toEqual(framed);
		expect(camera.isFitted).toBe(true);
	});

	it('leaves the zoom alone while the view has no area, so a hidden view comes back as it was', () => {
		const camera = new MapCamera({ radius: 600, width: 800, height: 800 });
		camera.zoom = 1.5;
		camera.center = { x: 100, y: 50 };
		camera.resize(0, 0);
		expect(camera.zoom).toBe(1.5);
		camera.resize(800, 800);
		expect(camera.zoom).toBe(1.5);
		expect(camera.center).toEqual({ x: 100, y: 50 });
	});

	it('reports the world rect it shows', () => {
		const camera = new MapCamera({ radius: 1000, width: 400, height: 200 });
		camera.zoom = 2;
		camera.center = { x: 50, y: -20 };
		expect(camera.visibleWorld).toEqual({ x: -50, y: -70, width: 200, height: 100 });
	});

	it('rejects a map with no radius', () => {
		expect(() => new MapCamera({ radius: 0 })).toThrow(/radius/);
	});
});
