import { renderTree } from '../../../engine/components/renderTree';
import { createTestContext } from '../../../engine/components/testing';
import type { DrawCommand } from '../../../engine/draw';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { PaintOrderFixturesSection } from './PaintOrderFixturesSection';

/**
 * The paint-order scene (DDB-205) is its own proof only if the tree, not the
 * scene's author, decides the order. These read what the backend received
 * after the draw API partitioned the frame by layer, which is the order the
 * GPU paints in (R3.10), and hold it to the arrangement each group claims.
 */

let commands: DrawCommand[];

beforeAll(() => {
	const { api, backend } = createMeasuringDrawApi();
	const section = new PaintOrderFixturesSection(0, 0, 1360);
	section.mount(createTestContext({ draw: api }));
	api.beginFrame({ viewport: { width: 1440, height: 882 }, ratio: 1 });
	renderTree(section, api);
	api.endFrame();
	commands = [...backend.commands];
	section.unmount();
});

function paintIndex(id: string): number {
	const index = commands.findIndex((command) => command.id === id);
	if (index < 0) throw new Error(`nothing drawn as '${id}'`);
	return index;
}

function command(id: string): DrawCommand {
	return commands[paintIndex(id)];
}

function painted(ids: string[]): string[] {
	return [...ids].sort((a, b) => paintIndex(a) - paintIndex(b));
}

describe('PaintOrderFixturesSection', () => {
	it('paints the layer ladder base, popup, tooltip whichever order it was inserted in (R3.10)', () => {
		for (const column of [0, 1]) {
			const ids = ['tooltip', 'base', 'popup'].map((layer) => `dev_po_layers_${column}_${layer}`);
			expect(painted(ids)).toEqual(['base', 'popup', 'tooltip'].map((layer) => `dev_po_layers_${column}_${layer}`));
		}
		expect(command('dev_po_layers_0_tooltip').layer).toBe('tooltip');
	});

	it('paints zIndex -1 to 2 in order whichever order the siblings were inserted in (R3.12)', () => {
		for (const column of [0, 1]) {
			const ids = [2, -1, 1, 0].map((zIndex) => `dev_po_z_${column}_${zIndex}`);
			expect(painted(ids)).toEqual([-1, 0, 1, 2].map((zIndex) => `dev_po_z_${column}_${zIndex}`));
			expect(new Set(ids.map((id) => command(id).layer))).toEqual(new Set(['base']));
		}
	});

	it('paints the shadowed panel after the ground it sits on', () => {
		expect(paintIndex('dev_po_shadowed')).toBeGreaterThan(paintIndex('dev_po_ground'));
	});

	it('raises the scroller\'s menu above the later rows and out of the scroller\'s clip (R3.8, R4.8)', () => {
		const menu = command('dev_po_scroll_menu');

		expect(menu.layer).toBe('popup');
		expect(menu.clip).toEqual({ kind: 'none' });
		expect(command('dev_po_row_6').clip.kind).toBe('rect');
		expect(paintIndex('dev_po_scroll_menu')).toBeGreaterThan(paintIndex('dev_po_row_6'));
	});

	it('keeps the modal\'s select in the modal layer though it asks for base (R3.6)', () => {
		expect(command('dev_po_modal_select').layer).toBe('modal');
		expect(paintIndex('dev_po_modal_select')).toBeGreaterThan(paintIndex('dev_po_dialog'));
	});

	it('paints the modal stack screen, modal, menu, toast, tooltip, the reverse of insertion', () => {
		const ids = ['dev_po_tooltip', 'dev_po_toast', 'dev_po_modal_menu', 'dev_po_dialog', 'dev_paint_order_screen'];

		expect(painted(ids)).toEqual([...ids].reverse());
		expect(ids.map((id) => command(id).layer)).toEqual(['tooltip', 'toast', 'popup', 'modal', 'base']);
	});

	it('paints the scrim under the dialog it was inserted before, by the dialog\'s zIndex', () => {
		expect(paintIndex('dev_po_dialog')).toBeGreaterThan(paintIndex('dev_po_scrim'));
	});
});
