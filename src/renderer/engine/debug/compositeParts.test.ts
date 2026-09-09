/**
 * @jest-environment jsdom
 *
 * DeveloperOverlay positions itself against `window.innerWidth` from its
 * constructor, so it cannot be built under the default node environment. The
 * other three composites do not care which environment they get.
 */
import { Layer } from '../components/Layer';
import { FrameTimer } from '../rendering/FrameTimer';
import { Button } from '../ui/Button';
import { DeveloperOverlay } from '../ui/DeveloperOverlay';
import { Input } from '../ui/Input';
import { Panel } from '../ui/Panel';
import { SnapshotNode, treeSnapshot } from './treeSnapshot';

const VIEWPORT = { width: 1440, height: 882 };

function snapshotOf(layer: Layer): SnapshotNode {
	return treeSnapshot([layer], VIEWPORT).roots[0];
}

function partTypes(node: SnapshotNode): string[] {
	return (node.parts ?? []).map((part) => part.type);
}

function childIds(node: SnapshotNode): (string | null)[] {
	return node.children.map((child) => child.id);
}

/**
 * The exact split every composite reports, pinned deliberately.
 *
 * `addPart` is what tells the lint that a node is the owner's own drawing, and
 * rule 1 skips it: a part is never paired with another part or with a child for
 * sibling overlap. That makes `addPart` the cheap way to turn a red gate green
 * without moving anything, so the set of layers marked as parts has to be a
 * decision someone made rather than a number a failing run nudged.
 *
 * The call sites are a greppable list (`grep -rn addPart src/`), and it is the
 * same list phase 3 has to convert when composites stop expressing their own
 * visuals as child layers. A new entry here is a review question, not a count
 * to bump: it says a component started claiming one more of its layers as its
 * own rendering, and the reviewer has to agree that the layer really is the
 * component's drawing and not something a caller handed it.
 *
 * Types are asserted alongside the counts because the count alone would let a
 * caller-added child swap places with a background and still read as 2.
 */
describe('the parts a composite owns', () => {
	it('gives a Panel a background rectangle and a content layer, and no children of its own', () => {
		const node = snapshotOf(new Panel({ id: 'inventory_panel', width: 300, height: 200 }));

		expect(partTypes(node)).toEqual(['Rectangle', 'Layer']);
		expect(node.children).toEqual([]);
	});

	it('gives a Button a background rectangle and a label, and no children of its own', () => {
		const node = snapshotOf(new Button('End turn', { id: 'end_turn_button', width: 120, height: 40 }));

		expect(partTypes(node)).toEqual(['Rectangle', 'Text']);
		expect(node.children).toEqual([]);
	});

	it('gives an Input a background, a value, a placeholder and a cursor, and no children of its own', () => {
		const node = snapshotOf(new Input('Driver name', { id: 'name_field', width: 200, height: 30 }));

		expect(partTypes(node)).toEqual(['Rectangle', 'Text', 'Text', 'Rectangle']);
		expect(node.children).toEqual([]);
	});

	it('gives a DeveloperOverlay a background and a stats readout, and no children of its own', () => {
		const node = snapshotOf(new DeveloperOverlay(new FrameTimer()));

		expect(partTypes(node)).toEqual(['Rectangle', 'Text']);
		expect(node.children).toEqual([]);
	});

	it('marks nothing as a part on a plain Layer, and omits the field rather than emitting an empty array', () => {
		const layer = new Layer({ id: 'row', width: 100, height: 20 });
		layer.addChild(new Layer({ id: 'cell', width: 20, height: 20 }));

		const node = snapshotOf(layer);

		expect('parts' in node).toBe(false);
		expect(childIds(node)).toEqual(['cell']);
	});
});

describe('what a caller adds is never a part', () => {
	it('routes a Panel child into the content layer, which is a part, while the child is not', () => {
		const panel = new Panel({ id: 'inventory_panel', width: 300, height: 200 });
		panel.addChild(new Layer({ id: 'inventory_row', width: 200, height: 30 }));

		const node = snapshotOf(panel);
		const contentLayer = (node.parts ?? [])[1];

		expect(node.children).toEqual([]);
		expect(partTypes(node)).toEqual(['Rectangle', 'Layer']);
		expect(childIds(contentLayer)).toEqual(['inventory_row']);
		expect('parts' in contentLayer).toBe(false);
	});

	it('puts a Button child in children and leaves its two parts alone', () => {
		const button = new Button('End turn', { id: 'end_turn_button', width: 120, height: 40 });
		button.addChild(new Layer({ id: 'cost_badge', width: 16, height: 16 }));

		const node = snapshotOf(button);

		expect(partTypes(node)).toEqual(['Rectangle', 'Text']);
		expect(childIds(node)).toEqual(['cost_badge']);
	});

	it('puts an Input child in children and leaves its four parts alone', () => {
		const input = new Input('Driver name', { id: 'name_field', width: 200, height: 30 });
		input.addChild(new Layer({ id: 'validation_icon', width: 16, height: 16 }));

		const node = snapshotOf(input);

		expect(partTypes(node)).toEqual(['Rectangle', 'Text', 'Text', 'Rectangle']);
		expect(childIds(node)).toEqual(['validation_icon']);
	});

	it('puts a DeveloperOverlay child in children and leaves its two parts alone', () => {
		const overlay = new DeveloperOverlay(new FrameTimer());
		overlay.addChild(new Layer({ id: 'gpu_readout', width: 100, height: 20 }));

		const node = snapshotOf(overlay);

		expect(partTypes(node)).toEqual(['Rectangle', 'Text']);
		expect(childIds(node)).toEqual(['gpu_readout']);
	});

	it('stops calling a removed part a part, so a re-added layer reports as a child', () => {
		const button = new Button('End turn', { id: 'end_turn_button', width: 120, height: 40 });
		const background = button.getChildren()[0];

		button.removeChild(background);
		button.addChild(background);

		const node = snapshotOf(button);

		expect(partTypes(node)).toEqual(['Text']);
		expect(node.children.map((child) => child.type)).toEqual(['Rectangle']);
	});
});
