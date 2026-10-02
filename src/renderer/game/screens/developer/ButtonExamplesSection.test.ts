import type { Component } from '../../../engine/components/Component';
import { createTestContext } from '../../../engine/components/testing';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ButtonExamplesSection } from './ButtonExamplesSection';

function focusedIn(root: Component): Component {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop() as Component;
		if (node.focused) return node;
		stack.push(...node.getChildren());
	}
	throw new Error('nothing focused');
}

describe('ButtonExamplesSection focus-ring demo (DDB-222)', () => {
	it('shows the ring from mount, before any update, so a capture cannot race it', () => {
		const context = createTestContext();
		const section = new ButtonExamplesSection({ width: 1360 });
		section.mount(context);
		const button = focusedIn(section);
		expect(button.focusVisible).toBe(true);
		expect(context.focus.focused).toBe(button);
		section.unmount();
	});

	it('does not scroll its host to itself as it mounts', () => {
		const context = createTestContext();
		const scroller = new ScrollContainer({ x: 0, y: 0, width: 1440, height: 200, contentHeight: 3000 });
		scroller.mount(context);
		scroller.layout();
		scroller.addChild(new ButtonExamplesSection({ y: 2000, width: 1360 }));
		const button = focusedIn(scroller);
		expect(button.focusVisible).toBe(true);
		expect(scroller.scrollPosition).toBe(0);
		// Keyboard focus would have: the scroller is one a reveal moves.
		context.focus.blur();
		context.focus.focus(button, 'keyboard');
		expect(scroller.scrollPosition).toBeGreaterThan(0);
		scroller.unmount();
	});
});
