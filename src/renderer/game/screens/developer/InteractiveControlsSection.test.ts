/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { Component } from '../../../engine/components/Component';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { InteractiveControlsSection } from './InteractiveControlsSection';

/** The demo rectangle is the stage's one child. */
function demoIn(section: InteractiveControlsSection): { stage: Component; rectangle: Component } {
	const stage = section.findById('dev_controls_stage');
	if (!stage) throw new Error('the stage should be mounted');
	return { stage, rectangle: stage.getChildren()[0] };
}

function expectInside(stage: Component, rectangle: Component): void {
	expect(rectangle.x).toBeGreaterThanOrEqual(0);
	expect(rectangle.y).toBeGreaterThanOrEqual(0);
	expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(stage.width);
	expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(stage.height);
}

describe('InteractiveControlsSection demo stage', () => {
	it('holds a typed position inside the stage, and again when the section narrows', () => {
		const context = createTestContext({ draw: createMeasuringDrawApi().api });
		const section = new InteractiveControlsSection({ width: 1360 });
		section.mount(context);
		context.frame.layout();
		const { stage, rectangle } = demoIn(section);

		(section as unknown as { applyPosition(value: string): void }).applyPosition('5000,5000');
		context.frame.layout();
		expectInside(stage, rectangle);
		expect(rectangle.x).toBe(stage.width - rectangle.width);

		section.width = 600;
		context.frame.layout();
		expectInside(stage, rectangle);
		expect(rectangle.x).toBe(stage.width - rectangle.width);
		section.unmount();
	});
});
