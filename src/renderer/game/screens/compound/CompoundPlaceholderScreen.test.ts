/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Text } from '../../../engine/components/Text';
import { key, send } from '../../../engine/services/testing';
import { ScreenManager } from '../../core/ScreenManager';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { damagedText, fixtureText, newCampaign, storageWith, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import { CompoundPlaceholderScreen } from './CompoundPlaceholderScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

/** One macrotask turn, so the store's calls have run. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('CompoundPlaceholderScreen', () => {
	let context: MountContext;
	let screen: CompoundPlaceholderScreen;

	function text(id: string): string {
		return (screen.root.findById(id) as Text | null)?.text ?? '';
	}

	beforeEach(() => {
		navigate.mockClear();
		context = createTestContext({ viewport: { logical: { width: 1024, height: 600 } } });
	});

	afterEach(() => {
		screen.unmount();
	});

	it('shows the campaign it is handed, and Back or Escape return to the menu with focus restored', () => {
		const campaign = newCampaign();
		screen = new CompoundPlaceholderScreen({ store: storeOver(new MemorySaveStorage()) });
		screen.mount(context, { campaign });
		expect(text('compound_summary')).toBe('Day 1 - 2 drivers - 0 strongholds taken');
		expect(text('compound_stores')).toBe('Food 0  Water 0  Fuel 0  Meds 0  Scrap 0  People 0');
		expect(screen.root.findById('compound_note')?.visible).toBe(true);
		expect(context.focus.focused?.id).toBe('compound_back_button');
		send(context, [key('Escape')]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
		navigate.mockClear();
		send(context, [key('Enter')]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('loads the save when opened with no campaign, as Continue would', async () => {
		screen = new CompoundPlaceholderScreen({ store: storeOver(storageWith(fixtureText())) });
		screen.mount(context);
		await settled();
		expect(text('compound_summary')).toBe('Day 9 - 3 drivers - 1 stronghold taken');
	});

	it('says what is wrong when there is no save to load, or it is damaged', async () => {
		screen = new CompoundPlaceholderScreen({ store: storeOver(new MemorySaveStorage()) });
		screen.mount(context);
		await settled();
		expect(text('compound_summary')).toBe('No campaign in progress.');
		expect(screen.root.findById('compound_note')?.visible).toBe(false);
		screen.unmount();

		screen = new CompoundPlaceholderScreen({ store: storeOver(storageWith(damagedText())) });
		screen.mount(context);
		await settled();
		expect(text('compound_summary')).toBe("The saved campaign is damaged and can't be loaded. It's been kept.");
	});
});
