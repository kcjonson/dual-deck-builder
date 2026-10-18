/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { createTestContext } from '../../../engine/components/testing';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { treeSnapshot } from '../../../engine/debug/treeSnapshot';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import type { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import type { DamageMark } from '../../ui/atlas/DamageMark';
import type { MountContext } from '../../../engine/components/MountContext';
import { key, send } from '../../../engine/services/testing';
import type { Text } from '../../../engine/components/Text';
import { ScreenManager } from '../../core/ScreenManager';
import { BattleResultData, BattleResultScreen } from './BattleResultScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

function result(victory: boolean): BattleResultData {
	return { victory };
}

describe('BattleResultScreen', () => {
	let context: MountContext;
	let screen: BattleResultScreen;

	beforeEach(() => {
		navigate.mockClear();
		context = createTestContext({ viewport: { logical: { width: 1024, height: 600 } } });
		screen = new BattleResultScreen();
	});

	afterEach(() => {
		screen.unmount();
	});

	it('shows the outcome in a panel centred in the viewport', () => {
		screen.mount(context, result(true));
		context.frame.layout();
		const panel = screen.root.findById('result_panel');
		if (!panel) throw new Error('the panel should be mounted');
		expect(panel.x).toBe((1024 - panel.width) / 2);
		expect(panel.y).toBe((600 - panel.height) / 2);
		expect((screen.root.findById('result_title') as Text).text).toBe('VICTORY!');
	});

	it('says defeat on a loss', () => {
		screen.mount(context, result(false));
		expect((screen.root.findById('result_title') as Text).text).toBe('DEFEAT!');
		expect((screen.root.findById('result_subtitle') as Text).text).toBe('Your vehicles have been destroyed!');
	});

	it('says a broken-off fight was broken off, neither won nor lost, with no defeat stamp', () => {
		screen.mount(context, { victory: false, brokenOff: true });
		expect((screen.root.findById('result_kicker') as Text).text).toBe('Fight broken off');
		expect((screen.root.findById('result_title') as Text).text).toBe('BROKEN OFF');
		expect((screen.root.findById('result_subtitle') as Text).text).toBe('The raiders broke off. Nothing won, nothing lost.');
		expect(screen.root.findById('result_stamp')).toBeNull();
	});

	it('shows the line the fight sent in place of the stock one, so a fight given up says so (DDB-454)', () => {
		screen.mount(context, { victory: false, subtitle: 'The crew abandoned the fight.' });
		expect((screen.root.findById('result_title') as Text).text).toBe('DEFEAT!');
		expect((screen.root.findById('result_subtitle') as Text).text).toBe('The crew abandoned the fight.');
	});

	it.each(['Enter', 'Escape'])('focuses Continue on mount, and %p goes back to the menu, focus back on what opened the fight', (name) => {
		screen.mount(context, result(true));
		expect(context.focus.focused?.id).toBe('result_continue_button');
		send(context, [key(name)]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it.each(['Enter', 'Escape'])('continues where the fight said to go, a supply run\'s fight back to its run, on %p (DDB-454)', (name) => {
		const data = { from: 'the fight' };
		screen.mount(context, { victory: false, next: { screen: 'runScreen', data } });
		send(context, [key(name)]);
		expect(navigate).toHaveBeenCalledWith('runScreen', data);
	});

	it('keeps a win on the W2 sheet, and stamps a loss LOST over the box, its one hero mark, still on W2 (DDB-511)', () => {
		screen.mount(context, result(true));
		const sheet = screen.root as AtlasSheet;
		expect([sheet.wear, screen.root.findById('result_stamp')]).toEqual([2, null]);
		screen.unmount();
		screen.mount(context, result(false));
		context.frame.layout();
		const stamp = screen.root.findById('result_stamp') as DamageMark;
		const panel = screen.root.findById('result_panel');
		expect([sheet.wear, stamp.kind]).toEqual([2, 'lost']);
		expect(stamp.y + stamp.height).toBeLessThanOrEqual(panel?.y ?? 0);
	});

	it.each([{ width: 1440, height: 882 }, { width: 1024, height: 600 }].flatMap((size) => [true, false].map((victory) => ({ ...size, victory }))))(
		'lays out with no lint at $width x $height, victory $victory, measured in the real faces',
		({ width, height, victory }) => {
			context = createTestContext({ viewport: { logical: { width, height } }, clock: new Clock(), draw: createMeasuringDrawApi().api });
			screen.mount(context, { victory, subtitle: 'The crew abandoned the fight, and every vehicle that could still roll fled the road.' });
			context.frame.layout();
			expect(layoutLint(treeSnapshot([screen.root], { width, height })).violations).toEqual([]);
		},
	);

	it('logs and builds nothing without result data', () => {
		const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		screen.mount(context);
		expect(logged).toHaveBeenCalledWith('BattleResultScreen: Invalid or missing data');
		expect(screen.root.children).toHaveLength(0);
		logged.mockRestore();
	});
});
