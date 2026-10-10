import { Clock } from '../../engine/animation/Clock';
import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import { renderTree } from '../../engine/components/renderTree';
import { createTestContext } from '../../engine/components/testing';
import type { DrawCommand, RectCommand, TextCommand } from '../../engine/draw';
import { key, send } from '../../engine/services/testing';
import { MeasuringRecordingBackend, createMeasuringDrawApi } from '../../engine/text/testing';
import { tokens } from '../../engine/theme/tokens';
import { FocusGroup } from '../../engine/ui/FocusGroup';
import { RouteCard } from './RouteCard';

/** The run route screen's route card: three lines at a height its content fixes, picked by its focus group. */

const { color } = tokens;

let context: MountContext;
let backend: MeasuringRecordingBackend;
let root: Container;

beforeEach(() => {
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	root = new Container({ id: 'root', width: 800, height: 600 });
	root.mount(context);
});

function draws(): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 800, height: 600 } });
	renderTree(root, api);
	api.endFrame();
	return backend.commands;
}

const texts = (commands: readonly DrawCommand[]): string[] => commands.filter((command): command is TextCommand => command.kind === 'text').map((command) => command.text);

describe('RouteCard', () => {
	it('draws its title, its detail, and its note, a line taller with a note, and fits them', () => {
		const group = new FocusGroup({ id: 'cards', width: 320, crossAlign: 'stretch', selection: 'single' });
		const plain = new RouteCard({ id: 'plain', title: 'Back roads', detail: 'charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3' });
		const noted = new RouteCard({ id: 'noted', title: 'Through the mire', detail: 'charted / 2 stops', note: 'Back after dark.' });
		group.addChild(plain);
		group.addChild(noted);
		root.addChild(group);
		context.frame.layout();
		expect(plain.width).toBe(320);
		expect(noted.height).toBeGreaterThan(plain.height);
		expect(texts(draws())).toEqual(['Back roads', 'charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3', 'Through the mire', 'charted / 2 stops', 'Back after dark.']);
		expect([plain.titleText, plain.detailText, plain.noteText, noted.noteText]).toEqual(['Back roads', 'charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3', null, 'Back after dark.']);
	});

	it('is picked by its group, by click or keyboard, the pick drawn with the selected wash and the accent bar, and keeps its height', () => {
		const picks: string[] = [];
		const group = new FocusGroup({ id: 'cards', width: 320, crossAlign: 'stretch', selection: 'single', onSelect: (selected) => picks.push(selected[0]?.id ?? '') });
		const first = new RouteCard({ id: 'first', title: 'Route 9 highway', detail: 'charted / 2 stops', selected: true });
		const second = new RouteCard({ id: 'second', title: 'Back roads', detail: 'charted / 4 stops', dim: true });
		group.addChild(first);
		group.addChild(second);
		root.addChild(group);
		context.frame.layout();
		const height = second.height;

		context.focus.focus(first);
		send(context, [key('ArrowDown'), key('Enter')]);
		expect(picks).toEqual(['second']);
		expect([first.selected, second.selected]).toEqual([false, true]);
		expect(second.height).toBe(height);
		expect(second.dim).toBe(true);
		context.animator.settle();
		const bar = draws().find((command): command is RectCommand => command.kind === 'rect' && command.rect.x === 0 && command.rect.width === tokens.borderWidth.bw_thick);
		expect(bar?.fill).toEqual(color.accent);
		expect(second.look.fill).toEqual(color.bg_active);
	});
});
