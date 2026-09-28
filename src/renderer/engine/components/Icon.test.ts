/**
 * @jest-environment jsdom
 */
import { DrawApi, TextCommand } from '../draw';
import { ICON_ATLAS_ROLE } from '../text/fontFaces';
import { ICON_CODE_POINTS } from '../text/icons';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import type { MountContext } from './MountContext';
import { Component } from './Component';
import { Layer } from './Layer';
import { renderTree } from './renderTree';
import { createTestContext } from './testing';
import { tokens } from '../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from './Icon';

describe('Icon (R12.6)', () => {
	let backend: MeasuringRecordingBackend;
	let api: DrawApi;
	let context: MountContext;

	beforeEach(() => {
		({ api, backend } = createMeasuringDrawApi());
		context = createTestContext({ draw: api });
	});

	function textCommands(): TextCommand[] {
		return backend.commands.filter((command): command is TextCommand => command.kind === 'text');
	}

	/** Mounts, lays out, and walks one frame of `root`, the way the page does. */
	function frame(root: Component): void {
		root.mount(context);
		context.frame.layout();
		api.beginFrame({ viewport: { width: 400, height: 200 } });
		renderTree(root, api);
		api.endFrame();
	}

	/** A command's box in screen space: its local box through the walk's translation. */
	function screenBox(command: TextCommand): { x: number; y: number; width: number; height: number } {
		const box = command.box ?? { x: NaN, y: NaN, width: NaN, height: NaN };
		return { x: box.x + command.transform[4], y: box.y + command.transform[5], width: box.width, height: box.height };
	}

	it('draws its glyph from the icon atlas, centred in its box, in text mode', () => {
		const icon = new Icon({ id: 'fuel', glyph: 'local_gas_station', size: 16, tint: tokens.color.accent, x: 10, y: 20 });
		const holder = new Layer({ x: 100, y: 50 });
		holder.addChild(icon);
		frame(holder);

		const [command] = textCommands();
		expect(command).toMatchObject({
			id: 'fuel',
			text: String.fromCodePoint(ICON_CODE_POINTS.local_gas_station),
			font: ICON_ATLAS_ROLE,
			size: 16,
			color: tokens.color.accent,
			box: { x: 0, y: 0, width: 16, height: 16 },
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
		});
		expect(screenBox(command)).toEqual({ x: 110, y: 70, width: 16, height: 16 });
	});

	it('defaults its box to its size and its tint to the text colour', () => {
		const icon = new Icon({ glyph: 'shield', size: 12 });
		expect([icon.getWidth(), icon.getHeight()]).toEqual([12, 12]);
		expect(icon.tint).toEqual(tokens.color.text);
	});

	it('keeps an explicit box and centres the glyph in it', () => {
		const icon = new Icon({ glyph: 'shield', size: 12, width: 30, height: 20 });
		frame(icon);
		expect(textCommands()[0].box).toEqual({ x: 0, y: 0, width: 30, height: 20 });
		expect(textCommands()[0].size).toBe(12);
	});

	it('changes glyph, size and tint through its accessors', () => {
		const icon = new Icon({ glyph: 'shield', size: 12 });
		icon.glyph = 'build';
		icon.size = 20;
		icon.tint = tokens.color.data;
		frame(icon);

		expect(textCommands()[0]).toMatchObject({
			text: String.fromCodePoint(ICON_CODE_POINTS.build),
			size: 20,
			color: tokens.color.data,
			box: { x: 0, y: 0, width: 20, height: 20 },
		});
	});

	it('draws nothing while hidden', () => {
		const icon = new Icon({ glyph: 'shield', size: 12 });
		icon.setVisible(false);
		frame(icon);
		expect(textCommands()).toEqual([]);
	});

	it('measures one em wide, so an icon lines up with the box it was given', () => {
		const metrics = api.measureText({ text: String.fromCodePoint(ICON_CODE_POINTS.arrow_back), font: ICON_ATLAS_ROLE, size: 24 });
		expect(metrics.width).toBeCloseTo(24);
		expect(metrics.height).toBeCloseTo(24);
	});

	describe('as a button\'s leading icon (R12.7)', () => {
		it('centres icon, gap and label together as one group', () => {
			const button = new Button('Back to Menu', { id: 'back', icon: 'arrow_back', width: 200, height: 50 });
			button.setPosition(30, 30);
			frame(button);

			const [label, icon] = textCommands();
			expect(icon.font).toBe(ICON_ATLAS_ROLE);
			expect(icon.text).toBe(String.fromCodePoint(ICON_CODE_POINTS.arrow_back));
			expect(icon.color).toEqual(tokens.color.text);
			expect(icon.size).toBe(tokens.control.icon_md);

			const labelWidth = api.measureText({ text: 'Back to Menu', font: 'display', size: tokens.control.control_fs_md }).width;
			const iconBox = screenBox(icon);
			const gap = Math.round(tokens.control.control_fs_md * 0.375);
			const groupLeft = 30 + (200 - (iconBox.width + gap + labelWidth)) / 2;
			expect(iconBox.x).toBeCloseTo(groupLeft, 0);
			expect(iconBox.y + iconBox.height / 2).toBeCloseTo(30 + 25, 0);
			// The label centres in a box that gives up the icon and gap on its
			// left, so its measured left edge sits one gap past the icon.
			const labelBox = screenBox(label);
			expect(label.align).toBe('center');
			const labelCentre = labelBox.x + labelBox.width / 2;
			expect(labelCentre).toBeCloseTo(30 + 100 + (iconBox.width + gap) / 2);
			expect(labelCentre - labelWidth / 2).toBeCloseTo(iconBox.x + iconBox.width + gap, 0);
		});

		it('places in the layout phase, not again for a move, and again after a label change', () => {
			const button = new Button('Back', { icon: 'arrow_back', width: 200, height: 50 });
			// Text measures itself too, so count the button's own placement.
			const place = jest.spyOn(Button.prototype as unknown as { placeLabel: () => void }, 'placeLabel');
			frame(button);
			const placed = place.mock.calls.length;
			expect(placed).toBeGreaterThan(0);
			const first = textCommands().map(screenBox);

			button.setPosition(0, 0);
			context.frame.layout();
			expect(place).toHaveBeenCalledTimes(placed);

			button.setLabel('Back to Menu');
			context.frame.layout();
			expect(place.mock.calls.length).toBeGreaterThan(placed);
			expect(first).toHaveLength(2);
			place.mockRestore();
		});

		it('draws no icon without one', () => {
			const button = new Button('Plain', { width: 100, height: 40 });
			button.setPosition(0, 0);
			frame(button);
			expect(textCommands().map((command) => command.font)).toEqual(['display']);
		});
	});
});
