import { DrawApi, RecordingBackend } from '../draw';
import type { DrawCommand, RectCommand } from '../draw';
import type { DrawApi as DrawApiType } from '../draw/DrawApi';
import { Component } from './Component';
import { Container } from './Container';
import { Rectangle } from './Rectangle';
import { Stack } from './Stack';
import { renderTree } from './renderTree';

let backend: RecordingBackend;
let api: DrawApi;

beforeEach(() => {
	backend = new RecordingBackend({ maxFrames: 1 });
	api = new DrawApi({ backend, strict: true });
});

function frame(root: Component): DrawCommand[] {
	api.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
	renderTree(root, api);
	api.endFrame();
	return [...backend.commands].sort((a, b) => a.sequence - b.sequence);
}

function rect(commands: DrawCommand[], id: string): RectCommand {
	const found = commands.find((command) => command.id === id);
	if (!found || found.kind !== 'rect') throw new Error(`no rect '${id}'`);
	return found;
}

/** A leaf with a child, to prove the walk, not the leaf, draws the child (R8.1). */
class Badge extends Rectangle {
	public renders = 0;

	public render(draw: DrawApiType): void {
		this.renders += 1;
		super.render(draw);
	}
}

describe('renderTree (R3.11, R8.1)', () => {
	it('draws each component in its local space under its origin', () => {
		const root = new Container({ id: 'root', x: 10, y: 20, width: 300, height: 300 });
		const box = new Rectangle({ id: 'box', x: 5, y: 7, width: 30, height: 40 });
		root.addChild(box);

		const drawn = rect(frame(root), 'box');

		expect(drawn.rect).toEqual({ x: 0, y: 0, width: 30, height: 40 });
		expect(drawn.transform).toEqual([1, 0, 0, 1, 15, 27]);
		expect(drawn.transform).toEqual(box.screenMatrix);
	});

	it('visits a leaf\'s children itself: a leaf draws only its own shape', () => {
		const badge = new Badge({ id: 'badge', width: 20, height: 20 });
		badge.addChild(new Rectangle({ id: 'dot', x: 4, y: 4, width: 4, height: 4 }));

		const ids = frame(badge).map((command) => command.id);

		expect(ids).toEqual(['badge', 'dot']);
		expect(badge.renders).toBe(1);
	});

	it('skips invisible and fully transparent subtrees entirely (R3.27)', () => {
		const root = new Container({ width: 100, height: 100 });
		const hidden = new Rectangle({ id: 'hidden', width: 10, height: 10, visible: false });
		hidden.addChild(new Rectangle({ id: 'hidden_child', width: 5, height: 5 }));
		const faded = new Rectangle({ id: 'faded', width: 10, height: 10, opacity: 0 });
		const shown = new Rectangle({ id: 'shown', width: 10, height: 10 });
		root.addChild(hidden).addChild(faded).addChild(shown);

		expect(frame(root).map((command) => command.id)).toEqual(['shown']);
	});

	it('paints siblings in zIndex order after the parent\'s own draws (R3.12)', () => {
		const root = new Stack({ width: 100, height: 100, style: { backgroundColor: [0, 0, 0, 1] } });
		root.addChild(new Rectangle({ id: 'top', width: 10, height: 10, zIndex: 2 }));
		root.addChild(new Rectangle({ id: 'first', width: 10, height: 10 }));
		root.addChild(new Rectangle({ id: 'under', width: 10, height: 10, zIndex: -1 }));
		root.addChild(new Rectangle({ id: 'second', width: 10, height: 10 }));

		const ids = frame(root).map((command) => command.id);

		expect(ids).toEqual([null, 'under', 'first', 'second', 'top']);
	});

	it('multiplies opacity down the tree onto every draw (R3.25)', () => {
		const root = new Container({ width: 100, height: 100, opacity: 0.5 });
		const child = new Rectangle({ id: 'child', width: 10, height: 10, opacity: 0.5 });
		root.addChild(child);

		expect(rect(frame(root), 'child').opacity).toBe(0.25);
	});

	it('clips children, not the clipper\'s own draw, and offsets content inside the clip (R4.9, R4.10)', () => {
		const root = new Stack({ id: 'root', x: 10, y: 10, width: 100, height: 100, overflow: 'hidden', style: { backgroundColor: [0, 0, 0, 1] } });
		const child = new Rectangle({ id: 'child', x: 0, y: 20, width: 10, height: 10 });
		root.addChild(child);

		const commands = frame(root);

		expect(rect(commands, 'root').clip).toEqual({ kind: 'none' });
		expect(rect(commands, 'child').clip).toEqual({
			kind: 'rect',
			rect: { minX: 10, minY: 10, maxX: 110, maxY: 110 },
			rounded: null,
		});
	});

	it('raises a promoted subtree to its layer and resets the inherited clip (R3.8, R4.8)', () => {
		const root = new Container({ width: 50, height: 50, overflow: 'hidden' });
		const popup = new Rectangle({ id: 'popup', x: 60, y: 0, width: 20, height: 20, layer: 'popup' });
		const inside = new Rectangle({ id: 'inside', width: 10, height: 10 });
		root.addChild(popup).addChild(inside);

		const commands = frame(root);

		expect(rect(commands, 'popup').layer).toBe('popup');
		expect(rect(commands, 'popup').clip).toEqual({ kind: 'none' });
		expect(rect(commands, 'inside').layer).toBe('base');
		expect(rect(commands, 'inside').clip.kind).toBe('rect');
	});

	// R3.6: the tree half of the draw API's clamp. A child asking for a layer
	// below its ancestor's paints in the ancestor's, and a development build
	// reports it, which is why no gallery scene can show it.
	it('keeps a child that asks for a lower layer in its ancestor\'s, and reports it (R3.6)', () => {
		const lenient = new DrawApi({ backend });
		const modal = new Container({ width: 100, height: 100, layer: 'modal' });
		modal.addChild(new Rectangle({ id: 'lowered', width: 10, height: 10, layer: 'base' }));

		lenient.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
		renderTree(modal, lenient);
		lenient.endFrame();

		expect(backend.commands.find((command) => command.id === 'lowered')?.layer).toBe('modal');
		expect(lenient.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['layer-lowered']);
	});

	it('pushes a rotated transform about the content box centre, matching screenMatrix (R8.26)', () => {
		const root = new Container({ width: 400, height: 400 });
		const card = new Rectangle({ id: 'card', x: 100, y: 100, width: 100, height: 20, transform: { rotate: Math.PI / 2 } });
		root.addChild(card);

		const drawn = rect(frame(root), 'card');

		expect(drawn.translateOnly).toBe(false);
		const expected = card.screenMatrix;
		drawn.transform.forEach((value, index) => expect(value).toBeCloseTo(expected[index]));
	});

	it('draws the focus ring after the children, only while focus is visible and enabled (R11.12, R9.23)', () => {
		const button = new Rectangle({ id: 'button', x: 10, y: 10, width: 100, height: 40 });
		button.addChild(new Rectangle({ id: 'label', width: 20, height: 10 }));
		const ring = (): DrawCommand | undefined => frame(button).find((command) => command.id === 'button.focus_ring');

		expect(ring()).toBeUndefined();
		button.setFocusState(true, false);
		expect(ring()).toBeUndefined();

		button.setFocusState(true, true);
		const ids = frame(button).map((command) => command.id);
		expect(ids).toEqual(['button', 'label', 'button.focus_ring']);
		const drawn = rect(frame(button), 'button.focus_ring');
		expect(drawn.rect).toEqual({ x: -2, y: -2, width: 104, height: 44 });
		expect(drawn.border).toMatchObject({ width: 1, position: 'outside' });

		button.enabled = false;
		expect(ring()).toBeUndefined();
	});

	it('leaves the ring to a component that draws its own', () => {
		class Styled extends Rectangle {
			public get drawsOwnFocusRing(): boolean {
				return true;
			}
		}
		const styled = new Styled({ id: 'styled', width: 100, height: 40 });
		styled.setFocusState(true, true);
		expect(frame(styled).map((command) => command.id)).toEqual(['styled']);
	});

	it('leaves every stack balanced', () => {
		const root = new Container({ width: 100, height: 100, overflow: 'hidden', opacity: 0.5, transform: { translate: [3, 4] } });
		const raised = new Container({ width: 50, height: 50, layer: 'raised', overflow: 'hidden' });
		raised.addChild(new Rectangle({ width: 10, height: 10 }));
		root.addChild(raised);

		frame(root);

		expect(api.diagnostics.filter((diagnostic) => diagnostic.code === 'unbalanced-stack')).toEqual([]);
		expect(api.transform).toEqual([1, 0, 0, 1, 0, 0]);
	});
});
