/**
 * @jest-environment jsdom
 */
import type { Button } from '../../../engine/ui/Button';
import { ScreenManager } from '../../core/ScreenManager';
import type { CustomizeScreenData } from '../customize/CustomizeScreen';
import { CustomizeLauncherSection } from './CustomizeLauncherSection';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn(), activeScreen: null },
}));

const navigate = ScreenManager.navigate as jest.Mock;
const manager = ScreenManager as unknown as { activeScreen: unknown };

describe('CustomizeLauncherSection', () => {
	function button(seat: number): Button {
		const found = new CustomizeLauncherSection().findById(`dev_customize_seat_${seat}`);
		if (!found) throw new Error(`no button for seat ${seat}`);
		return found as Button;
	}

	beforeEach(() => {
		navigate.mockClear();
		manager.activeScreen = {};
	});

	it("opens Customize on each seat of the test campaign's run, saving into memory, Done coming back to the developer screen", () => {
		for (const seat of [1, 2]) {
			button(seat).onClick?.({} as never);
			const [screen, data] = navigate.mock.calls[navigate.mock.calls.length - 1] as [string, CustomizeScreenData];
			expect(screen).toBe('customizeScreen');
			expect(data.driver).toBe(data.campaign.runDecks[seat - 1].driver);
			expect(data.returnTo).toBe('developerScreen');
			expect(data.store).toBeDefined();
		}
		const [, first] = navigate.mock.calls[0] as [string, CustomizeScreenData];
		const [, second] = navigate.mock.calls[1] as [string, CustomizeScreenData];
		expect(second.campaign).not.toBe(first.campaign);
	});

	it('does nothing in the gallery, where no screen is mounted to navigate from', () => {
		manager.activeScreen = null;
		button(1).onClick?.({} as never);
		expect(navigate).not.toHaveBeenCalled();
	});
});
