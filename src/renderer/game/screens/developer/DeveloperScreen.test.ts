/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { Component } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { key, send } from '../../../engine/services/testing';
import type { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ScreenManager } from '../../core/ScreenManager';
import { DeveloperScreen } from './DeveloperScreen';
import { developerSections } from './sections';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

/**
 * DDB-235: the sections are laid out by stacks, so a resize after mount
 * reflows them through layout with nothing rebuilt, and the screen stays at
 * lint zero at both gate sizes whichever it was mounted at.
 */
describe('DeveloperScreen', () => {
	const viewport = { width: 1440, height: 882 };
	let context: MountContext;
	let screen: DeveloperScreen;

	function resize(width: number, height: number): void {
		viewport.width = width;
		viewport.height = height;
		context.frame.viewportChanged();
		context.frame.layout();
	}

	function lint(): unknown[] {
		return layoutLint(treeSnapshot([screen.root], { ...viewport })).violations;
	}

	function sections(): Component[] {
		const column = screen.root.findById('dev_sections');
		if (!column) throw new Error('the section column should be mounted');
		return column.children;
	}

	beforeEach(() => {
		viewport.width = 1440;
		viewport.height = 882;
		context = createTestContext({
			draw: createMeasuringDrawApi().api,
			viewport: { get logical() { return { ...viewport }; } },
		});
		screen = new DeveloperScreen();
		screen.mount(context);
		context.frame.layout();
	});

	afterEach(() => {
		screen.unmount();
	});

	it('shows every section once', () => {
		const ids = sections().map((section) => section.id);
		expect(ids).toHaveLength(developerSections.length);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each([[1440, 882], [1024, 600]])('lints clean at %ix%i after mounting at 1440x882', (width, height) => {
		resize(width, height);
		expect(lint()).toEqual([]);
	});

	it('lints clean after resizing to 1024x600 and back to 1440x882', () => {
		resize(1024, 600);
		resize(1440, 882);
		expect(lint()).toEqual([]);
	});

	// A frame's 1 px border has a radius, which the draw layer does not snap
	// (R7.8), so a fractional edge would blur across two pixel rows.
	it.each([[1440, 882], [1024, 600]])('puts every section frame on whole pixels at %ix%i', (width, height) => {
		resize(width, height);
		for (const section of sections()) {
			const { y, height: frameHeight } = section.screenBounds;
			expect(Number.isInteger(y)).toBe(true);
			expect(Number.isInteger(frameHeight)).toBe(true);
		}
	});

	it('returns to the menu with focus restored from Escape and Back', () => {
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
		navigate.mockClear();
		// Focus starts on Back
		expect(context.focus.focused?.id).toBe('dev_back_button');
		send(context, [key('Enter')]);
		expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('pages the section column with Page Down and Page Up', () => {
		const scroller = screen.root.findById('dev_scroll') as ScrollContainer;
		const pageBy = jest.spyOn(scroller, 'scrollByPages');
		send(context, [key('PageDown')]);
		expect(pageBy).toHaveBeenLastCalledWith(1);
		expect(scroller.scrollPosition).toBeGreaterThan(0);
		send(context, [key('PageUp')]);
		expect(pageBy).toHaveBeenLastCalledWith(-1);
		expect(scroller.scrollPosition).toBe(0);
	});

	it('reflows the same sections to the column width on resize', () => {
		const before = sections();
		const wide = before.map((section) => section.width);
		resize(1024, 600);
		const after = sections();
		expect(after).toEqual(before);
		const column = screen.root.findById('dev_sections') as Component;
		for (const [index, section] of after.entries()) {
			expect(section.width).toBeLessThan(wide[index]);
			expect(section.x + section.width).toBeLessThanOrEqual(column.width);
		}
	});
});
