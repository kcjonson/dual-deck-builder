/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { Component } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { DeveloperScreen } from './DeveloperScreen';
import { developerSections } from './sections';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

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
		return column.getChildren();
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

	it('shows every section once, in order', () => {
		expect(sections().map((section) => section.id)).toHaveLength(developerSections.length);
	});

	it.each([[1440, 882], [1024, 600]])('lints clean at %ix%i after mounting at 1440x882', (width, height) => {
		resize(width, height);
		expect(lint()).toEqual([]);
	});

	it('lints clean when the window grows back after mounting at 1024x600', () => {
		resize(1024, 600);
		resize(1440, 882);
		expect(lint()).toEqual([]);
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
