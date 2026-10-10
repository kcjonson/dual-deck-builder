import type { Text } from '../../engine/components/Text';
import type { Campaign } from '../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../campaign/CampaignStore';
import type { CardLookup } from '../ui/DriverDetailView';

export interface CampaignVisitLoad {
	/** The campaign the opener handed over, shown at once; null loads the save, as Continue would. */
	handed: Campaign | null;
	/** Fetches the cards, started before the save is read, so a screen capture's asset gate sees them in flight. */
	cards: () => Promise<CardLookup>;
	/** The campaign to show, handed over or loaded. */
	show: (campaign: Campaign) => void;
	/** Why there's no campaign to show: no save, or one that couldn't be read, as the store words it. */
	missing: (trouble: string) => void;
	/** The cards, or null when they couldn't be loaded, once the campaign has been shown or found missing. */
	cardsLoaded: (lookup: CardLookup | null) => void;
}

/**
 * One visit to a screen that shows the campaign and changes it, the Crew
 * screen and Customize: what loading the campaign and the cards, saving
 * each step, and saying a save failed take, kept out of the screens so they
 * can't drift apart.
 *
 * A visit starts on mount and stops on unmount, and an answer that arrives
 * after its visit has stopped (a slow save read, the cards, a checkpoint)
 * changes nothing. `checkpoint` saves the step just taken; a save that fails
 * shows the store's message on the screen's line in the critical colour,
 * as the compound's does under Rest, until a later one lands.
 */
export class CampaignVisit {
	private readonly name: string;
	private store: CampaignStore | null = null;
	private saveError: Text | null = null;
	private stopListening: (() => void) | null = null;
	/** Counts starts and stops, so an answer from an earlier visit is told apart. */
	private visit = 0;

	/** `name` heads what the visit logs, the screen's class name. */
	constructor({ name }: { name: string }) {
		this.name = name;
	}

	/** Starts a visit: its steps save to `store`, and a save that fails says so on `saveError`. */
	public start({ store, saveError }: { store: CampaignStore; saveError: Text }): void {
		this.stop();
		this.store = store;
		this.saveError = saveError;
		this.stopListening = store.onSaveFailed((error) => this.showSaveError(error.message));
	}

	/** Ends the visit: nothing still on its way reaches the screen. */
	public stop(): void {
		this.visit += 1;
		this.stopListening?.();
		this.stopListening = null;
		this.store = null;
		this.saveError = null;
	}

	/** The campaign, handed over or loaded, then the cards, each told to the screen unless the visit has stopped. */
	public async load({ handed, cards, show, missing, cardsLoaded }: CampaignVisitLoad): Promise<void> {
		const visit = this.visit;
		const lookup = cards().then(
			(found) => found,
			(error: unknown) => {
				console.error(`${this.name}: loading the cards failed`, error);
				return null;
			},
		);
		if (handed) {
			show(handed);
		} else {
			const found = await this.loadSave();
			if (visit !== this.visit) return;
			if (found.campaign) show(found.campaign);
			else missing(found.trouble);
		}
		const loaded = await lookup;
		if (visit !== this.visit) return;
		cardsLoaded(loaded);
	}

	/** Saves the step just taken. A save that lands clears the line a failed one left. */
	public checkpoint(campaign: Campaign): void {
		const store = this.store;
		if (!store) return;
		const visit = this.visit;
		void store.checkpoint(campaign).then((saved) => {
			if (saved && visit === this.visit && this.saveError) this.saveError.visible = false;
		});
	}

	private async loadSave(): Promise<{ campaign: Campaign; trouble: null } | { campaign: null; trouble: string }> {
		const store = this.store;
		if (!store) return { campaign: null, trouble: 'No campaign in progress.' };
		try {
			const campaign = await store.load();
			return campaign ? { campaign, trouble: null } : { campaign: null, trouble: 'No campaign in progress.' };
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error(`${this.name}: loading the save failed`, error);
			return { campaign: null, trouble: error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read." };
		}
	}

	private showSaveError(message: string): void {
		const line = this.saveError;
		if (!line) return;
		line.text = message;
		line.color = 'status_crit';
		line.visible = true;
	}
}
