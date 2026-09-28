import { DrawApi, NullBackend, TextCommand } from '../draw';
import { RendererContext } from '../rendering/RendererContext';
import { committedFontAtlas, installMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import { layoutText } from '../text/TextLayout';
import { Text } from './Text';
import { renderTree } from './renderTree';

const VIEWPORT = { width: 800, height: 600 };

/** The one text command `text` emits, drawn at the root. */
function drawn(api: DrawApi, backend: MeasuringRecordingBackend, text: Text): TextCommand {
	api.beginFrame({ viewport: VIEWPORT });
	renderTree(text, api);
	api.endFrame();
	const commands = backend.commands.filter((command): command is TextCommand => command.kind === 'text');
	expect(commands).toHaveLength(1);
	return commands[0];
}

describe('Text before it can measure', () => {
	it('keeps a zero hug size on a backend without metrics and measures once one has them', () => {
		const backend = new NullBackend();
		RendererContext.getInstance().draw = new DrawApi({ backend });
		const text = new Text('End turn', { style: { fontSize: 16 } });
		expect(text.getWidth()).toBe(0);
		expect(text.getHeight()).toBe(0);
		expect(text.measured).toBeNull();

		installMeasuringDrawApi();
		text.layout();
		expect(text.getWidth()).toBeGreaterThan(0);
		expect(text.measured).not.toBeNull();
	});
});

describe('Text (R12.4)', () => {
	let api: DrawApi;
	let backend: MeasuringRecordingBackend;

	beforeEach(() => {
		({ api, backend } = installMeasuringDrawApi());
	});

	it('hugs its measured line box and draws it from the top-left', () => {
		const text = new Text('End turn', { x: 10, y: 20, style: { fontSize: 16 } });
		const layout = layoutText(committedFontAtlas('body'), { text: 'End turn', font: 'body', size: 16 });

		expect(text.getWidth()).toBe(layout.width);
		expect(text.getHeight()).toBe(layout.lineHeight);

		const command = drawn(api, backend, text);
		// The box is the text's own, at its local origin; the walk's transform carries its position.
		expect(command.box).toEqual({ x: 0, y: 0, width: layout.width, height: layout.lineHeight });
		expect(command.transform).toEqual([1, 0, 0, 1, 10, 20]);
		expect(command.verticalAlign).toBe('top');
		expect(command.wrap).toBe('none');
	});

	it('re-hugs when its text or size changes', () => {
		const text = new Text('A', { style: { fontSize: 16 } });
		const narrow = text.getWidth();
		text.setText('A much longer label');
		expect(text.getWidth()).toBeGreaterThan(narrow);

		const wide = text.getWidth();
		text.setFontSize(32);
		expect(text.getWidth()).toBeGreaterThan(wide);
		expect(text.getHeight()).toBeGreaterThan(20);
	});

	it('wraps at an assigned width and hugs the wrapped height', () => {
		const text = new Text('the quick brown fox jumps over the lazy dog', { width: 90, style: { fontSize: 14 } });
		const metrics = text.measured;
		expect(metrics).not.toBeNull();
		expect(metrics?.lines).toBeGreaterThan(1);
		expect(metrics?.width).toBeLessThanOrEqual(90);
		expect(text.getWidth()).toBe(90);
		expect(text.getHeight()).toBe(metrics?.height);

		const command = drawn(api, backend, text);
		expect(command.wrap).toBe('word');
		expect(command.box?.width).toBe(90);
	});

	it('truncates a nowrap text to its assigned width with an ellipsis', () => {
		const text = new Text('Flanking Maneuver', {
			width: 40,
			style: { fontSize: 14, whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
		});
		expect(text.measured?.lines).toBe(1);
		expect(text.measured?.width).toBeGreaterThan(40);

		const command = drawn(api, backend, text);
		expect(command.wrap).toBe('none');
		expect(command.overflow).toBe('ellipsis');
		expect(command.box?.width).toBe(40);
	});

	it('maps textOverflow hidden to a clip', () => {
		const text = new Text('clipped', { width: 20, style: { textOverflow: 'hidden', whiteSpace: 'nowrap' } });
		expect(drawn(api, backend, text).overflow).toBe('clip');
	});

	it('aligns within an assigned box', () => {
		const text = new Text('OK', {
			width: 100,
			height: 40,
			style: { textAlign: 'center', verticalAlign: 'middle' },
		});
		const command = drawn(api, backend, text);
		expect(command.box).toEqual({ x: 0, y: 0, width: 100, height: 40 });
		expect(command.align).toBe('center');
		expect(command.verticalAlign).toBe('middle');
	});

	it('hugs again when an axis is set back to zero', () => {
		const text = new Text('Hug', { width: 200, height: 50 });
		text.setSize(0, 0);
		expect(text.getWidth()).toBe(text.measured?.width);
		expect(text.getHeight()).toBe(text.measured?.height);
	});

	it('resolves fontWeight through the theme table (R11.8)', () => {
		expect(new Text('Title', { style: { fontWeight: 'bold' } }).font).toBe('display');
		expect(new Text('Body').font).toBe('body');
		expect(new Text('42', { style: { fontFamily: 'monospace' } }).font).toBe('mono');
	});

	it('passes letter spacing, transform, decoration and line height through to the draw', () => {
		const text = new Text('kicker', {
			style: { letterSpacing: 0.16, textTransform: 'uppercase', textDecoration: 'underline', lineHeight: 1.5, fontSize: 10 },
		});
		expect(text.getHeight()).toBe(15);
		const command = drawn(api, backend, text);
		expect(command.letterSpacing).toBe(0.16);
		expect(command.textTransform).toBe('uppercase');
		expect(command.decoration).toBe('underline');
		// Uppercase is measured, not just drawn (R6.9): the hug width is the capitals'.
		const lower = new Text('kicker', { style: { letterSpacing: 0.16, fontSize: 10 } });
		expect(text.getWidth()).toBeGreaterThan(lower.getWidth());
	});
});
