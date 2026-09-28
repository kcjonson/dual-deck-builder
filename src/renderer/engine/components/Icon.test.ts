/**
 * @jest-environment jsdom
 */
import { DrawApi, TextCommand } from '../draw';
import { ICON_ATLAS_ROLE } from '../text/fontFaces';
import { ICON_CODE_POINTS } from '../text/icons';
import { installMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from './Icon';

describe('Icon (R12.6)', () => {
	let backend: MeasuringRecordingBackend;
	let api: DrawApi;

	beforeEach(() => {
		({ api, backend } = installMeasuringDrawApi());
	});

	function textCommands(): TextCommand[] {
		return backend.commands.filter((command): command is TextCommand => command.kind === 'text');
	}

	function frame(draw: () => void): void {
		api.beginFrame({ viewport: { width: 400, height: 200 } });
		draw();
		api.endFrame();
	}

	it('draws its glyph from the icon atlas, centred in its box, in text mode', () => {
		const icon = new Icon({ id: 'fuel', glyph: 'local_gas_station', size: 16, tint: tokens.color.accent, x: 10, y: 20 });
		frame(() => icon.render({ offsetX: 100, offsetY: 50 }));

		const [command] = textCommands();
		expect(command).toMatchObject({
			id: 'fuel',
			text: String.fromCodePoint(ICON_CODE_POINTS.local_gas_station),
			font: ICON_ATLAS_ROLE,
			size: 16,
			color: tokens.color.accent,
			box: { x: 110, y: 70, width: 16, height: 16 },
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
		});
	});

	it('defaults its box to its size and its tint to the text colour', () => {
		const icon = new Icon({ glyph: 'shield', size: 12 });
		expect([icon.getWidth(), icon.getHeight()]).toEqual([12, 12]);
		expect(icon.tint).toEqual(tokens.color.text);
	});

	it('keeps an explicit box and centres the glyph in it', () => {
		const icon = new Icon({ glyph: 'shield', size: 12, width: 30, height: 20 });
		frame(() => icon.render());
		expect(textCommands()[0].box).toEqual({ x: 0, y: 0, width: 30, height: 20 });
		expect(textCommands()[0].size).toBe(12);
	});

	it('changes glyph, size and tint through its accessors', () => {
		const icon = new Icon({ glyph: 'shield', size: 12 });
		icon.glyph = 'build';
		icon.size = 20;
		icon.tint = tokens.color.data;
		frame(() => icon.render());

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
		frame(() => icon.render());
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
			frame(() => button.render());

			const [label, icon] = textCommands();
			expect(icon.font).toBe(ICON_ATLAS_ROLE);
			expect(icon.text).toBe(String.fromCodePoint(ICON_CODE_POINTS.arrow_back));
			expect(icon.color).toEqual(tokens.color.text_bright);

			const labelWidth = api.measureText({ text: 'Back to Menu', font: 'body', size: 16 }).width;
			const iconBox = icon.box ?? { x: NaN, y: NaN, width: NaN, height: NaN };
			const gap = 6;
			const groupLeft = 30 + (200 - (iconBox.width + gap + labelWidth)) / 2;
			expect(iconBox.x).toBeCloseTo(groupLeft, 0);
			expect(iconBox.y + iconBox.height / 2).toBeCloseTo(30 + 25, 0);
			// The label centres in a box that gives up the icon and gap on its
			// left, so its measured left edge sits one gap past the icon.
			const labelBox = label.box ?? { x: NaN, y: NaN, width: NaN, height: NaN };
			expect(label.align).toBe('center');
			const labelCentre = labelBox.x + labelBox.width / 2;
			expect(labelCentre).toBeCloseTo(30 + 100 + (iconBox.width + gap) / 2);
			expect(labelCentre - labelWidth / 2).toBeCloseTo(iconBox.x + iconBox.width + gap, 0);
		});

		it('keeps its placement when the button moves, and re-places after a label change', () => {
			const button = new Button('Back', { icon: 'arrow_back', width: 200, height: 50 });
			button.setPosition(0, 0);
			// Text measures itself too, so count the button's own placement.
			const place = jest.spyOn(Button.prototype as unknown as { placeIcon: () => void }, 'placeIcon');
			frame(() => button.render());
			const first = textCommands().map((command) => command.box ?? command.position);

			button.setPosition(0, 0);
			frame(() => button.render());
			expect(textCommands().map((command) => command.box ?? command.position)).toEqual(first);
			expect(place).toHaveBeenCalledTimes(1);

			button.setLabel('Back to Menu');
			frame(() => button.render());
			expect(place).toHaveBeenCalledTimes(2);
			place.mockRestore();
		});

		it('draws no icon without one', () => {
			const button = new Button('Plain', { width: 100, height: 40 });
			button.setPosition(0, 0);
			frame(() => button.render());
			expect(textCommands().map((command) => command.font)).toEqual(['body']);
		});
	});
});
