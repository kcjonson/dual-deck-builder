import { ClipRect } from '../draw';
import { scissorBox } from './LegacyGLBackend';

/**
 * The one arithmetic in `LegacyGLBackend` that a golden depends on and a reader
 * cannot check by eye. No GL and no DOM: `scissorBox` is a pure function so it
 * can be tested at all (R14.1).
 *
 * The expected values are the expression the deleted `Layer.ts` block ran,
 * written out longhand rather than by calling the function under test:
 *
 *     webglX      = Math.floor(screenX * dpr)
 *     webglY      = Math.floor((canvas.height / dpr - screenY - height) * dpr)
 *     webglWidth  = Math.floor(width * dpr)
 *     webglHeight = Math.floor(height * dpr)
 */

function clip(x: number, y: number, width: number, height: number): ClipRect {
	return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

describe('scissorBox', () => {
	it('converts the developer screen panel at ratio 1', () => {
		// The real clip on developerScreen and cardShowcaseScreen, at the
		// harness's pinned 1440x882 viewport and deviceScaleFactor 1.
		expect(scissorBox(clip(0, 80, 1440, 722), 1, 882)).toEqual({
			x: 0,
			y: Math.floor(882 / 1 - 80 - 722),
			width: 1440,
			height: 722,
		});
	});

	it('scales the box and the flip by the ratio', () => {
		// Same logical rect on a 2x display: the canvas is twice as tall in
		// device pixels, so the logical height it divides back to is unchanged.
		expect(scissorBox(clip(0, 80, 1440, 722), 2, 1764)).toEqual({
			x: 0,
			y: Math.floor((1764 / 2 - 80 - 722) * 2),
			width: 2880,
			height: 1444,
		});
	});

	it('floors each of the four components independently', () => {
		const box = scissorBox(clip(10.6, 20.4, 100.7, 50.9), 1.5, 1323);
		expect(box).toEqual({
			x: Math.floor(10.6 * 1.5),
			y: Math.floor((1323 / 1.5 - 20.4 - 50.9) * 1.5),
			width: Math.floor(100.7 * 1.5),
			height: Math.floor(50.9 * 1.5),
		});
		// Flooring width separately from x is what makes the box narrower than
		// the rect rather than shifted, which is the behaviour the goldens hold.
		expect(box.width).toBe(151);
	});

	it('puts a rect at the bottom of the canvas at scissor y zero', () => {
		expect(scissorBox(clip(0, 800, 100, 82), 1, 882).y).toBe(0);
	});

	it('flips a rect at the top of the canvas to the far side', () => {
		expect(scissorBox(clip(0, 0, 100, 100), 1, 882).y).toBe(782);
	});
});
