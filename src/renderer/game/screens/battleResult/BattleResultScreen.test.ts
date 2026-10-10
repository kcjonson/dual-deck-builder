/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
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

	it('logs and builds nothing without result data', () => {
		const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		screen.mount(context);
		expect(logged).toHaveBeenCalledWith('BattleResultScreen: Invalid or missing data');
		expect(screen.root.children).toHaveLength(0);
		logged.mockRestore();
	});
});
