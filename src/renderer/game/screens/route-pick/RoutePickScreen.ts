import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { RouteDestination, RunRoute, routeStops } from '../../campaign/SupplyRoutes';
import { departRun, getDepartBlocker, quickLoadOut, routesOnOffer } from '../../campaign/SupplyRun';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { departRefusal, riskText, routeCost, stopTitle, yieldText } from '../run/runText';
import { NOT_THE_SAVE } from '../compound/compoundText';

const { space } = tokens;
const TOP_BAR_HEIGHT = 64;
const BACK_WIDTH = 96;

/** What the compound's Plan a supply run hands the route pick: the campaign, as the store saves it. */
export interface RoutePickScreenData {
	campaign: Campaign;
}

export interface RoutePickScreenOptions {
	/** Where the run is saved as it sets off, and the campaign loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
}

/**
 * The MVP supply run's route pick (DDB-454), standing in for the area map
 * and the run route view (DDB-43, DDB-319): today's POIs side by side, each
 * with its routes, their fuel, hours, risk, and stops, and a Take this route
 * button, off with its reason when the stores can't pay the fuel.
 *
 * Taking a route loads out (the quick load out, until load out's screen
 * exists), departs, checkpoints, and opens the run screen. Back and Escape
 * return to the compound. Opened with no campaign, as a capture or the dev
 * navigate hook does, it loads the save as Continue would.
 */
export class RoutePickScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private campaign: Campaign | null = null;
	private dayLine: Text | null = null;
	private destinations: FocusGroup | null = null;
	private status: Text | null = null;
	/** A route is being taken, so another press waits for it. */
	private departing = false;
	private unsubscribe: (() => void) | null = null;
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared }: RoutePickScreenOptions = {}) {
		const root = new Stack({
			id: 'routePickScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('routePickScreen', { root });
		this.stack = root;
		this.store = store;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** Settles once a save loaded on mount has been shown. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		const back = new Button({ label: 'Back', id: 'route_pick_back_button', icon: 'arrow_back', size: 'sm', width: BACK_WIDTH, onClick: () => this.back() });
		this.stack.addChild(this.createTopBar(back));
		this.stack.addChild(new Divider({ id: 'route_pick_top_rule' }));

		const scroll = new ScrollContainer({ id: 'route_pick_scroll', widthMode: 'fill', heightMode: 'fill' });
		const body = new Stack({ id: 'route_pick_body', widthMode: 'fill', crossAlign: 'stretch', padding: space.space_4, gap: space.space_3 });
		this.status = new Text({ id: 'route_pick_status', text: 'Looking for the saved campaign.', widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
		body.addChild(this.status);
		this.destinations = new FocusGroup({
			id: 'route_pick_destinations',
			orientation: 'horizontal',
			direction: 'horizontal',
			widthMode: 'fill',
			crossAlign: 'start',
			gap: space.space_3,
		});
		body.addChild(this.destinations);
		scroll.addChild(body);
		this.stack.addChild(scroll);

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		this.unsubscribe = this.store.onSaveFailed((error) => this.say({ text: error.message, color: 'status_crit' }));
		this.context.focus.focus(back);

		const handed = (data as Partial<RoutePickScreenData> | undefined)?.campaign;
		if (handed) this.show(handed);
		else this.loaded = this.loadSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.rootLayer.hotkeys.unregister('Escape');
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.stack.clearChildren();
		this.campaign = null;
		this.dayLine = null;
		this.destinations = null;
		this.status = null;
		this.departing = false;
	}

	private createTopBar(back: Button): Stack {
		const bar = new Stack({
			id: 'route_pick_top_bar',
			direction: 'horizontal',
			widthMode: 'fill',
			height: TOP_BAR_HEIGHT,
			padding: { left: space.space_4, right: space.space_4 },
			crossAlign: 'center',
			gap: space.space_4,
			style: { backgroundColor: 'bg_panel' },
		});
		bar.addChild(back);
		const heading = new Stack({ id: 'route_pick_heading', crossAlign: 'start' });
		heading.addChild(new Text({
			text: 'Plan a supply run',
			id: 'route_pick_title',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		this.dayLine = new Text({ id: 'route_pick_day', text: '', style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none' });
		heading.addChild(this.dayLine);
		bar.addChild(heading);
		return bar;
	}

	private async loadSave(): Promise<void> {
		const visit = this.visit;
		let campaign: Campaign | null = null;
		let trouble = 'No campaign in progress.';
		try {
			campaign = await this.store.load();
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('RoutePickScreen: loading the save failed', error);
			trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
		}
		if (visit !== this.visit) return;
		if (campaign) this.show(campaign);
		else this.say({ text: trouble, color: 'status_warn' });
	}

	private show(campaign: Campaign): void {
		this.campaign = campaign;
		if (this.dayLine) this.dayLine.text = `Day ${campaign.day} / dawn / Fuel ${campaign.resources.fuel}`;
		this.say({ text: 'Pick a destination and the road there. Fuel is paid when the run sets off.', color: 'text_dim' });
		const destinations = this.destinations;
		if (!destinations) return;
		destinations.clearChildren();
		const routes = routesOnOffer({ campaign });
		if (routes.length === 0) this.say({ text: 'No routes are known yet.', color: 'status_warn' });
		const byDestination = new Map<string, { destination: RouteDestination; routes: RunRoute[] }>();
		for (const route of routes) {
			const entry = byDestination.get(route.destination.id) ?? { destination: route.destination, routes: [] };
			entry.routes.push(route);
			byDestination.set(route.destination.id, entry);
		}
		for (const { destination, routes: offered } of byDestination.values()) {
			const column = new Panel({
				id: `route_pick_${destination.id}`,
				title: destination.name,
				kicker: `Tier ${destination.tier}`,
				compact: true,
				widthMode: 'fill',
				crossAlign: 'stretch',
				gap: space.space_2,
			});
			column.addChild(caption({ id: `route_pick_${destination.id}_yield`, text: `Yields ${yieldText(destination.yield)}`, color: 'text' }));
			offered.forEach((route) => column.addChild(this.routeCard({ campaign, route })));
			destinations.addChild(column);
		}
	}

	/** A route: its name, cost, risk, and stops in order, and the button that takes it, off with its reason when it can't. */
	private routeCard({ campaign, route }: { campaign: Campaign; route: RunRoute }): Stack {
		const card = new Stack({
			id: `route_pick_${route.id}`,
			crossAlign: 'stretch',
			gap: space.space_1,
			padding: space.space_3,
			style: { borderColor: 'line_edge', borderWidth: 'bw', borderRadius: 'r_sm' },
		});
		card.addChild(new Text({ id: `route_pick_${route.id}_name`, text: route.name, widthMode: 'fill', style: { fontRole: 'display', fontSize: 'fs_lg', color: 'text_bright' } }));
		card.addChild(caption({ id: `route_pick_${route.id}_cost`, text: routeCost(route), color: 'text' }));
		card.addChild(caption({ id: `route_pick_${route.id}_risk`, text: riskText(route), color: 'text' }));
		routeStops(route).forEach((stop, index) => card.addChild(caption({ id: `route_pick_${route.id}_stop_${index}`, text: `${index + 1}. ${stopTitle(stop)}` })));
		const blocker = getDepartBlocker({ campaign, route });
		card.addChild(new Button({
			label: 'Take this route',
			id: `route_pick_${route.id}_take`,
			tone: 'accent',
			block: true,
			disabled: blocker !== null,
			margin: { top: space.space_1_5 },
			onClick: () => { void this.take(route); },
		}));
		if (blocker !== null) card.addChild(caption({ id: `route_pick_${route.id}_reason`, text: departRefusal(blocker), color: 'status_warn' }));
		return card;
	}

	/**
	 * Load out, depart, and save, then the run screen, handed the save's
	 * result so it can say a save failed. A load out that can't seat anyone,
	 * or a departure that's refused, says why here, giving up any run decks
	 * it started, and nothing is saved. A save the store has moved on from
	 * stays here, saying nothing more is saved.
	 */
	private async take(route: RunRoute): Promise<void> {
		const campaign = this.campaign;
		if (!campaign || this.departing) return;
		this.departing = true;
		const visit = this.visit;
		try {
			const { escorts } = quickLoadOut({ campaign });
			try {
				departRun({ campaign, route, escorts });
			} catch (error) {
				campaign.unwindRunDecks();
				throw error;
			}
		} catch (error) {
			console.error('RoutePickScreen: the run could not set off', error);
			this.say({ text: error instanceof Error ? error.message : "The run couldn't set off.", color: 'status_crit' });
			this.departing = false;
			return;
		}
		const result = await this.store.checkpoint(campaign);
		if (visit !== this.visit) return;
		if (result === 'retired') {
			this.say({ text: NOT_THE_SAVE, color: 'status_warn' });
			return;
		}
		ScreenManager.navigate('runScreen', { campaign, saved: Promise.resolve(result) });
	}

	private say({ text, color }: { text: string; color: ColorToken }): void {
		if (!this.status) return;
		this.status.text = text;
		this.status.color = color;
	}

	/** To the compound with the campaign, or the menu with none to show. */
	private back(): void {
		if (this.departing) return;
		if (this.campaign) ScreenManager.navigate('compoundScreen', { campaign: this.campaign }, { restoreFocus: true });
		else ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
}
