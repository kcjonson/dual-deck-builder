/**
 * @jest-environment jsdom
 */
import { Clock } from '../animation/Clock';
import { DrawApi, RectCommand, TextCommand } from '../draw';
import type { MountContext } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import { createTestContext } from '../components/testing';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { tokens } from '../theme/tokens';
import { over } from '../style/look';
import type { StyleObject } from '../style/styleObject';
import { Button } from './Button';
import { TextInput } from './TextInput';

const { color } = tokens;

describe('Button styling (R11)', () => {
	let backend: MeasuringRecordingBackend;
	let api: DrawApi;
	let context: MountContext;

	beforeEach(() => {
		({ api, backend } = createMeasuringDrawApi());
		context = createTestContext({ draw: api, clock: new Clock() });
	});

	function mount<T extends Button | TextInput>(component: T): T {
		component.mount(context);
		context.frame.layout();
		return component;
	}

	function draw(component: Button | TextInput): { rects: RectCommand[]; texts: TextCommand[] } {
		const commands = frameCommands(component);
		return {
			rects: commands.filter((command): command is RectCommand => command.kind === 'rect'),
			texts: commands.filter((command): command is TextCommand => command.kind === 'text'),
		};
	}

	function frameCommands(component: Button | TextInput): typeof backend.commands {
		api.beginFrame({ viewport: { width: 400, height: 200 } });
		renderTree(component, api);
		api.endFrame();
		return backend.commands;
	}

	/** Advances the frame clock by `ms`, ticking the animator. */
	function advance(ms: number): void {
		context.frame.update(ms / 1000);
	}

	describe('variants', () => {
		it('draws the default tone from tokens: raised surface, edge line, text colour, display label', () => {
			const button = mount(new Button({ label: 'Go', id: 'go', width: 100 }));
			const { rects, texts } = draw(button);
			expect(button.height).toBe(tokens.control.control_h_md);
			expect(rects[0]).toMatchObject({ id: 'go', fill: color.bg_panel_raised, border: { color: color.line_edge, width: 1 } });
			expect(texts[0]).toMatchObject({ font: 'display', size: tokens.control.control_fs_md, color: color.text });
		});

		it('fills the accent tone with dark text', () => {
			const { rects, texts } = draw(mount(new Button({ label: 'Go', tone: 'accent', width: 100 })));
			expect(rects[0].fill).toEqual(color.accent);
			expect(texts[0].color).toEqual(color.accent_contrast);
		});

		it('takes height, label size, and icon size from size, and keeps an explicit height', () => {
			const large = mount(new Button({ label: 'Go', size: 'lg', icon: 'arrow_back', width: 160 }));
			const { texts } = draw(large);
			expect(large.height).toBe(tokens.control.control_h_lg);
			expect(texts.map((text) => text.size)).toEqual([tokens.control.control_fs_lg, tokens.control.icon_lg]);
			expect(new Button({ label: 'Go', size: 'sm', height: 40 }).height).toBe(40);
		});
	});

	describe('style object (R11.14)', () => {
		const base = (): { rects: RectCommand[]; texts: TextCommand[] } => draw(mount(new Button({ label: 'Go', width: 100 })));
		const styled = (style: StyleObject) => draw(mount(new Button({ label: 'Go', width: 100, style })));

		// Each accepted property changes the recorded draw list against a
		// baseline, the unstyled button unless the case names another.
		const cases: Array<[string, StyleObject, (rects: RectCommand[], texts: TextCommand[]) => void, StyleObject?]> = [
			['backgroundColor', { backgroundColor: 'data' }, (rects) => expect(rects[0].fill).toEqual(color.data)],
			['color', { color: 'accent' }, (_rects, texts) => expect(texts[0].color).toEqual(color.accent)],
			['borderColor', { borderColor: 'accent' }, (rects) => expect(rects[0].border?.color).toEqual(color.accent)],
			['borderWidth', { borderWidth: 'bw_thick' }, (rects) => expect(rects[0].border?.width).toBe(2)],
			['borderRadius', { borderRadius: 'r_lg' }, (rects) => expect(rects[0].radius).toEqual(tokens.radius.r_lg)],
			['fontSize', { fontSize: 'fs_2xl' }, (_rects, texts) => expect(texts[0].size).toBe(28)],
			['fontRole', { fontRole: 'mono' }, (_rects, texts) => expect(texts[0].font).toBe('mono')],
			['fontFamily', { fontFamily: 'monospace' }, (_rects, texts) => expect(texts[0].font).toBe('mono')],
			['fontWeight', { fontRole: 'body', fontWeight: 'bold' }, (_rects, texts) => expect(texts[0].font).toBe('display'), { fontRole: 'body' }],
			['letterSpacing', { letterSpacing: 'ls_wide' }, (_rects, texts) => expect(texts[0].letterSpacing).toBe(0.08)],
			['textTransform', { textTransform: 'uppercase' }, (_rects, texts) => expect(texts[0].textTransform).toBe('uppercase')],
			['textAlign', { textAlign: 'left' }, (_rects, texts) => expect(texts[0].align).toBe('left')],
			['textDecoration', { textDecoration: 'underline' }, (_rects, texts) => expect(texts[0].decoration).toBe('underline')],
			['padding', { padding: { left: 'space_6' } }, (_rects, texts) => expect(texts[0].box?.width).toBe(100 - 24 - 12)],
		];

		// Every row padded to four, or jest-each reads the fourth parameter as `done`.
		it.each(cases.map(([name, style, check, baseline]) => [name, style, check, baseline ?? null] as const))('renders %s', (_name, style, check, baseline) => {
			const { rects, texts } = styled(style);
			check(rects, texts);
			expect({ rects, texts }).not.toEqual(baseline ? styled(baseline) : base());
		});

		it('renders shadow as the box shadow group', () => {
			const button = mount(new Button({ label: 'Go', width: 100, style: { shadow: 'shadow_raised' } }));
			expect(frameCommands(button).map((command) => command.kind)).toContain('shadow');
		});

		it('renders opacity through the component', () => {
			expect(new Button({ label: 'Go', style: { opacity: 0.5 } }).opacity).toBe(0.5);
		});

		it('throws on an unknown key and on a property it does not render', () => {
			expect(() => new Button({ label: 'Go', style: { border: '1px solid red' } as StyleObject })).toThrow(/not a style property/);
			expect(() => new Button({ label: 'Go', style: { cursor: 'pointer' } })).toThrow(/does not render/);
			expect(() => new TextInput({ style: { textAlign: 'center' } })).toThrow(/does not render/);
		});

		it('restyles at runtime through the same accessor, and validates it', () => {
			const button = mount(new Button({ label: 'Go', width: 100 }));
			button.style = { backgroundColor: 'status_crit', fontSize: 'fs_lg' };
			advance(tokens.motion.dur_fast);
			context.frame.layout();
			const { rects, texts } = draw(button);
			expect(rects[0].fill).toEqual(color.status_crit);
			expect(texts[0].size).toBe(tokens.fontSize.fs_lg);
			expect(() => { button.style = { verticalAlign: 'top' } as unknown as StyleObject; }).toThrow();
		});

		it('resets opacity when a new style drops it', () => {
			const button = new Button({ label: 'Go', style: { opacity: 0.5 } });
			button.style = {};
			expect(button.opacity).toBe(1);
			const faded = new Button({ label: 'Go', opacity: 0.4 });
			faded.style = { color: 'accent' };
			expect(faded.opacity).toBe(0.4);
		});

		it('takes its height from size until the caller sets one', () => {
			const button = new Button({ label: 'Go', width: 100 });
			button.size = 'lg';
			expect(button.height).toBe(tokens.control.control_h_lg);
			const fixed = new Button({ label: 'Go', width: 100, height: 40 });
			fixed.size = 'sm';
			expect(fixed.height).toBe(40);
			button.setSize(100, 50);
			button.size = 'sm';
			expect(button.height).toBe(50);
			const input = new TextInput({ width: 100 });
			input.size = 'sm';
			expect(input.height).toBe(tokens.control.control_h_sm);
		});

		it('switches tone at runtime', () => {
			const button = mount(new Button({ label: 'Go', width: 100 }));
			button.tone = 'ok';
			advance(tokens.motion.dur_fast);
			expect(draw(button).rects[0].fill).toEqual(color.status_ok);
		});
	});

	describe('transitions (R11.13)', () => {
		const hoverFill = over(color.bg_panel_raised, color.bg_hover);

		it('reaches the hover fill at dur_fast', () => {
			const button = mount(new Button({ label: 'Go', width: 100 }));
			button.hovered = true;
			advance(tokens.motion.dur_fast / 2);
			const midway = button.look.fill;
			expect(midway).not.toEqual(color.bg_panel_raised);
			expect(midway).not.toEqual(hoverFill);
			advance(tokens.motion.dur_fast / 2);
			expect(button.look.fill).toEqual(hoverFill);
			expect(draw(button).rects[0].fill).toEqual(hoverFill);
		});

		it('reverses from the current value when the hover ends mid-way', () => {
			const button = mount(new Button({ label: 'Go', width: 100 }));
			button.hovered = true;
			advance(tokens.motion.dur_fast / 2);
			const midway = button.look.fill[0];
			button.hovered = false;
			expect(button.look.fill[0]).toBeCloseTo(midway, 6);
			advance(1);
			expect(button.look.fill[0]).toBeLessThan(midway);
			advance(tokens.motion.dur_fast);
			expect(button.look.fill).toEqual(color.bg_panel_raised);
		});

		it('moves the glow over dur, slower than the colour', () => {
			const button = mount(new Button({ label: 'Go', tone: 'accent', width: 100 }));
			button.hovered = true;
			advance(tokens.motion.dur_fast);
			expect(button.look.fill).toEqual(color.accent_bright);
			expect(button.look.glow[3]).toBeLessThan(color.accent_glow[3]);
			advance(tokens.motion.dur - tokens.motion.dur_fast);
			expect(button.look.glow).toEqual(color.accent_glow);
		});

		it('nudges the box and label down while pressed', () => {
			const button = mount(new Button({ label: 'Go', width: 100 }));
			button.pressed = true;
			advance(tokens.motion.dur_fast);
			const { rects, texts } = draw(button);
			expect(rects[0].rect.y).toBe(tokens.control.press_offset);
			expect(texts[0].transform[5]).toBe(tokens.control.press_offset);
		});

		it('is immediate under reduced motion', () => {
			context.animator.reducedMotion = true;
			const button = mount(new Button({ label: 'Go', width: 100 }));
			button.hovered = true;
			advance(1);
			expect(button.look.fill).toEqual(hoverFill);
		});

		it('snaps while unmounted, where there is no animator', () => {
			const button = new Button({ label: 'Go', width: 100 });
			button.hovered = true;
			expect(button.look.fill).toEqual(hoverFill);
		});

		it('shows the focus ring at once, outside the box at the ring offset', () => {
			const button = mount(new Button({ label: 'Go', width: 100 }));
			context.focus.focus(button, 'keyboard');
			const ring = draw(button).rects[1];
			const offset = tokens.control.focus_ring_offset;
			expect(ring.rect).toEqual({ x: -offset, y: -offset, width: 100 + offset * 2, height: button.height + offset * 2 });
			expect(ring.border).toEqual({ color: color.accent, width: tokens.control.focus_ring_width, position: 'outside' });
			expect(ring.fill).toEqual([0, 0, 0, 0]);
		});
	});

	describe('TextInput', () => {
		it('draws an inset well and lifts its border to the accent while focused', () => {
			const input = mount(new TextInput({ placeholder: 'Name', width: 200 }));
			expect(input.height).toBe(tokens.control.control_h_md);
			expect(draw(input).rects[0]).toMatchObject({ fill: color.bg_inset, border: { color: color.line_edge } });
			context.focus.focus(input);
			expect(input.active).toBe(true);
			advance(tokens.motion.dur_fast);
			expect(draw(input).rects[0].border?.color).toEqual(color.accent);
			context.focus.blur();
			expect(input.active).toBe(false);
		});

		it('clears its editing state when unmounted while focused', () => {
			const input = mount(new TextInput({ placeholder: 'Name', width: 200 }));
			context.focus.focus(input);
			expect(input.active).toBe(true);
			input.unmount();
			expect(input.active).toBe(false);
			expect(input.focused).toBe(false);
			mount(input);
			expect(input.look.border).toEqual(color.line_edge);
		});

		it('draws its placeholder faint, and value and placeholder in the disabled colour when disabled', () => {
			const input = mount(new TextInput({ placeholder: 'Name', width: 200 }));
			const textOf = (content: string) => draw(input).texts.find((text) => text.text === content);
			expect(textOf('Name')?.color).toEqual(color.text_faint);
			input.enabled = false;
			advance(tokens.motion.dur_fast);
			expect(textOf('Name')?.color).toEqual(color.text_disabled);
			input.value = 'x';
			expect(textOf('x')?.color).toEqual(color.text_disabled);
		});
	});
});
