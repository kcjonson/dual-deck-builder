import { committedFontAtlas, createMeasuringDrawApi } from '../text/testing';
import { layoutText } from '../text/TextLayout';
import { Container } from './Container';
import type { MountContext } from './MountContext';
import { Rectangle } from './Rectangle';
import { Stack } from './Stack';
import { Text, TextOptions } from './Text';
import { createTestContext } from './testing';

/**
 * The chapter 10 cases that need real text: measured against the committed
 * body face through the same metrics service the game draws with (R10.14).
 */

const SENTENCE = 'Scrap the escort and the convoy keeps rolling';
const LONGEST_WORD = 'convoy';

function measuringContext(): MountContext {
	return createTestContext({ draw: createMeasuringDrawApi().api });
}

function body(text: string, maxWidth?: number): ReturnType<typeof layoutText> {
	return layoutText(committedFontAtlas('body'), {
		text,
		font: 'body',
		size: 16,
		wrap: maxWidth === undefined ? 'none' : 'word',
		maxWidth,
	});
}

function label(text: string, style: TextOptions = {}): Text {
	return new Text({ text, ...style, style: { fontSize: 16, ...style.style } });
}

function layOut(root: Container, context: MountContext): void {
	if (!root.isMounted) root.mount(context);
	context.frame.layout();
}

describe('Text in a stack (R10.7, R10.13)', () => {
	it('hugs both axes by default and takes a fixed mode from an authored width (worldsim)', () => {
		expect(label('hello world').widthMode).toBe('hug');
		expect(label('hello world').heightMode).toBe('hug');
		expect(label('hi', { width: 80 }).widthMode).toBe('fixed');
	});

	it('wraps a hug text at a start-aligned fixed-width column and grows the hug column', () => {
		const context = measuringContext();
		const column = new Stack({ width: 120 });
		const text = label(SENTENCE);
		column.addChild(text);
		layOut(column, context);

		const wrapped = body(SENTENCE, 120);
		expect(wrapped.lines.length).toBeGreaterThan(1);
		expect(text.width).toBeLessThanOrEqual(120);
		expect(text.height).toBeCloseTo(wrapped.height, 5);
		expect(text.wrap).toBe('word');
		expect(column.height).toBeCloseTo(wrapped.height, 5);
		// Shrink-to-fit, not an assignment: the mode is still hug.
		expect(text.widthMode).toBe('hug');
	});

	it('takes an assigned width exactly as its wrap width (worldsim TextLayoutSizeSetsWrapWidth)', () => {
		const context = measuringContext();
		const column = new Stack({ width: 120, crossAlign: 'stretch' });
		const text = label(SENTENCE);
		column.addChild(text);
		layOut(column, context);

		expect(text.width).toBe(120);
		expect(text.wrap).toBe('word');
		expect(text.height).toBeCloseTo(body(SENTENCE, 120).height, 5);
		expect(text.widthMode).toBe('hug');
	});

	it('wraps a hug text in a hug row inside a narrow start-aligned column, instead of overflowing it', () => {
		const context = measuringContext();
		const column = new Stack({ width: 100 });
		const row = new Stack({ direction: 'horizontal' });
		const icon = new Rectangle({ width: 20, height: 20 });
		const text = label(SENTENCE);
		row.addChild(icon).addChild(text);
		column.addChild(row);
		layOut(column, context);

		expect(body(SENTENCE).width).toBeGreaterThan(300);
		expect(row.width).toBeLessThanOrEqual(100);
		expect(text.width).toBeLessThanOrEqual(80);
		expect(text.wrap).toBe('word');
		expect(text.height).toBeCloseTo(body(SENTENCE, 80).height, 5);
		expect(column.height).toBeCloseTo(text.height, 5);
	});

	it('keeps a short hug text at its own width rather than stretching it', () => {
		const context = measuringContext();
		const column = new Stack({ width: 300 });
		const text = label('Scrap');
		column.addChild(text);
		layOut(column, context);

		expect(text.width).toBeCloseTo(body('Scrap').width, 5);
	});

	it('keeps a fill text at its longest word in a row too narrow for it, and the row overflows', () => {
		const context = measuringContext();
		const row = new Stack({ width: 80, height: 200, direction: 'horizontal' });
		const icon = new Rectangle({ width: 60, height: 20 });
		const text = label(SENTENCE, { widthMode: 'fill' });
		row.addChild(icon).addChild(text);
		layOut(row, context);

		const word = body(LONGEST_WORD).width;
		expect(text.automaticMinSize('width')).toBeCloseTo(word, 5);
		expect(text.width).toBeCloseTo(word, 5);
		expect(text.x + text.width).toBeGreaterThan(row.width);
		// Wrapped at the word, not one glyph per line.
		expect(text.height).toBeCloseTo(body(SENTENCE, word).height, 5);
	});

	it('lets a clipping or ellipsised fill text go below its longest word', () => {
		const context = measuringContext();
		const row = new Stack({ width: 80, height: 40, direction: 'horizontal' });
		const icon = new Rectangle({ width: 60, height: 20 });
		const text = label(SENTENCE, { widthMode: 'fill', wrap: 'none', textOverflow: 'ellipsis' });
		row.addChild(icon).addChild(text);
		layOut(row, context);

		expect(text.automaticMinSize('width')).toBe(0);
		expect(text.width).toBe(20);
	});

	it('wraps a fill text in a row to its share and grows the hug row', () => {
		const context = measuringContext();
		const row = new Stack({ width: 200, direction: 'horizontal', crossAlign: 'start' });
		const icon = new Rectangle({ width: 40, height: 16 });
		const text = label(SENTENCE, { widthMode: 'fill' });
		row.addChild(icon).addChild(text);
		layOut(row, context);

		const wrapped = body(SENTENCE, 160);
		expect(text.width).toBe(160);
		expect(text.height).toBeCloseTo(wrapped.height, 5);
		expect(row.height).toBeCloseTo(wrapped.height, 5);
	});

	it('grows a nested hug container when its text grows after the first layout (the freeze regression)', () => {
		const context = measuringContext();
		const outer = new Stack({ width: 600, height: 400, direction: 'horizontal' });
		const inner = new Stack({ padding: 4 });
		const text = label('Hull');
		inner.addChild(text);
		const after = new Rectangle({ width: 10, height: 10 });
		outer.addChild(inner).addChild(after);
		layOut(outer, context);
		const before = inner.width;

		text.text = 'Hull integrity critical';
		layOut(outer, context);

		expect(inner.width).toBeCloseTo(body('Hull integrity critical').width + 8, 5);
		expect(inner.width).toBeGreaterThan(before);
		expect(after.x).toBeCloseTo(inner.width, 5);
	});

	it('propagates a text change to its hug ancestors and stops at the fixed boundary', () => {
		const context = measuringContext();
		const screen = new Container({ width: 800, height: 600 });
		const panel = new Stack({ width: 400, height: 300 });
		const row = new Stack({ direction: 'horizontal' });
		const text = label('Fuel');
		row.addChild(text);
		panel.addChild(row);
		screen.addChild(panel);
		layOut(screen, context);

		const screenPass = jest.spyOn(screen as unknown as { layoutChildren(): void }, 'layoutChildren');
		const panelPass = jest.spyOn(panel as unknown as { layoutChildren(): void }, 'layoutChildren');
		const rowPass = jest.spyOn(row as unknown as { layoutChildren(): void }, 'layoutChildren');

		text.text = 'Fuel reserves';
		layOut(screen, context);

		expect(rowPass).toHaveBeenCalledTimes(1);
		expect(panelPass).toHaveBeenCalledTimes(1);
		expect(screenPass).not.toHaveBeenCalled();
		expect(row.width).toBeCloseTo(body('Fuel reserves').width, 5);
	});

	it('keeps a width set through the accessor across a text change', () => {
		const context = measuringContext();
		const text = label(SENTENCE, { width: 200 });
		text.mount(context);
		text.width = 60;
		text.text = 'Convoy rolling';

		expect(text.width).toBe(60);
		expect(text.widthMode).toBe('fixed');
		expect(text.wrap).toBe('word');
	});

	it('hugs unwrapped again once moved out of a stack', () => {
		const context = measuringContext();
		const root = new Container({ width: 800, height: 600 });
		const column = new Stack({ width: 120 });
		const text = label(SENTENCE);
		column.addChild(text);
		root.addChild(column);
		layOut(root, context);
		expect(text.wrap).toBe('word');

		root.addChild(text);
		layOut(root, context);

		// The last assignment was the stack's; a plain parent assigns nothing.
		expect(text.wrap).toBe('none');
		expect(text.width).toBeCloseTo(body(SENTENCE).width, 5);
	});
});
