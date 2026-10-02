import { DrawApi, RecordingBackend } from '../draw';
import type { DrawCommand, ImageCommand, LineCommand, RectCommand, TextCommand } from '../draw';
import { tokens } from '../theme/tokens';
import { INVALID_COLOR, resolveColor } from '../style/styleObject';
import { Circle } from './Circle';
import { Container } from './Container';
import { Image, fitRects } from './Image';
import { Line } from './Line';
import { createMountContext, MountContext } from './MountContext';
import { Polygon } from './Polygon';
import { Rectangle } from './Rectangle';
import { renderTree } from './renderTree';
import { Stack } from './Stack';
import { Text } from './Text';
import { Triangle } from './Triangle';

/**
 * R12.1 to R12.5 on R11.14's closed set (DDB-209): each leaf renders every
 * property it accepts and rejects the rest at construction; R12.18's
 * container has no visuals; Line and Image are the catalog's two new leaves.
 */

let backend: RecordingBackend;
let api: DrawApi;

beforeEach(() => {
	backend = new RecordingBackend({ maxFrames: 1 });
	api = new DrawApi({ backend, development: false });
});

function draw(component: Container | Rectangle | Line | Image | Stack | Text): readonly DrawCommand[] {
	api.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
	renderTree(component, api);
	api.endFrame();
	return backend.commands;
}

describe('the closed style set on the leaves (R11.14)', () => {
	it('rejects legacy keys and properties a leaf does not render, in every leaf', () => {
		const legacy = { border: '1px solid red' } as never;
		expect(() => new Rectangle({ style: legacy })).toThrow(/not a style property/);
		expect(() => new Rectangle({ style: { color: 'text' } as never })).toThrow(/does not render/);
		expect(() => new Circle({ style: { borderRadius: 4 } as never })).toThrow(/does not render/);
		expect(() => new Triangle({ style: { shadow: 'shadow_raised' } as never })).toThrow(/does not render/);
		expect(() => new Polygon({ style: { fontSize: 12 } as never })).toThrow(/does not render/);
		expect(() => new Text('x', { style: { backgroundColor: 'accent' } as never })).toThrow(/does not render/);
		expect(() => new Text('x', { style: { verticalAlign: 'middle' } as never })).toThrow(/not a style property/);
		expect(() => new Stack({ style: { color: 'text' } as never })).toThrow(/does not render/);
		expect(() => new Line({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, style: { borderWidth: 1 } as never })).toThrow(/does not render/);
		expect(() => new Image({ style: { borderColor: 'accent' } as never })).toThrow(/does not render/);
	});

	it('reads colour tokens and throws on a colour string it cannot parse, where the old parser drew white', () => {
		expect(resolveColor('accent')).toEqual(tokens.color.accent);
		expect(resolveColor('#80ff0040')).toEqual([128 / 255, 1, 0, 64 / 255]);
		expect(resolveColor('#fff')).toEqual([1, 1, 1, 1]);
		expect(resolveColor('rgba(255, 0, 0, 0.5)')).toEqual([1, 0, 0, 0.5]);
		expect(resolveColor('transparent')).toEqual([0, 0, 0, 0]);
		expect(() => resolveColor('blue')).toThrow(/not a colour token or a CSS colour/);
		expect(() => resolveColor('rgb(1, 2)')).toThrow(/not a colour/);
	});

	it('draws a rectangle from tokens with its border, radius, opacity, and shadow, and reports the shadow as ink', () => {
		const rect = new Rectangle({
			id: 'box',
			width: 40,
			height: 20,
			style: { backgroundColor: 'bg_panel', borderColor: 'line_edge', borderWidth: 'bw_thick', borderRadius: 'r_md', opacity: 0.5, shadow: 'shadow_raised' },
		});
		const drawn = draw(rect).find((command): command is RectCommand => command.kind === 'rect' && command.id === 'box');
		expect(drawn).toMatchObject({ fill: tokens.color.bg_panel, border: { color: tokens.color.line_edge, width: 2 }, opacity: 0.5 });
		expect(draw(rect).some((command) => command.kind === 'shadow')).toBe(true);
		expect(rect.inkExtent).toBeGreaterThan(0);
		rect.style = { backgroundColor: 'accent' };
		expect((draw(rect).find((command) => command.id === 'box') as RectCommand).fill).toEqual(tokens.color.accent);
	});

	it('replaces the whole style from every leaf\'s style setter, as construction does (R11.16)', () => {
		const text = new Text('x', { style: { color: 'accent', fontSize: 20 } });
		text.style = { fontSize: 12 };
		expect(text.style).toEqual({ fontSize: 12 });
		expect(text.resolvedColors.text).toEqual([1, 1, 1, 1]);
		const rect = new Rectangle({ style: { backgroundColor: 'accent', borderWidth: 2 } });
		rect.style = { backgroundColor: 'data' };
		expect(rect.resolvedColors).toEqual({ fill: tokens.color.data });
		const circle = new Circle({ style: { backgroundColor: 'accent', borderWidth: 2 } });
		circle.style = { backgroundColor: 'data' };
		expect(circle.resolvedColors).toEqual({ fill: tokens.color.data });
		const line = new Line({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, style: { color: 'accent' } });
		line.style = {};
		expect(line.color).toEqual([1, 1, 1, 1]);
		const image = new Image({ style: { backgroundColor: 'accent' } });
		image.style = {};
		expect(image.resolvedColors).toBeNull();
		const stack = new Stack({ width: 10, height: 10, style: { backgroundColor: 'accent' } });
		stack.style = {};
		expect(stack.resolvedColors).toBeNull();
		expect(() => {
			stack.style = { color: 'text' } as never;
		}).toThrow(/does not render/);
	});

	it('warns and draws magenta for a colour it cannot parse in a production build, rather than throw', () => {
		const previous = process.env.NODE_ENV;
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		process.env.NODE_ENV = 'production';
		try {
			expect(resolveColor('accnet')).toEqual(INVALID_COLOR);
			expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not a colour/));
		} finally {
			process.env.NODE_ENV = previous;
			warn.mockRestore();
		}
	});

	it('takes text layout as options, not style: vertical alignment, wrap, overflow, line height', () => {
		const text = new Text('Hello', { width: 100, height: 40, style: { fontRole: 'mono', fontSize: 'fs_lg', color: 'accent' }, verticalAlign: 'middle', wrap: 'none', textOverflow: 'ellipsis', lineHeight: 1.2 });
		const drawn = draw(text).find((command): command is TextCommand => command.kind === 'text') as TextCommand;
		expect(drawn).toMatchObject({ font: 'mono', size: tokens.fontSize.fs_lg, color: tokens.color.accent, verticalAlign: 'middle', wrap: 'none', overflow: 'ellipsis', lineHeight: 1.2 });
	});
});

describe('Container (R12.18)', () => {
	it('draws nothing of its own, passes hits through, and keeps exactly the children added', () => {
		const container = new Container({ id: 'c', width: 100, height: 100 });
		const child = new Rectangle({ width: 10, height: 10 });
		container.addChild(child);
		expect(draw(container).filter((command) => command.id === 'c')).toEqual([]);
		expect(container.pointerEvents).toBe('passthrough');
		expect(container.children).toEqual([child]);
		expect(container.resolvedColors).toBeNull();
	});

	it('leaves a box behind children to a stack\'s style', () => {
		const stack = new Stack({ id: 's', width: 50, height: 50, style: { backgroundColor: 'bg_inset', borderRadius: 4 } });
		expect(draw(stack).find((command) => command.id === 's')).toMatchObject({ kind: 'rect', fill: tokens.color.bg_inset });
		expect(draw(new Stack({ id: 'bare', width: 50, height: 50 })).filter((command) => command.id === 'bare')).toEqual([]);
	});
});

describe('Line (R12.3)', () => {
	it('draws one capsule between its endpoints, moves both with its position, and inks half its thickness past its box', () => {
		const line = new Line({ id: 'l', x: 10, y: 20, start: { x: 0, y: 0 }, end: { x: 100, y: 40 }, thickness: 4, cap: 'round', style: { color: 'data' } });
		const drawn = draw(line).find((command): command is LineCommand => command.kind === 'line') as LineCommand;
		expect(drawn).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 100, y: 40 }, width: 4, cap: 'round', color: tokens.color.data });
		expect([drawn.transform[4], drawn.transform[5]]).toEqual([10, 20]);
		expect(line.bounds).toMatchObject({ width: 100, height: 40 });
		expect(line.inkExtent).toBe(2);
		line.assignSize(5, 5);
		expect(line.width).toBe(100);
	});
});

describe('Image (R12.5)', () => {
	function texture(width: number, height: number) {
		return api.createTexture({ width, height, label: 'art' });
	}

	it('fits the texture: fill stretches, contain letterboxes, cover crops the source, none centres at texture size', () => {
		const source = { x: 0, y: 0, width: 200, height: 100 };
		expect(fitRects('fill', source, 100, 100)).toEqual({ rect: { x: 0, y: 0, width: 100, height: 100 }, source });
		expect(fitRects('contain', source, 100, 100)?.rect).toEqual({ x: 0, y: 25, width: 100, height: 50 });
		expect(fitRects('cover', source, 100, 100)?.source).toEqual({ x: 50, y: 0, width: 100, height: 100 });
		expect(fitRects('none', source, 100, 100)).toEqual({ rect: { x: 0, y: 0, width: 100, height: 100 }, source: { x: 50, y: 0, width: 100, height: 100 } });
	});

	it('draws a sprite frame with its tint, in pixels', () => {
		const art = texture(64, 32);
		const image = new Image({ id: 'img', width: 32, height: 32, texture: art, sourceRect: { x: 32, y: 0, width: 32, height: 32 }, tint: 'accent' });
		const drawn = draw(image).find((command): command is ImageCommand => command.kind === 'image') as ImageCommand;
		expect(drawn).toMatchObject({ texture: art, sourceRect: { x: 32, y: 0, width: 32, height: 32 }, sourceSpace: 'pixels', tint: tokens.color.accent });
	});

	describe('from the asset cache', () => {
		let context: MountContext;
		let resolveLoad: (() => void) | null;

		beforeEach(() => {
			resolveLoad = null;
			context = createMountContext({
				draw: api,
				viewport: { logical: { width: 800, height: 600 } },
				assetLoader: (key) => (key === 'missing'
					? Promise.reject(new Error('404'))
					: new Promise((resolve) => {
						resolveLoad = () => resolve({ source: new Uint8Array(4 * 16), width: 4, height: 4 });
					})),
			});
		});

		it('draws the placeholder until the texture is resident, then the texture, and releases it on unmount', async () => {
			const image = new Image({ id: 'img', width: 32, height: 32, src: 'cards/raider.png', style: { backgroundColor: 'bg_inset' } });
			const root = new Container({ width: 100, height: 100 });
			root.addChild(image);
			root.mount(context);
			expect(draw(image).find((command) => command.id === 'img')).toMatchObject({ kind: 'rect', fill: tokens.color.bg_inset });
			resolveLoad?.();
			await Promise.resolve();
			await Promise.resolve();
			expect(image.texture).not.toBeNull();
			expect(draw(image).find((command) => command.id === 'img')?.kind).toBe('image');
			expect(context.assets.stats.entries).toBe(1);
			root.unmount();
			expect(context.assets.stats.entries).toBe(0);
		});

		it('keeps the placeholder for a key that fails to load, without an unhandled rejection', async () => {
			const image = new Image({ width: 32, height: 32, src: 'missing' });
			image.mount(context);
			await Promise.resolve();
			await Promise.resolve();
			expect(image.texture).toBeNull();
			expect(draw(image)).toEqual([]);
			image.unmount();
		});

		it('releases the old key and acquires the new one when src changes while mounted', async () => {
			const image = new Image({ width: 32, height: 32, src: 'cards/raider.png' });
			image.mount(context);
			expect(context.assets.stats.entries).toBe(1);
			image.src = 'cards/buggy.png';
			expect(context.assets.stats.entries).toBe(1);
			expect(context.assets.peek('cards/raider.png')).toBeNull();
			resolveLoad?.();
			await Promise.resolve();
			await Promise.resolve();
			expect(image.texture).toBe(context.assets.peek('cards/buggy.png'));
			image.src = null;
			expect(context.assets.stats.entries).toBe(0);
			image.unmount();
		});

		it('acquires again on a remount, after releasing on unmount', () => {
			const image = new Image({ width: 32, height: 32, src: 'cards/raider.png' });
			image.mount(context);
			image.unmount();
			expect(context.assets.stats.entries).toBe(0);
			image.mount(context);
			expect(context.assets.stats.entries).toBe(1);
			image.unmount();
			expect(context.assets.stats.entries).toBe(0);
		});

		it('refuses both a key and a texture', () => {
			expect(() => new Image({ src: 'a', texture: texture(1, 1) })).toThrow(/not both/);
		});
	});
});
