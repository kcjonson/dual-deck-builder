import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { CardLoader } from '../../core/CardLoader';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import type { CheckpointResult } from '../../campaign/CampaignStore';
import type { CampaignFight } from '../../campaign/CombatBridge';
import { RunRoute, routeStops } from '../../campaign/SupplyRoutes';
import {
	Arrival, StopFightResult, arriveHome, currentStop, finishStopFight, passQuietStop, rewardOffer, startStopFight, takeReward,
} from '../../campaign/SupplyRun';
import type { SupplyRun } from '../../campaign/SupplyRunState';
import type { Card } from '../../mechanics/Card';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { CardPileView } from '../../ui/CardPileView';
import type { PreparedCombatMount } from '../combat/CombatScreen';
import { NOT_THE_SAVE } from '../compound/compoundText';
import { arrivalSummary, cargoText, failureSummary, skullsText, stopTitle } from './runText';

const { space } = tokens;
const TOP_BAR_HEIGHT = 64;
const BACK_WIDTH = 136;
const ROAD_WIDTH = 320;

type FailedStopFight = Extract<StopFightResult, { outcome: 'run_failed' }>;

/**
 * What opens the run screen: the campaign with its run on the road, from the
 * route pick or Continue, or a run its last fight failed, handed back by the
 * battle result with the route it was on and the checkpoint that saved it.
 */
export interface RunScreenData {
	campaign: Campaign;
	failed?: { result: FailedStopFight; route: RunRoute; stop: number; saved: Promise<CheckpointResult> };
}

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
	| { kind: 'failed'; route: RunRoute; stop: number; result: FailedStopFight; saved: Promise<CheckpointResult> }
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
	private readonly stack: Stack;
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
	private backButton: Button | null = null;
	/** A step is being taken or saved, so another press waits for it. */
	private busy = false;
	/** The store has moved on from this instance, so nothing done here would be saved. */
	private stranded = false;
	private unsubscribe: (() => void) | null = null;
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, cards = loaderCards }: RunScreenOptions = {}) {
		const root = new Stack({
			id: 'runScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('runScreen', { root });
		this.stack = root;
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
		const back = new Button({ label: 'Back to menu', id: 'run_back_button', icon: 'arrow_back', size: 'sm', width: BACK_WIDTH, onClick: () => this.toMenu() });
		this.backButton = back;
		this.stack.addChild(this.createTopBar(back));
		this.stack.addChild(new Divider({ id: 'run_top_rule' }));

		const body = new Stack({
			id: 'run_body',
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			padding: space.space_4,
			gap: space.space_4,
		});
		const roadPanel = new Panel({ id: 'run_road_panel', title: 'The road', compact: true, width: ROAD_WIDTH, heightMode: 'fill', crossAlign: 'stretch', gap: space.space_3 });
		const roadScroll = new ScrollContainer({ id: 'run_road_scroll', widthMode: 'fill', heightMode: 'fill' });
		this.road = new Stack({ id: 'run_road', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_1_5 });
		roadScroll.addChild(this.road);
		roadPanel.addChild(roadScroll);
		this.seats = caption({ id: 'run_seats', text: '' });
		roadPanel.addChild(this.seats);
		body.addChild(roadPanel);

		const side = new Stack({ id: 'run_side', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: space.space_3 });
		this.action = new Stack({ id: 'run_action', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_3 });
		side.addChild(this.action);
		this.report = caption({ id: 'run_report', text: '' });
		this.report.visible = false;
		side.addChild(this.report);
		this.saveError = caption({ id: 'run_save_error', text: '', color: 'status_crit' });
		this.saveError.visible = false;
		side.addChild(this.saveError);
		body.addChild(side);
		this.stack.addChild(body);

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
		this.stack.clearChildren();
		this.campaign = null;
		this.shown = { kind: 'none' };
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
	}

	private createTopBar(back: Button): Stack {
		const bar = new Stack({
			id: 'run_top_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: TOP_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		bar.addChild(back);
		const heading = new Stack({ id: 'run_heading', widthMode: 'fill', crossAlign: 'start' });
		this.title = new Text({
			text: 'Supply run',
			id: 'run_title',
			widthMode: 'fill',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		heading.addChild(this.title);
		this.subtitle = new Text({ id: 'run_subtitle', text: '', widthMode: 'fill', style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
		heading.addChild(this.subtitle);
		bar.addChild(heading);
		this.cargo = new Text({ id: 'run_cargo', text: '', width: 260, style: { fontSize: 'fs_sm', color: 'text', textAlign: 'right' } });
		bar.addChild(this.cargo);
		return bar;
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
		}
		if (shown.kind === 'road') this.showRoad({ route: shown.run.route, at: shown.run.stop, mode: shown.run.phase });
		else if (shown.kind === 'home') this.showRoad({ route: shown.route, at: routeStops(shown.route).length, mode: 'home' });
		else if (shown.kind === 'failed') this.showRoad({ route: shown.route, at: shown.stop, mode: 'failed' });
		else this.road?.clearChildren();
		if (this.seats) {
			this.seats.text = shown.kind === 'road'
				? campaign.runDecks.map(({ driver }) => `${driver.name}, ${driver.hitpoints} of ${driver.maxHitpoints} HP`).join('; ')
				: '';
		}
		const action = this.action;
		if (!action) return;
		action.clearChildren();
		const primary = this.buildAction({ action, campaign, shown });
		if (primary && !this.stranded) this.context.focus.focus(primary);
	}

	/**
	 * The route's stops, each cleared, next, or ahead, and home at the end:
	 * the stop at `at` is next while driving, here at its reward, and where
	 * the run was lost when it failed, and home is reached once it's home.
	 */
	private showRoad({ route, at, mode }: { route: RunRoute; at: number; mode: SupplyRun['phase'] | 'home' | 'failed' }): void {
		const road = this.road;
		if (!road) return;
		road.clearChildren();
		const stops = routeStops(route);
		const atStop: Record<typeof mode, string> = { driving: 'Next', reward: 'Here', failed: 'Lost', home: '' };
		stops.forEach((stop, index) => {
			const state = index < at ? 'Cleared' : index === at ? atStop[mode] : '';
			road.addChild(roadRow({ id: `run_stop_${index}`, label: `${index + 1}. ${stopTitle(stop)}`, state, current: index === at && mode !== 'failed' }));
		});
		const homeState = mode === 'home' ? 'Reached' : at >= stops.length && mode === 'driving' ? 'Next' : '';
		road.addChild(roadRow({ id: 'run_stop_home', label: `Home, from ${route.destination.name}`, state: homeState, current: homeState !== '' }));
	}

	/** The step on offer, with its button; returns the button focus goes to. */
	private buildAction({ action, campaign, shown }: { action: Stack; campaign: Campaign; shown: Shown }): Button | null {
		switch (shown.kind) {
			case 'none': {
				action.addChild(heading({ id: 'run_action_title', text: 'No run is on the road' }));
				return this.addButton({ action, id: 'run_compound_button', label: 'To the compound', onClick: () => this.toCompound() });
			}
			case 'home': {
				action.addChild(heading({ id: 'run_action_title', text: 'Home' }));
				action.addChild(caption({ id: 'run_summary', text: arrivalSummary({ arrival: shown.arrival, route: shown.route }), color: 'text' }));
				if (campaign.isOver) return this.addButton({ action, id: 'run_defeat_button', label: 'Continue', onClick: () => { void this.toDefeat(); } });
				return this.addButton({ action, id: 'run_compound_button', label: 'Back to the compound', onClick: () => this.toCompound() });
			}
			case 'failed': {
				action.addChild(heading({ id: 'run_action_title', text: 'The run failed' }));
				action.addChild(caption({ id: 'run_summary', text: failureSummary(shown.result), color: 'text' }));
				if (campaign.isOver) return this.addButton({ action, id: 'run_defeat_button', label: 'Continue', onClick: () => { void this.toDefeat(); } });
				return this.addButton({ action, id: 'run_compound_button', label: 'Back to the compound', onClick: () => this.toCompound() });
			}
			case 'road':
				return this.buildRoadAction({ action, run: shown.run });
		}
	}

	private buildRoadAction({ action, run }: { action: Stack; run: SupplyRun }): Button | null {
		if (run.phase === 'reward') return this.buildReward({ action });
		const stop = currentStop(run);
		if (stop === null) {
			action.addChild(heading({ id: 'run_action_title', text: 'The road home is clear' }));
			action.addChild(caption({ id: 'run_action_line', text: 'Getting home unloads the cargo and ends the day.' }));
			return this.addButton({ action, id: 'run_home_button', label: 'Head home', onClick: () => { void this.headHome(); } });
		}
		action.addChild(heading({ id: 'run_action_title', text: `Next: ${stopTitle(stop)}` }));
		const line = stop.kind === 'fight'
			? `Raiders hold the road ahead, ${skullsText(stop.skulls)} of danger. Driving on starts the fight.`
			: 'Nothing on this stretch but wind.';
		action.addChild(caption({ id: 'run_action_line', text: line }));
		return this.addButton({ action, id: 'run_drive_button', label: 'Drive on', onClick: () => { void this.driveOn(); } });
	}

	/** A won fight's cards, picked by clicking one, or skipped. */
	private buildReward({ action }: { action: Stack }): Button | null {
		const campaign = this.campaign;
		if (!campaign) return null;
		const cards = this.cards;
		if (!cards) {
			action.addChild(heading({ id: 'run_action_title', text: 'Fight won' }));
			action.addChild(caption({ id: 'run_action_line', text: "The cards couldn't be loaded, so the reward is skipped." }));
			return this.addButton({ action, id: 'run_skip_button', label: 'Drive on', onClick: () => { void this.pick(null); } });
		}
		const offer = rewardOffer({ campaign }).flatMap((type) => {
			const template = cards.get(type);
			return template ? [template.copy()] : [];
		});
		action.addChild(new CardPileView({
			id: 'run_reward',
			title: 'Fight won: pick a card',
			note: 'It rides home as cargo, and reaches the locker if the run gets home.',
			cards: offer,
			onPick: (card) => { void this.pick(card.type); },
		}));
		return this.addButton({ action, id: 'run_skip_button', label: 'Skip the card', onClick: () => { void this.pick(null); } });
	}

	private addButton({ action, id, label, onClick }: { action: Stack; id: string; label: string; onClick: () => void }): Button {
		const button = new Button({ label, id, tone: 'accent', size: 'lg', width: 240, disabled: this.stranded, onClick });
		action.addChild(button);
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
		if (this.busy || this.stranded || !this.cards) return;
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
		if (this.shown.kind === 'road') this.shown = campaign.supplyRun ? { kind: 'road', run: campaign.supplyRun } : { kind: 'none' };
		this.refresh();
		if (report !== null) this.showLine({ line: this.report, text: report, color: 'text_dim' });
		const result = await this.store.checkpoint(campaign);
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
		let result = this.shown.kind === 'failed' ? await this.shown.saved : 'failed';
		if (result !== 'ended') result = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		this.busy = false;
		if (result === 'ended') ScreenManager.navigate('defeatScreen', { campaign });
	}

	private toCompound(): void {
		if (this.busy || !this.campaign) return;
		ScreenManager.navigate('compoundScreen', { campaign: this.campaign });
	}

	private toMenu(): void {
		if (this.busy) return;
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
 * the failed run's report if it failed.
 */
export function stopFightMount({ campaign, fight, store }: { campaign: Campaign; fight: CampaignFight; store: CampaignStore }): PreparedCombatMount {
	const run = campaign.supplyRun;
	return {
		prepare: async () => ({
			battle: fight.battle,
			scrap: fight.scrap,
			fuel: fight.fuel,
			onEnded: ({ won }) => {
				let result: StopFightResult;
				try {
					result = finishStopFight({ campaign, fight });
				} catch (error) {
					console.error('RunScreen: writing the fight back failed', error);
					return { victory: won, next: { screen: 'runScreen', data: { campaign } } };
				}
				const saved = store.checkpoint(campaign);
				if (result.outcome === 'won' || run === null) return { victory: won, next: { screen: 'runScreen', data: { campaign } } };
				const data: RunScreenData = { campaign, failed: { result, route: run.route, stop: run.stop, saved } };
				return { victory: false, next: { screen: 'runScreen', data } };
			},
		}),
	};
}

function heading({ id, text }: { id: string; text: string }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontRole: 'display', fontSize: 'fs_lg', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' } });
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
}

/** A stop on the road list: its name, and Cleared or Next beside it; the next one boxed. */
function roadRow({ id, label, state, current }: { id: string; label: string; state: string; current: boolean }): Stack {
	const row = new Stack({
		id,
		direction: 'horizontal',
		widthMode: 'fill',
		crossAlign: 'center',
		gap: space.space_2,
		padding: { top: space.space_1_5, bottom: space.space_1_5, left: space.space_2, right: space.space_2 },
		style: current ? { borderColor: 'accent', borderWidth: 'bw', borderRadius: 'r_sm' } : { borderColor: 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
	});
	row.addChild(new Text({ id: `${id}_label`, text: label, widthMode: 'fill', style: { fontSize: 'fs_sm', color: state === 'Cleared' ? 'text_dim' : 'text' } }));
	if (state !== '') row.addChild(new Text({ id: `${id}_state`, text: state, style: { fontRole: 'mono', fontSize: 'fs_xs', color: current ? 'accent' : 'text_dim', textTransform: 'uppercase' }, wrap: 'none' }));
	return row;
}
