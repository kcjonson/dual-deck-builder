/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { key, send } from '../../../engine/services/testing';
import { Text } from '../../../engine/components/Text';
import type { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ScreenManager } from '../../core/ScreenManager';
import { CreditsScreen } from './CreditsScreen';
import { CREDITS } from './credits';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

describe('CreditsScreen', () => {
	let context: MountContext;
	let screen: CreditsScreen;

	function scroller(): ScrollContainer {
		const found = screen.root.findById('credits_scroll');
		if (!found) throw new Error('the scroll container should be mounted');
		return found as ScrollContainer;
	}

	beforeEach(() => {
		navigate.mockClear();
		context = createTestContext({ viewport: { logical: { width: 1024, height: 600 } } });
		screen = new CreditsScreen();
		screen.mount(context);
		context.frame.layout();
	});

	afterEach(() => {
		screen.unmount();
	});

	it('lists every credit inside the scroll container', () => {
		const list = scroller().content;
		if (!list) throw new Error('the list should be mounted');
		const texts: string[] = [];
		const walk = (node: typeof list): void => {
			if (node instanceof Text) texts.push(node.text);
			for (const child of node.children) walk(child);
		};
		walk(list);
		for (const section of CREDITS) {
			expect(texts).toContain(section.heading);
			for (const entry of section.entries) expect(texts).toEqual(expect.arrayContaining([entry.name, ...entry.lines]));
		}
	});

	it.each(['Enter', 'Escape'])('focuses Back on mount, and %p returns to the menu', (name) => {
		expect(context.focus.focused?.id).toBe('credits_back_button');
		send(context, [key(name)]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('keeps the panel between the title and Back inside a 1024 by 600 viewport', () => {
		const panel = screen.root.findById('credits_panel');
		const back = screen.root.findById('credits_back_button');
		if (!panel || !back) throw new Error('the panel and Back should be mounted');
		expect(panel.x).toBe((1024 - panel.width) / 2);
		expect(back.y + back.height).toBeLessThanOrEqual(600);
		expect(panel.y + panel.height).toBeLessThanOrEqual(back.y);
	});

	it('scrolls the list from Back with Page Down, Page Up, Home, and End', () => {
		const list = scroller();
		list.scrollHeight = list.height * 3;
		context.frame.layout();
		send(context, [key('PageDown')]);
		const page = list.scrollPosition;
		expect(page).toBeGreaterThan(0);
		send(context, [key('End')]);
		expect(list.scrollPosition).toBe(list.maxScroll);
		send(context, [key('PageUp')]);
		expect(list.scrollPosition).toBe(list.maxScroll - page);
		send(context, [key('Home')]);
		expect(list.scrollPosition).toBe(0);
		expect(context.focus.focused?.id).toBe('credits_back_button');
	});

	it('pages the same distance whether Back or the list has focus', () => {
		const list = scroller();
		list.scrollHeight = list.height * 3;
		context.frame.layout();
		send(context, [key('PageDown')]);
		const fromBack = list.scrollPosition;
		list.scrollToTop();
		context.focus.focus(list);
		send(context, [key('PageDown')]);
		expect(list.scrollPosition).toBe(fromBack);
		send(context, [key('PageUp')]);
		expect(list.scrollPosition).toBe(0);
	});

	it('releases its keys on unmount', () => {
		screen.unmount();
		expect(screen.root.ownHotkeys?.size).toBe(0);
		screen.mount(context);
	});
});
