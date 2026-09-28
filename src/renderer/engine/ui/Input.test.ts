/**
 * @jest-environment jsdom
 */
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { createMeasuringDrawApi } from '../text/testing';
import { createTestContext } from '../components/testing';
import type { MountContext } from '../components/MountContext';
import { Input } from './Input';

function parts(input: Input): { value: Text; caret: Rectangle } {
	const [, value, , caret] = input.debugChildren;
	if (!(value instanceof Text) || !(caret instanceof Rectangle)) throw new Error('unexpected Input parts');
	return { value, caret };
}

describe('Input caret (R2.14)', () => {
	let context: MountContext;

	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	/** Mounted and laid out: the caret follows the value's measured layout. */
	function mounted(input: Input): Input {
		input.mount(context);
		context.frame.layout();
		return input;
	}

	it('sits after the last code point, at the pen position the value is drawn with', () => {
		const input = mounted(new Input('placeholder', { width: 200, height: 30 }));
		input.setValue('Hello ');
		const { value, caret } = parts(input);
		const advances = value.measured?.advances ?? [];

		expect(advances).toHaveLength(6);
		// The trailing space counts: the caret is past it, not at the o.
		expect(caret.x).toBe(10 + advances[5]);
		expect(advances[5]).toBeGreaterThan(advances[4]);
	});

	it('spans the value line box, centred in the field', () => {
		const input = mounted(new Input('', { width: 200, height: 30 }));
		const { value, caret } = parts(input);
		const lineHeight = value.measured?.height ?? 0;

		expect(lineHeight).toBeGreaterThan(0);
		expect(caret.x).toBe(10);
		expect(caret.getHeight()).toBe(lineHeight);
		expect(caret.y + caret.getHeight() / 2).toBe(15);
	});
});
