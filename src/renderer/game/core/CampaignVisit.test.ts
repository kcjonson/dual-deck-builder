import { Text } from '../../engine/components/Text';
import { tokens } from '../../engine/theme/tokens';
import type { Campaign } from '../campaign/Campaign';
import type { CampaignStore, CheckpointResult } from '../campaign/CampaignStore';
import { MemorySaveStorage } from '../campaign/SaveStorage';
import { FaultyStorage, atHomeCampaign, damagedText, fixtureText, lostCampaign, quotaError, settle, storageWith, storeOver } from '../campaign/__fixtures__/storeFixtures';
import type { CardLookup } from '../ui/DriverDetailView';
import { lookup } from '../ui/testing';
import { CampaignVisit } from './CampaignVisit';

/** What a load told the screen, in order. */
type Heard = ['show', Campaign] | ['missing', string] | ['cards', CardLookup | null];

describe('CampaignVisit', () => {
	let visit: CampaignVisit;
	let line: Text;
	let heard: Heard[];

	function load({ handed = null, cards = async () => lookup }: { handed?: Campaign | null; cards?: () => Promise<CardLookup> } = {}): Promise<void> {
		return visit.load({
			handed,
			cards,
			show: (campaign) => heard.push(['show', campaign]),
			missing: (trouble) => heard.push(['missing', trouble]),
			cardsLoaded: (found) => heard.push(['cards', found]),
		});
	}

	beforeEach(() => {
		visit = new CampaignVisit({ name: 'TestScreen' });
		line = new Text({ id: 'save_error', visible: false });
		heard = [];
	});

	it('shows a campaign handed over at once, then hands over the cards', async () => {
		visit.start({ store: storeOver(new MemorySaveStorage()), saveError: line });
		const campaign = atHomeCampaign();
		await load({ handed: campaign });
		expect(heard).toEqual([['show', campaign], ['cards', lookup]]);
	});

	it('loads the save as Continue would, or says why there is none', async () => {
		visit.start({ store: storeOver(storageWith(fixtureText())), saveError: line });
		await load();
		expect(heard.map(([what]) => what)).toEqual(['show', 'cards']);
		expect((heard[0][1] as Campaign).day).toBe(9);

		heard = [];
		visit.start({ store: storeOver(new MemorySaveStorage()), saveError: line });
		await load();
		expect(heard).toEqual([['missing', 'No campaign in progress.'], ['cards', lookup]]);

		heard = [];
		visit.start({ store: storeOver(storageWith(damagedText())), saveError: line });
		await load();
		expect(heard[0]).toEqual(['missing', "The saved campaign is damaged and can't be loaded. It's been kept."]);
	});

	it('hands over no cards when they fail to load, and logs why', async () => {
		const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		visit.start({ store: storeOver(new MemorySaveStorage()), saveError: line });
		await load({ handed: atHomeCampaign(), cards: () => Promise.reject(new Error('offline')) });
		expect(heard[1]).toEqual(['cards', null]);
		expect(quiet).toHaveBeenCalledWith('TestScreen: loading the cards failed', expect.any(Error));
		quiet.mockRestore();
	});

	it('tells the screen nothing that arrives after the visit has stopped', async () => {
		visit.start({ store: storeOver(storageWith(fixtureText())), saveError: line });
		let release: (cards: CardLookup) => void = () => undefined;
		const loading = load({ cards: () => new Promise((resolve) => { release = resolve; }) });
		visit.stop();
		release(lookup);
		await loading;
		expect(heard).toEqual([]);
	});

	it('says a failed save on the line in the critical colour, clears it once one lands, and stops listening when the visit stops', async () => {
		const storage = new FaultyStorage();
		const store = storeOver(storage);
		const campaign = atHomeCampaign();
		visit.start({ store, saveError: line });
		storage.fault = { method: 'setItem', error: quotaError() };
		visit.checkpoint(campaign);
		await settle();
		await settle();
		expect([line.visible, line.text]).toEqual([true, "The campaign couldn't be saved: storage is full."]);
		expect(line.color).toEqual(tokens.color.status_crit);

		storage.fault = null;
		campaign.addLogEntry({ message: 'Another day.' });
		visit.checkpoint(campaign);
		await settle();
		await settle();
		expect(line.visible).toBe(false);

		visit.stop();
		storage.fault = { method: 'setItem', error: quotaError() };
		const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		await store.checkpoint(campaign);
		quiet.mockRestore();
		expect(line.visible).toBe(false);
	});

	/** The visit's checkpoint, and how the store says it went once it has. */
	async function checkpointed(store: CampaignStore, campaign: Campaign): Promise<CheckpointResult> {
		const spy = jest.spyOn(store, 'checkpoint');
		visit.checkpoint(campaign);
		const result = await (spy.mock.results[0].value as Promise<CheckpointResult>);
		spy.mockRestore();
		await settle();
		return result;
	}

	it('keeps the line through a failed save once the checkpoint has settled, a failure being no landing', async () => {
		const storage = new FaultyStorage();
		const store = storeOver(storage);
		visit.start({ store, saveError: line });
		storage.fault = { method: 'setItem', error: quotaError() };
		expect(await checkpointed(store, atHomeCampaign())).toBe('failed');
		expect(line.visible).toBe(true);
	});

	it('leaves the line as it is when a checkpoint ends a campaign that is over, or the store has moved on from it', async () => {
		const store = storeOver(new FaultyStorage());
		visit.start({ store, saveError: line });
		line.text = 'An earlier failure.';
		line.visible = true;
		expect(await checkpointed(store, lostCampaign({ ending: 'rioted', cause: 'last_driver' }))).toBe('ended');
		expect(line.visible).toBe(true);

		const campaign = atHomeCampaign();
		await store.save(campaign);
		await store.load();
		expect(await checkpointed(store, campaign)).toBe('retired');
		expect(line.visible).toBe(true);
	});
});
