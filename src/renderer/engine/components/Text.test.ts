import { DrawApi, NullBackend, TextCommand } from '../draw';
import { committedFontAtlas, createMeasuringDrawApi, MeasuringRecordingBackend } from '../text/testing';
import type { MountContext } from './MountContext';
import { createTestContext } from './testing';
import { layoutText } from '../text/TextLayout';
import { Text } from './Text';
import { Container } from './Container';
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

describe('Text measures through the mount context (R1.6)', () => {
	it('keeps a zero hug size until it is mounted, then hugs its measured line box', () => {
		const text = new Text('End turn', { style: { fontSize: 16 } });
		expect(text.width).toBe(0);
		expect(text.height).toBe(0);
		expect(text.measured).toBeNull();

		text.mount(createTestContext({ draw: createMeasuringDrawApi().api }));
		expect(text.width).toBeGreaterThan(0);
		expect(text.measured).not.toBeNull();
	});

	it('stays unmeasured on a backend without metrics, and never estimates', () => {
		const text = new Text('End turn', { style: { fontSize: 16 } });
		text.mount(createTestContext({ draw: new DrawApi({ backend: new NullBackend() }) }));

		expect(text.width).toBe(0);
		expect(text.measured).toBeNull();
	});

	it('invalidates its parent when mounting gives it a size, so the parent lays out before render', () => {
		const context = createTestContext({ draw: createMeasuringDrawApi().api });
		const row = new Container({ width: 300, height: 20 });
		const seen: number[] = [];
		const label = new Text('Scrap', { style: { fontSize: 16 }, onLayout: (bounds) => seen.push(bounds.width) });
		row.addChild(label);

		row.mount(context);
		context.frame.layout();

		expect(seen).toEqual([label.width]);
		expect(label.width).toBeGreaterThan(0);
	});
});

describe('Text (R12.4)', () => {
	let api: DrawApi;
	let backend: MeasuringRecordingBackend;
	let context: MountContext;

	beforeEach(() => {
		({ api, backend } = createMeasuringDrawApi());
		context = createTestContext({ draw: api });
	});

	/** Mounted, so it measures through the context (R1.6). */
	function mounted(text: Text): Text {
		text.mount(context);
		return text;
	}

	it('hugs its measured line box and draws it from the top-left', () => {
		const text = mounted(new Text('End turn', { x: 10, y: 20, style: { fontSize: 16 } }));
		const layout = layoutText(committedFontAtlas('body'), { text: 'End turn', font: 'body', size: 16 });

		expect(text.width).toBe(layout.width);
		expect(text.height).toBe(layout.lineHeight);

		const command = drawn(api, backend, text);
		// The box is the text's own, at its local origin; the walk's transform carries its position.
		expect(command.box).toEqual({ x: 0, y: 0, width: layout.width, height: layout.lineHeight });
		expect(command.transform).toEqual([1, 0, 0, 1, 10, 20]);
		expect(command.verticalAlign).toBe('top');
		expect(command.wrap).toBe('none');
	});

	it('re-hugs when its text or size changes', () => {
		const text = mounted(new Text('A', { style: { fontSize: 16 } }));
		const narrow = text.width;
		text.text = 'A much longer label';
		expect(text.width).toBeGreaterThan(narrow);

		const wide = text.width;
		text.fontSize = 32;
		expect(text.width).toBeGreaterThan(wide);
		expect(text.height).toBeGreaterThan(20);
	});

	it('wraps at an assigned width and hugs the wrapped height', () => {
		const text = mounted(new Text('the quick brown fox jumps over the lazy dog', { width: 90, style: { fontSize: 14 } }));
		const metrics = text.measured;
		expect(metrics).not.toBeNull();
		expect(metrics?.lines).toBeGreaterThan(1);
		expect(metrics?.width).toBeLessThanOrEqual(90);
		expect(text.width).toBe(90);
		expect(text.height).toBe(metrics?.height);

		const command = drawn(api, backend, text);
		expect(command.wrap).toBe('word');
		expect(command.box?.width).toBe(90);
	});

	it('truncates a nowrap text to its assigned width with an ellipsis', () => {
		const text = mounted(new Text('Flanking Maneuver', {
			width: 40,
			style: { fontSize: 14 }, wrap: 'none', textOverflow: 'ellipsis',
		}));
		expect(text.measured?.lines).toBe(1);
		expect(text.measured?.width).toBeGreaterThan(40);

		const command = drawn(api, backend, text);
		expect(command.wrap).toBe('none');
		expect(command.overflow).toBe('ellipsis');
		expect(command.box?.width).toBe(40);
	});

	it('maps textOverflow hidden to a clip', () => {
		const text = mounted(new Text('clipped', { width: 20, textOverflow: 'clip', wrap: 'none' }));
		expect(drawn(api, backend, text).overflow).toBe('clip');
	});

	it('aligns within an assigned box', () => {
		const text = mounted(new Text('OK', {
			width: 100,
			height: 40,
			style: { textAlign: 'center' }, verticalAlign: 'middle',
		}));
		const command = drawn(api, backend, text);
		expect(command.box).toEqual({ x: 0, y: 0, width: 100, height: 40 });
		expect(command.align).toBe('center');
		expect(command.verticalAlign).toBe('middle');
	});

	it('hugs again when an axis is set back to zero', () => {
		const text = mounted(new Text('Hug', { width: 200, height: 50 }));
		text.setSize(0, 0);
		expect(text.width).toBe(text.measured?.width);
		expect(text.height).toBe(text.measured?.height);
	});

	it('resolves fontWeight through the theme table (R11.8)', () => {
		expect(mounted(new Text('Title', { style: { fontWeight: 'bold' } })).font).toBe('display');
		expect(mounted(new Text('Body')).font).toBe('body');
		expect(mounted(new Text('42', { style: { fontFamily: 'monospace' } })).font).toBe('mono');
	});

	it('passes letter spacing, transform, decoration and line height through to the draw', () => {
		const text = mounted(new Text('kicker', {
			style: { letterSpacing: 0.16, textTransform: 'uppercase', textDecoration: 'underline', fontSize: 10 }, lineHeight: 1.5,
		}));
		expect(text.height).toBe(15);
		const command = drawn(api, backend, text);
		expect(command.letterSpacing).toBe(0.16);
		expect(command.textTransform).toBe('uppercase');
		expect(command.decoration).toBe('underline');
		// Uppercase is measured, not just drawn (R6.9): the hug width is the capitals'.
		const lower = mounted(new Text('kicker', { style: { letterSpacing: 0.16, fontSize: 10 } }));
		expect(text.width).toBeGreaterThan(lower.width);
	});
});
