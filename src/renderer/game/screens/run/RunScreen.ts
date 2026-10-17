import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { CardLoader } from '../../core/CardLoader';
import { Campaign, isAtCompound } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import type { CheckpointResult } from '../../campaign/CampaignStore';
import type { CampaignFight } from '../../campaign/CombatBridge';
import { RunRoute, routeStops } from '../../campaign/SupplyRoutes';
import {
	Arrival, StopFightResult, arriveHome, atDestination, cargoText, currentStop, finishStopFight, listText, passQuietStop, rewardOffer, startStopFight, takeReward,
} from '../../campaign/SupplyRun';
import type { SupplyRun } from '../../campaign/SupplyRunState';
import { NO_RESOURCES, RESOURCE_NAMES } from '../../campaign/Campaign';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { poiOf } from '../../campaign/MapRoutes';
import { poiState, sharesLeft } from '../../campaign/PoiStock';
import type { PoiState } from '../../map/PoiData';
import type { Card } from '../../mechanics/Card';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import type { ColorToken } from '../../../engine/theme/tokens';
import { CardPileView } from '../../ui/CardPileView';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { AtlasTag } from '../../ui/atlas/AtlasTag';
import { ATLAS, DISPLAY_BOLD } from '../../ui/atlas/atlasStyle';
import { DamageMark, DamageMarkKind } from '../../ui/atlas/DamageMark';
import { LegendBox, LegendRow, LegendSymbol } from '../../ui/atlas/LegendBox';
import { ResourceStrip } from '../../ui/atlas/ResourceStrip';
import type { PreparedCombatMount } from '../combat/CombatScreen';
import { NOT_THE_SAVE } from '../compound/compoundText';
import { arrivalSummary, crewState, debriefMark, failureSummary, skullsText, stopTitle, yieldText } from './runText';

const BACK_WIDTH = 160;
const ROAD_WIDTH = 320;
const CARGO_WIDTH = 260;
const TITLE_SIZE = 30;
const STEP_WIDTH = 300;
/** The destination's stamp in the head, a step under full size so the head stays one line of boxes tall. */
const STAMP_SCALE = 0.7;
const TAG_WIDTH = 236;

type FailedStopFight = Extract<StopFightResult, { outcome: 'run_failed' }>;

/**
 * What opens the run screen: the campaign with its run on the road, from the
 * run route screen or Continue, or a run its last fight failed, handed back by the
 * battle result with the route and stop it failed at, and the checkpoint of
 * the step that brought it here, if one is still landing.
 */
export interface RunScreenData {
	campaign: Campaign;
	failed?: { result: FailedStopFight; route: RunRoute; stop: number };
	saved?: Promise<CheckpointResult>;
}

/** On the run screen when the step that opened it couldn't be saved. */
export const STEP_NOT_SAVED = "The last step couldn't be saved. The next one tries again.";

export interface RunScreenOptions {
	/** Where each step is saved, and the campaign loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** Card templates by type, for the fights and the reward's faces. Default: the card loader's, loaded if they aren't yet. */
	cards?: () => Promise<ReadonlyMap<string, Card>>;
}

async function loaderCards(): Promise<ReadonlyMap<string, Card>> {
	const loader = CardLoader.getInstance();
	if (!loader.isLoaded()) await loader.loadCards();
	return loader.getAllCardsAsMap();
}

/** How the run stands on screen: on the road, or over, home or failed. */
type Shown =
	| { kind: 'road'; run: SupplyRun }
	| { kind: 'home'; route: RunRoute; arrival: Arrival }
	| { kind: 'failed'; route: RunRoute; stop: number; result: FailedStopFight }
	| { kind: 'none' };

/**
 * The MVP supply run on the road (DDB-454), standing in for the run route
 * view's progress (DDB-319): the route's stops in order, cleared, next, and
 * ahead, the seats' HP and the cargo so far, and beside them the next step.
 * Drive on takes a quiet stretch or opens the fight (the combat screen, whose
 * end writes the fight back and comes back here); a won fight offers its
 * reward, picked or skipped; Head home unloads the run and ends the day, and
 * a one-line summary goes back to the compound. A failed run says what it
 * lost, then the compound, or the defeat screen once nobody is left. Every
 * step checkpoints, so Back to menu and Continue resume where it stands.
 * Opened with no campaign, it loads the save as Continue would.
 */
export class RunScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly store: CampaignStore;
	private readonly loadCards: () => Promise<ReadonlyMap<string, Card>>;
	private cards: ReadonlyMap<string, Card> | null = null;
	private campaign: Campaign | null = null;
	private shown: Shown = { kind: 'none' };
	private title: Text | null = null;
	private subtitle: Text | null = null;
	private cargo: Text | null = null;
	private road: Stack | null = null;
	private seats: Text | null = null;
	private action: Stack | null = null;
	private report: Text | null = null;
	private saveError: Text | null = null;
	private backButton: AtlasButton | null = null;
	/** The head's stamp: the destination's state on the debrief, LOST on a failed run. */
	private stamp: DamageMark | null = null;
	/** A step is being taken or saved, so another press waits for it. */
	private busy = false;
	/** The store has moved on from this instance, so nothing done here would be saved. */
	private stranded = false;
	/** The last checkpoint, the opener's or a step's, which the defeat screen waits on. */
	private lastSave: Promise<CheckpointResult> | null = null;
	private unsubscribe: (() => void) | null = null;
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, cards = loaderCards }: RunScreenOptions = {}) {
		const root = new AtlasSheet({
			id: 'runScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			gap: 14,
			contentInset: 16,
			paper: 'a',
		});
		super('runScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.store = store;
		this.loadCards = cards;
	}

	/** The campaign on show, once there is one. */
	public get campaignShown(): Campaign | null {
		return this.campaign;
	}

	/** Settles once the save and the cards loaded on mount have been shown. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		const back = new AtlasButton({ label: 'Back to menu', id: 'run_back_button', width: BACK_WIDTH, onClick: () => this.toMenu() });
		this.backButton = back;
		this.sheet.addChild(this.createTopBar(back));

		const body = new Stack({
			id: 'run_body',
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			gap: 16,
		});
		const roadPanel = new LegendBox({ id: 'run_road_panel', title: 'The road', width: ROAD_WIDTH, heightMode: 'fill', crossAlign: 'stretch', gap: 12 });
		const roadScroll = new ScrollContainer({ id: 'run_road_scroll', widthMode: 'fill', heightMode: 'fill' });
		this.road = new Stack({ id: 'run_road', widthMode: 'fill', crossAlign: 'stretch', gap: 10 });
		roadScroll.addChild(this.road);
		roadPanel.addChild(roadScroll);
		this.seats = caption({ id: 'run_seats', text: '' });
		roadPanel.addChild(this.seats);
		body.addChild(roadPanel);

		const side = new Stack({ id: 'run_side', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: 12 });
		this.action = new Stack({ id: 'run_action', widthMode: 'fill', crossAlign: 'stretch', gap: 12 });
		side.addChild(this.action);
		this.report = caption({ id: 'run_report', text: '' });
		this.report.visible = false;
		side.addChild(this.report);
		this.saveError = caption({ id: 'run_save_error', text: '', color: 'status_crit' });
		this.saveError.visible = false;
		side.addChild(this.saveError);
		body.addChild(side);
		this.sheet.addChild(body);

		this.rootLayer.hotkeys.register('Escape', () => this.toMenu());
		this.unsubscribe = this.store.onSaveFailed((error) => this.showLine({ line: this.saveError, text: error.message, color: 'status_crit' }));
		this.context.focus.focus(back);

		const given = data as Partial<RunScreenData> | undefined;
		const cards = this.loadCards().then(
			(found) => found,
			(error: unknown) => {
				console.error('RunScreen: loading the cards failed', error);
				return null;
			},
		);
		this.loaded = this.open({ given, cards });
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.rootLayer.hotkeys.unregister('Escape');
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.sheet.clearChildren();
		this.sheet.wear = 2;
		this.campaign = null;
		this.shown = { kind: 'none' };
		this.stamp = null;
		this.title = null;
		this.subtitle = null;
		this.cargo = null;
		this.road = null;
		this.seats = null;
		this.action = null;
		this.report = null;
		this.saveError = null;
		this.backButton = null;
		this.busy = false;
		this.stranded = false;
		this.lastSave = null;
	}

	/** The head: the title and the day over it, the stamp once the run is over, the cargo while it's out, and Back to menu. */
	private createTopBar(back: AtlasButton): Stack {
		const bar = new Stack({ id: 'run_top_bar', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: 16 });
		const heading = new Stack({ id: 'run_heading', widthMode: 'fill', crossAlign: 'start', gap: 2 });
		this.title = new Text({
			text: 'Supply run',
			id: 'run_title',
			widthMode: 'fill',
			style: { fontRole: DISPLAY_BOLD, fontWeight: 700, fontSize: TITLE_SIZE, color: 'text', textTransform: 'uppercase', letterSpacing: ATLAS.headTracking },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		heading.addChild(this.title);
		this.subtitle = new Text({ id: 'run_subtitle', text: '', widthMode: 'fill', style: { fontRole: 'mono', fontSize: 13, color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
		heading.addChild(this.subtitle);
		bar.addChild(heading);
		this.stamp = new DamageMark({ id: 'run_stamp', kind: 'looted', scale: STAMP_SCALE, visible: false });
		bar.addChild(this.stamp);
		this.cargo = new Text({ id: 'run_cargo', text: '', width: CARGO_WIDTH, style: { fontSize: 14, color: 'text', textAlign: 'right' } });
		bar.addChild(this.cargo);
		bar.addChild(back);
		return bar;
	}

	/**
	 * The run's damage, at most one hero mark (UI Art Direction, Wear): a
	 * failed run burns the sheet and is stamped LOST; home, the destination
	 * is stamped DEPLETED or LOOTED, unless an injured driver's tear takes
	 * the place (`debriefMark`). On the road nothing is damaged yet.
	 */
	private markDamage(mark: DamageMarkKind | null): void {
		this.sheet.wear = this.shown.kind === 'failed' ? 3 : 2;
		const stamp = this.stamp;
		if (!stamp) return;
		stamp.visible = mark !== null && mark !== 'tear';
		if (mark !== null && mark !== 'tear') stamp.kind = mark;
	}

	/** The destination's state on the campaign's map now, or null for a destination off the map's POIs. */
	private destinationState(route: RunRoute): PoiState | null {
		const poi = poiOf(route.destination.id);
		const campaign = this.campaign;
		if (poi === null || !campaign) return null;
		return poiState(sharesLeft({ map: campaign.map, poi }));
	}

	/** The campaign handed over or loaded, then the cards, then the run as it stands. */
	private async open({ given, cards }: { given: Partial<RunScreenData> | undefined; cards: Promise<ReadonlyMap<string, Card> | null> }): Promise<void> {
		const visit = this.visit;
		let campaign = given?.campaign ?? null;
		let trouble = 'No campaign in progress.';
		if (!campaign) {
			try {
				campaign = await this.store.load();
			} catch (error) {
				if (!(error instanceof CampaignStoreError)) console.error('RunScreen: loading the save failed', error);
				trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
			}
		}
		const loadedCards = await cards;
		if (visit !== this.visit) return;
		this.cards = loadedCards;
		if (!campaign) {
			this.showLine({ line: this.report, text: trouble, color: 'status_warn' });
			return;
		}
		this.campaign = campaign;
		const failed = given?.failed;
		if (failed) this.shown = { kind: 'failed', ...failed };
		else this.shown = campaign.supplyRun ? { kind: 'road', run: campaign.supplyRun } : { kind: 'none' };
		this.refresh();
		const saved = given?.saved;
		if (saved) {
			this.lastSave = saved;
			const result = await saved;
			if (visit === this.visit) this.afterOpenerSave({ campaign, result });
		}
	}

	/**
	 * The opener's checkpoint, which landed before this screen could hear
	 * why a save failed: says so, and strands the screen once the store has
	 * moved on from this instance.
	 */
	private afterOpenerSave({ campaign, result }: { campaign: Campaign; result: CheckpointResult }): void {
		if (result === 'failed') this.showLine({ line: this.saveError, text: STEP_NOT_SAVED, color: 'status_crit' });
		else if (result === 'retired' || (result === 'ended' && !campaign.isOver)) this.strand();
	}

	/** Everything that reads the run, again, and focus on its next step. */
	private refresh(): void {
		const shown = this.shown;
		const campaign = this.campaign;
		if (!campaign) return;
		const route = shown.kind === 'road' ? shown.run.route : shown.kind === 'none' ? null : shown.route;
		if (this.title) this.title.text = route ? `Run to ${route.destination.name}` : 'Supply run';
		const standing = shown.kind === 'road' ? 'on the road' : shown.kind;
		if (this.subtitle) this.subtitle.text = route ? `Day ${campaign.day} / ${standing} / ${route.name}` : `Day ${campaign.day}`;
		if (this.cargo) {
			const carried = shown.kind === 'road' ? cargoText({ cargo: shown.run.cargo, cards: shown.run.cargoCards }) : null;
			this.cargo.text = shown.kind === 'road' ? `Cargo: ${carried ?? 'nothing yet'}` : '';
			this.cargo.visible = shown.kind === 'road';
		}
		if (shown.kind === 'road') this.showRoad({ route: shown.run.route, at: shown.run.stop, mode: shown.run.phase });
		else if (shown.kind === 'home') this.showRoad({ route: shown.route, at: routeStops(shown.route).length, mode: 'home' });
		else if (shown.kind === 'failed') this.showRoad({ route: shown.route, at: shown.stop, mode: 'failed' });
		else this.road?.clearChildren();
		if (this.seats) {
			this.seats.text = shown.kind === 'road'
				? campaign.runDecks.map(({ driver }) => `${driver.name}, ${driver.hitpoints} of ${driver.maxHitpoints} HP`).join('; ')
				: '';
			this.seats.visible = shown.kind === 'road';
		}
		const mark = shown.kind === 'home'
			? debriefMark({ destination: this.destinationState(shown.route), injured: injuredOf(shown.arrival).length > 0 })
			: shown.kind === 'failed' ? 'lost' : null;
		this.markDamage(mark);
		const action = this.action;
		if (!action) return;
		action.clearChildren();
		const primary = this.buildAction({ action, campaign, shown, torn: mark === 'tear' });
		if (primary && !this.stranded) this.context.focus.focus(primary);
	}

	/**
	 * The route's stops, each cleared, next, or ahead, and home at the end:
	 * the stop at `at` is next while driving, here at its reward, and where
	 * the run was lost when it failed, and home is reached once it's home.
	 * Each leads with its map symbol: a fight still ahead is hostile, a
	 * quiet stretch pending, a cleared stop nothing to report, home the star.
	 */
	private showRoad({ route, at, mode }: { route: RunRoute; at: number; mode: SupplyRun['phase'] | 'home' | 'failed' }): void {
		const road = this.road;
		if (!road) return;
		road.clearChildren();
		const stops = routeStops(route);
		const atStop: Record<typeof mode, string> = { driving: 'Next', reward: 'Here', failed: 'Lost', home: '' };
		stops.forEach((stop, index) => {
			const state = index < at ? 'Cleared' : index === at ? atStop[mode] : '';
			const symbol: LegendSymbol = state === 'Cleared' ? 'dash' : stop.kind === 'fight' ? 'diamond' : 'ring';
			road.addChild(roadRow({ id: `run_stop_${index}`, label: `${index + 1}. ${stopTitle(stop)}`, state, symbol }));
		});
		const homeState = mode === 'home' ? 'Reached' : at >= stops.length && mode === 'driving' ? 'Next' : '';
		road.addChild(roadRow({ id: 'run_stop_home', label: `Home, from ${route.destination.name}`, state: homeState, symbol: 'star' }));
	}

	/** The step on offer in its box, with its button, and the debrief's ledgers; returns the button focus goes to. */
	private buildAction({ action, campaign, shown, torn }: { action: Stack; campaign: Campaign; shown: Shown; torn: boolean }): AtlasButton | null {
		switch (shown.kind) {
			case 'none': {
				const box = stepBox(action);
				box.addChild(heading({ id: 'run_action_title', text: 'No run is on the road' }));
				return this.addButton({ box, id: 'run_compound_button', label: 'To the compound', onClick: () => this.toCompound() });
			}
			case 'home': {
				const box = stepBox(action);
				box.addChild(heading({ id: 'run_action_title', text: 'Home' }));
				box.addChild(caption({ id: 'run_summary', text: arrivalSummary({ arrival: shown.arrival, route: shown.route }), color: 'text' }));
				const button = campaign.isOver
					? this.addButton({ box, id: 'run_defeat_button', label: 'Continue', onClick: () => { void this.toDefeat(); } })
					: this.addButton({ box, id: 'run_compound_button', label: 'Back to the compound', onClick: () => this.toCompound() });
				action.addChild(debriefLedgers({ arrival: shown.arrival, torn }));
				return button;
			}
			case 'failed': {
				const box = stepBox(action);
				box.addChild(heading({ id: 'run_action_title', text: 'The run failed' }));
				box.addChild(caption({ id: 'run_summary', text: failureSummary(shown.result), color: 'text' }));
				const button = campaign.isOver
					? this.addButton({ box, id: 'run_defeat_button', label: 'Continue', onClick: () => { void this.toDefeat(); } })
					: this.addButton({ box, id: 'run_compound_button', label: 'Back to the compound', onClick: () => this.toCompound() });
				action.addChild(lossLedger(shown.result));
				return button;
			}
			case 'road':
				return this.buildRoadAction({ action, run: shown.run });
		}
	}

	private buildRoadAction({ action, run }: { action: Stack; run: SupplyRun }): AtlasButton | null {
		if (run.phase === 'reward') return this.buildReward({ action });
		const box = stepBox(action);
		const stop = currentStop(run);
		if (stop === null) {
			const { name, yield: yields } = run.route.destination;
			box.addChild(heading({ id: 'run_action_title', text: `${name} reached` }));
			const loaded = yieldText(yields);
			const line = loaded === 'nothing'
				? 'Nothing was left here to load. The road home is clear, and getting home ends the day.'
				: `Loaded ${loaded}. The road home is clear, and getting home unloads the cargo and ends the day.`;
			box.addChild(caption({ id: 'run_action_line', text: line }));
			return this.addButton({ box, id: 'run_home_button', label: 'Head home', onClick: () => { void this.headHome(); } });
		}
		box.addChild(heading({ id: 'run_action_title', text: `Next: ${stopTitle(stop)}` }));
		const line = stop.kind === 'fight'
			? `Raiders hold the road ahead, ${skullsText(stop.skulls)} of danger. Driving on starts the fight.`
			: 'Nothing on this stretch but wind.';
		box.addChild(caption({ id: 'run_action_line', text: line }));
		return this.addButton({ box, id: 'run_drive_button', label: 'Drive on', onClick: () => { void this.driveOn(); } });
	}

	/**
	 * A won fight's cards, picked by clicking one, or skipped. With no cards
	 * loaded the reward waits, saved, rather than being lost: the cards can
	 * be loaded again here, or by Continue. Picking a card is the step, so
	 * Skip is the back road.
	 */
	private buildReward({ action }: { action: Stack }): AtlasButton | null {
		const campaign = this.campaign;
		if (!campaign) return null;
		const box = stepBox(action);
		const cards = this.cards;
		if (!cards) {
			box.addChild(heading({ id: 'run_action_title', text: 'Fight won' }));
			box.addChild(caption({ id: 'run_action_line', text: "The cards couldn't be loaded, so the reward waits for them." }));
			return this.addButton({ box, id: 'run_cards_button', label: 'Load the cards again', onClick: () => { void this.reloadCards(); } });
		}
		const offer = rewardOffer({ campaign }).flatMap((type) => {
			const template = cards.get(type);
			return template ? [template.copy()] : [];
		});
		box.addChild(new CardPileView({
			id: 'run_reward',
			title: 'Fight won: pick a card',
			note: 'It rides home as cargo, and reaches the locker if the run gets home.',
			cards: offer,
			ink: 'theme',
			onPick: (card) => { void this.pick(card.type); },
		}));
		return this.addButton({ box, id: 'run_skip_button', label: 'Skip the card', variant: 'backRoad', onClick: () => { void this.pick(null); } });
	}

	/** The step's button: the highway, the screen's one primary, or the back road for a step that passes something up. */
	private addButton({ box, id, label, variant = 'highway', onClick }: { box: Stack; id: string; label: string; variant?: 'highway' | 'backRoad'; onClick: () => void }): AtlasButton {
		const highway = variant === 'highway';
		const button = new AtlasButton({
			label,
			id,
			variant,
			shield: highway,
			labelSize: highway ? 24 : undefined,
			height: highway ? 56 : undefined,
			width: highway ? STEP_WIDTH : 200,
			margin: { top: 4 },
			disabled: this.stranded,
			onClick,
		});
		box.addChild(button);
		return button;
	}

	/** The next stop: a quiet stretch passes and saves; a fight opens on the combat screen. */
	private async driveOn(): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.shown.kind !== 'road') return;
		const stop = currentStop(this.shown.run);
		if (stop?.kind === 'quiet') {
			await this.step(() => passQuietStop({ campaign }), 'The road was quiet.');
			return;
		}
		if (this.busy || this.stranded) return;
		if (!this.cards) {
			this.showLine({ line: this.report, text: "The cards couldn't be loaded, so the fight can't start.", color: 'status_crit' });
			return;
		}
		this.busy = true;
		let fight: CampaignFight;
		try {
			fight = startStopFight({ campaign, cards: this.cards });
		} catch (error) {
			console.error('RunScreen: the fight could not start', error);
			this.showLine({ line: this.report, text: "The fight couldn't start.", color: 'status_crit' });
			this.busy = false;
			return;
		}
		ScreenManager.navigate('combatScreen', stopFightMount({ campaign, fight, store: this.store }));
	}

	private async pick(cardType: string | null): Promise<void> {
		const campaign = this.campaign;
		if (!campaign) return;
		await this.step(() => takeReward({ campaign, cardType }), cardType === null ? 'Left the cards.' : 'The card is in the cargo.');
	}

	/** The cards loaded again after a failure, then the run shown with them. */
	private async reloadCards(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const visit = this.visit;
		let cards: ReadonlyMap<string, Card> | null = null;
		try {
			cards = await this.loadCards();
		} catch (error) {
			console.error('RunScreen: loading the cards failed', error);
		}
		if (visit !== this.visit) return;
		this.busy = false;
		this.cards = cards;
		this.refresh();
		if (!cards) this.showLine({ line: this.report, text: "The cards still couldn't be loaded.", color: 'status_crit' });
	}

	private async headHome(): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.shown.kind !== 'road' || this.busy || this.stranded) return;
		const route = this.shown.run.route;
		let arrival: Arrival;
		try {
			arrival = arriveHome({ campaign });
		} catch (error) {
			console.error('RunScreen: getting home failed', error);
			this.showLine({ line: this.report, text: "The run couldn't get home.", color: 'status_crit' });
			return;
		}
		this.shown = { kind: 'home', route, arrival };
		await this.step(() => undefined, null);
	}

	/**
	 * A step: `change` changes the campaign, the screen shows the run as it
	 * stands, and the step is saved before another can start. A checkpoint
	 * that finds the store has moved on strands the screen.
	 */
	private async step(change: () => void, report: string | null): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.busy || this.stranded) return;
		this.busy = true;
		const visit = this.visit;
		try {
			change();
		} catch (error) {
			console.error('RunScreen: the step failed', error);
			this.showLine({ line: this.report, text: "That couldn't be done.", color: 'status_crit' });
			this.busy = false;
			return;
		}
		const before = this.shown.kind === 'road' ? this.shown.run : null;
		if (this.shown.kind === 'road') this.shown = campaign.supplyRun ? { kind: 'road', run: campaign.supplyRun } : { kind: 'none' };
		this.refresh();
		// The last step's report goes with it
		const after = this.shown.kind === 'road' ? this.shown.run : null;
		const reached = before !== null && after !== null && !atDestination(before) && atDestination(after);
		const said = reached && after ? `${report ?? ''} Reached ${after.route.destination.name}.`.trim() : report;
		if (said !== null) this.showLine({ line: this.report, text: said, color: 'text_dim' });
		else if (this.report) this.report.visible = false;
		const saving = this.store.checkpoint(campaign);
		this.lastSave = saving;
		const result = await saving;
		if (visit !== this.visit) return;
		this.busy = false;
		if (result === 'retired' || (result === 'ended' && !campaign.isOver)) this.strand();
	}

	private strand(): void {
		this.stranded = true;
		this.refresh();
		this.showLine({ line: this.saveError, text: NOT_THE_SAVE, color: 'status_warn' });
		if (this.backButton) this.context.focus.focus(this.backButton);
	}

	/** The defeat screen, once the lost campaign's end is in the history. */
	private async toDefeat(): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.busy) return;
		this.busy = true;
		const visit = this.visit;
		// The step that lost it saved it, which ends it in the store; a save that failed is tried again
		let result: CheckpointResult = this.lastSave ? await this.lastSave : 'failed';
		if (result !== 'ended') result = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		this.busy = false;
		if (result === 'ended') ScreenManager.navigate('defeatScreen', { campaign });
	}

	private toCompound(): void {
		if (this.busy || !this.campaign) return;
		ScreenManager.navigate('compoundScreen', { campaign: this.campaign });
	}

	/**
	 * To the menu, or, once the campaign is lost, to the defeat screen, which
	 * nothing skips. A stranded screen's loss was never saved, since the save
	 * had moved on (another tab saved over it or ended it), so it goes to the
	 * menu: its defeat would wait on a checkpoint that's refused every time.
	 */
	private toMenu(): void {
		if (this.busy) return;
		if (this.campaign?.isOver && !this.stranded) {
			void this.toDefeat();
			return;
		}
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}

	private showLine({ line, text, color }: { line: Text | null; text: string; color: ColorToken }): void {
		if (!line) return;
		line.text = text;
		line.color = color;
		line.visible = true;
	}
}

/**
 * A stop's fight as the combat screen mounts it, with its end hook: the
 * fight is written back and the step saved as it ends, whatever screen is
 * up, then the battle result's Continue comes back to the run screen, with
 * the failed run's report if it failed, and the checkpoint. The combat
 * menu can abandon the run, which ends the fight lost (`abandonWarning`).
 */
export function stopFightMount({ campaign, fight, store }: { campaign: Campaign; fight: CampaignFight; store: CampaignStore }): PreparedCombatMount {
	const run = campaign.supplyRun;
	return {
		prepare: async () => ({
			battle: fight.battle,
			scrap: fight.scrap,
			fuel: fight.fuel,
			abandonWarning: abandonWarning({ campaign, fight }),
			onEnded: ({ won }) => {
				let result: StopFightResult;
				try {
					result = finishStopFight({ campaign, fight });
				} catch (error) {
					console.error('RunScreen: writing the fight back failed', error);
					return { victory: won, next: { screen: 'runScreen', data: { campaign } } };
				}
				const saved = store.checkpoint(campaign);
				if (result.outcome === 'won' || run === null) return { victory: won, next: { screen: 'runScreen', data: { campaign, saved } } };
				const data: RunScreenData = { campaign, failed: { result, route: run.route, stop: run.stop }, saved };
				return { victory: false, next: { screen: 'runScreen', data } };
			},
		}),
	};
}

/** What abandoning a run's fight costs, as the combat menu's confirm says it. */
/** Who flees and what's lost; and, when they're the last drivers the compound has, that the campaign ends with them. */
function abandonWarning({ campaign, fight }: { campaign: Campaign; fight: CampaignFight }): string {
	const seats = fight.party.seats;
	const names = seats.map(seat => seat.name);
	const flee = names.length === 1 ? 'flees and goes' : 'flee and go';
	const last = !campaign.drivers.some(driver => !seats.includes(driver) && isAtCompound(driver));
	if (last) return `${listText(names)} ${flee} missing, and the run's cargo and the escorts that came along are lost. Nobody is left to drive, so the campaign ends.`;
	return `${listText(names)} ${flee} missing, the run's cargo and the escorts that came along are lost, and the day ends.`;
}

function heading({ id, text }: { id: string; text: string }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontRole: DISPLAY_BOLD, fontWeight: 700, fontSize: 22, color: 'text', textTransform: 'uppercase', letterSpacing: ATLAS.headTracking } });
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 14, color } });
}

/** The step in hand, on fresh paper: the thing in focus (UI Art Direction, Wear: W0). */
function stepBox(action: Stack): LegendBox {
	const box = new LegendBox({ id: 'run_step', fresh: true, widthMode: 'fill', crossAlign: 'stretch', gap: 10 });
	action.addChild(box);
	return box;
}

/** A stop on the road list: its map symbol, its name, and Cleared, Next, or Here at the right in mono. */
function roadRow({ id, label, state, symbol }: { id: string; label: string; state: string; symbol: LegendSymbol }): LegendRow {
	return new LegendRow({
		id,
		text: label,
		symbol,
		faint: state === 'Cleared',
		textId: `${id}_label`,
		value: state === '' ? undefined : state,
		valueId: `${id}_state`,
	});
}

/** The drivers who came home injured after the night. */
function injuredOf(arrival: Arrival): readonly DriverRecord[] {
	return arrival.injuries.filter(({ driver }) => driver.status === 'injured').map(({ driver }) => driver);
}

/**
 * The debrief's ledgers (Game Flow 6.1), each a legend box: what was
 * unloaded into the stores, with the cards and anyone found, and the crew
 * who drove, a tag each. With `torn`, the first injured driver's tag
 * carries the screen's hero mark, a tear.
 */
function debriefLedgers({ arrival, torn }: { arrival: Arrival; torn: boolean }): Stack {
	const row = new Stack({ id: 'run_debrief', direction: 'horizontal', widthMode: 'fill', crossAlign: 'stretch', gap: 12 });
	const unloaded = new LegendBox({ id: 'run_unloaded', title: 'Unloaded', widthMode: 'fill', crossAlign: 'stretch' });
	const { resources, cards, found } = arrival.cargo;
	const stores = RESOURCE_NAMES.filter((name) => resources[name] > 0).map((name) => ({ kind: name, value: resources[name] }));
	if (stores.length > 0) unloaded.addChild(new ResourceStrip({ id: 'run_unloaded_stores', items: stores, widthMode: 'fill' }));
	const carded = cargoText({ cargo: NO_RESOURCES, cards });
	if (carded) unloaded.addChild(new LegendRow({ id: 'run_unloaded_cards', text: `To the locker: ${carded}`, symbol: 'ring' }));
	if (found.length > 0) unloaded.addChild(new LegendRow({ id: 'run_unloaded_found', text: `${listText(found.map((driver) => driver.name))} found`, symbol: 'ring' }));
	if (stores.length === 0 && !carded && found.length === 0) unloaded.addChild(new LegendRow({ id: 'run_unloaded_none', text: 'Nothing to unload', symbol: 'dash' }));
	row.addChild(unloaded);

	const crew = new LegendBox({ id: 'run_crew', title: 'The crew', width: TAG_WIDTH + ATLAS.legendPadding * 2, crossAlign: 'stretch' });
	const tags = new Stack({ id: 'run_crew_tags', gap: 8 });
	const injured = injuredOf(arrival);
	arrival.seats.forEach((driver, index) => {
		tags.addChild(new AtlasTag({
			id: `run_crew_${index}`,
			label: driver.name,
			caption: crewState(driver),
			warn: injured.includes(driver),
			torn: torn && driver === injured[0],
			width: TAG_WIDTH,
			labelId: `run_crew_${index}_name`,
			captionId: `run_crew_${index}_state`,
		}));
	});
	crew.addChild(tags);
	row.addChild(crew);
	return row;
}

/** What a failed run lost, in a legend box: the dead and the missing, hostile; the cargo and escorts after. */
function lossLedger(result: FailedStopFight): LegendBox {
	const { dead, missing, cargoLost, cargoCardsLost, escortsLost } = result.fight;
	const box = new LegendBox({ id: 'run_lost', title: 'Lost with the run', widthMode: 'fill', crossAlign: 'stretch' });
	dead.forEach((driver, index) => box.addChild(new LegendRow({ id: `run_lost_dead_${index}`, text: driver.name, value: 'Dead', symbol: 'diamond' })));
	missing.forEach((driver, index) => box.addChild(new LegendRow({ id: `run_lost_missing_${index}`, text: driver.name, value: 'Missing', symbol: 'diamond' })));
	const cargo = cargoText({ cargo: cargoLost, cards: cargoCardsLost });
	if (cargo) box.addChild(new LegendRow({ id: 'run_lost_cargo', text: `Cargo: ${cargo}`, symbol: 'dash', faint: false }));
	if (escortsLost.length > 0) box.addChild(new LegendRow({ id: 'run_lost_escorts', text: `Escorts: ${listText(escortsLost.map((escort) => escort.name))}`, symbol: 'dash', faint: false }));
	return box;
}
