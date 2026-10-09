/**
 * @jest-environment jsdom
 */
import { createTestContext } from '../../../engine/components/testing';
import type { MountContext } from '../../../engine/components/MountContext';
import { Text } from '../../../engine/components/Text';
import type { Component } from '../../../engine/components/Component';
import type { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { key, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { ScreenManager } from '../../core/ScreenManager';
import { CAMPAIGN_SCHEMA_VERSION } from '../../campaign/Campaign';
import type { CampaignHistoryEntry } from '../../campaign/CampaignHistory';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { KEYS, newCampaign, storeOver } from '../../campaign/__fixtures__/storeFixtures';
import { CampaignHistoryScreen } from './CampaignHistoryScreen';

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const navigate = ScreenManager.navigate as jest.Mock;

const ENTRIES: CampaignHistoryEntry[] = [
	{ seed: 20261006, day: 34, strongholdsTaken: 2, ending: 'starved' },
	{ seed: 77, day: 1, strongholdsTaken: 0, ending: 'abandoned' },
	{ seed: 4000000000, day: 61, strongholdsTaken: 5, ending: 'won' },
];

function historyText(entries: CampaignHistoryEntry[]): string {
	return JSON.stringify({ version: CAMPAIGN_SCHEMA_VERSION, campaigns: entries });
}

describe('CampaignHistoryScreen', () => {
	let context: MountContext;
	let screen: CampaignHistoryScreen;

	async function open(storage: MemorySaveStorage, height = 600): Promise<void> {
		context = createTestContext({ viewport: { logical: { width: 1024, height } }, draw: createMeasuringDrawApi().api });
		screen = new CampaignHistoryScreen({ store: storeOver(storage) });
		screen.mount(context);
		await screen.historyShown;
		context.frame.layout();
	}

	function texts(): string[] {
		const found: string[] = [];
		const walk = (node: Component): void => {
			if (node instanceof Text) found.push(node.text);
			for (const child of node.children) walk(child);
		};
		walk(screen.root);
		return found;
	}

	beforeEach(() => {
		navigate.mockClear();
	});

	afterEach(() => {
		screen.unmount();
	});

	it('lists past campaigns newest first, each with how it ended, its days, strongholds, and seed', async () => {
		await open(new MemorySaveStorage({ items: { [KEYS.history]: historyText(ENTRIES) } }));
		const shown = texts();
		const order = ['Starved', 'Abandoned', 'Won'].map((ending) => shown.indexOf(ending));
		expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]))).toBe(true);
		expect(shown).toEqual(expect.arrayContaining(['34 days', '2 strongholds taken', 'Seed 20261006', '1 day', '0 strongholds taken', '61 days', 'Seed 4000000000']));
		expect(screen.root.findById('history_empty')).toBeNull();
	});

	it("shows a campaign the store has just ended", async () => {
		const storage = new MemorySaveStorage();
		const store = storeOver(storage);
		const campaign = newCampaign();
		await store.save(campaign);
		await store.end({ campaign, ending: 'abandoned' });
		context = createTestContext({ viewport: { logical: { width: 1024, height: 600 } } });
		screen = new CampaignHistoryScreen({ store });
		screen.mount(context);
		await screen.historyShown;
		expect(texts()).toEqual(expect.arrayContaining(['Abandoned', '1 day', '0 strongholds taken']));
	});

	it('says so when no campaign has ended', async () => {
		await open(new MemorySaveStorage());
		expect((screen.root.findById('history_empty') as Text).text).toMatch(/^No campaign has ended yet\./);
	});

	it("shows the store's message for a damaged history", async () => {
		await open(new MemorySaveStorage({ items: { [KEYS.history]: '{"version":1,' } }));
		expect((screen.root.findById('history_trouble') as Text).text).toBe("Campaign history is damaged and can't be shown. It's been kept.");
	});

	it.each(['Enter', 'Escape'])('focuses Back on mount, and %p returns to the menu', async (name) => {
		await open(new MemorySaveStorage());
		expect(context.focus.focused?.id).toBe('history_back_button');
		send(context, [key(name)]);
		expect(navigate).toHaveBeenCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});

	it('scrolls a long history inside the panel, keeping Back on screen, and pages from the keys', async () => {
		const many = Array.from({ length: 40 }, (_, index): CampaignHistoryEntry => ({ seed: index, day: index + 1, strongholdsTaken: 0, ending: 'disbanded' }));
		await open(new MemorySaveStorage({ items: { [KEYS.history]: historyText(many) } }));
		const back = screen.root.findById('history_back_button');
		const scroller = screen.root.findById('history_scroll') as ScrollContainer;
		if (!back) throw new Error('Back should be mounted');
		expect(back.screenBounds.y + back.screenBounds.height).toBeLessThanOrEqual(600);
		expect(scroller.maxScroll).toBeGreaterThan(0);
		send(context, [key('End')]);
		expect(scroller.scrollPosition).toBe(scroller.maxScroll);
		send(context, [key('Home')]);
		expect(scroller.scrollPosition).toBe(0);
	});

	it('hugs a short history rather than filling the screen', async () => {
		await open(new MemorySaveStorage({ items: { [KEYS.history]: historyText(ENTRIES.slice(0, 1)) } }), 882);
		const panel = screen.root.findById('history_panel');
		if (!panel) throw new Error('the panel should be mounted');
		expect(panel.height).toBeLessThan(200);
	});
});
