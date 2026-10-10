import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { routeId } from '../../campaign/MapRoutes';
import type { RunRoute } from '../../campaign/SupplyRoutes';
import { DepartBlocker, departRun, getDepartBlocker, getPlanBlocker, quickLoadOut, routesOnOffer } from '../../campaign/SupplyRun';
import type { RouteDescriptor } from '../../map/RouteDescriptors';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { AreaMapView } from '../../ui/areaMap/AreaMapView';
import { RouteCard } from '../../ui/RouteCard';
import { STRONGHOLD_NOT_YET, QUIET_STOPS, clockText, homeByText, poiKindText, poiYieldText, routeDetail, stopTag, stopText } from '../area-map/areaMapText';
import { PlannedPoi, PlanningMap, PlanningMaps, mapRoutes, plannedPois, routesBounds, viewData } from '../area-map/planningMap';
import { NOT_THE_SAVE } from '../compound/compoundText';
import { mapProgressText } from '../main-menu/campaignText';
import { departRefusal, planRefusal } from '../run/runText';

const { space } = tokens;
const SIDE_WIDTH = 360;
const BACK_WIDTH = 96;
/** World units round the compound, the POI, and its routes, past the camera's own fit margin. */
const FRAME_MARGIN = 60;
/**
 * The least world the frame spans each way, so a POI near the compound
 * isn't drawn so close that the baked land shows its texels.
 */
const MIN_FRAME = 800;
/** A stop's tag holds the longest, CHECKPOINT, so the rows' text lines up. */
const TAG_WIDTH = 92;

/** What Plan a run here hands the run route screen: the campaign, and the POI by its index in the map's POI layer. */
export interface RunRouteScreenData {
	campaign: Campaign;
	poi: number;
}

export interface RunRouteScreenOptions {
	/** Where the run is saved as it sets off, and the campaign loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** Where the campaign's map comes from. Default: the session's (`PlanningMaps.shared`). */
	maps?: PlanningMaps;
}

/**
 * The run route screen (Compound and Supply Runs, The run route screen;
 * Game Flow 3.4; DDB-319): the area map cropped to the compound, one POI,
 * and its two or three routes, drawn as bands under the roads, and beside
 * it a card for each route from its descriptor (name, knowledge, stops,
 * hours out, fuel, risk). Picking a card highlights its route and its stops
 * on the map, and lists the stops in order with the time it'd be home
 * against dark. A route past dark warns and can still go; one the stores
 * can't fuel is dimmed with the reason, and Load out the crew is off while
 * it's picked.
 *
 * Load out the crew is the quick load out until load out's screen exists
 * (DDB-320): it seats the crew, departs on the route against the same map
 * the cards came from, checkpoints, and opens the run screen. Back and
 * Escape return to the area map with the POI still chosen. Opened with no
 * campaign it loads the save as Continue would. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/area-map-route-pick.md.
 */
export class RunRouteScreen extends Screen {
	private readonly stack: Stack;
	private readonly store: CampaignStore;
	private readonly maps: PlanningMaps;
	private campaign: Campaign | null = null;
	private map: PlanningMap | null = null;
	private poiIndex = -1;
	private poi: PlannedPoi | null = null;
	private picked = -1;
	private view: AreaMapView | null = null;
	private nameLine: Text | null = null;
	private dayLine: Text | null = null;
	private kindLine: Text | null = null;
	private yieldLine: Text | null = null;
	private status: Text | null = null;
	private cards: FocusGroup | null = null;
	private stopsList: Stack | null = null;
	private homeLine: Text | null = null;
	private loadOutButton: Button | null = null;
	private loadOutReason: Text | null = null;
	/** The run is setting off, so another press waits for it. */
	private departing = false;
	private unsubscribe: (() => void) | null = null;
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, maps = PlanningMaps.shared }: RunRouteScreenOptions = {}) {
		const root = new Stack({
			id: 'runRouteScreen',
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('runRouteScreen', { root });
		this.stack = root;
		this.store = store;
		this.maps = maps;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** The POI the routes go to, once its map is in. */
	public get destination(): PlannedPoi | null {
		return this.poi;
	}

	/** The picked route's place among the POI's routes, quickest first; -1 before there are any. */
	public get pickedRoute(): number {
		return this.picked;
	}

	/** Settles once the save loaded on mount, and then its map, have been shown, or failed to. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		this.view = new AreaMapView({ id: 'run_route_view', widthMode: 'fill', heightMode: 'fill' });
		this.stack.addChild(this.view);
		const back = new Button({ label: 'Back', id: 'run_route_back_button', icon: 'arrow_back', size: 'sm', width: BACK_WIDTH, onClick: () => this.back() });
		this.stack.addChild(this.createSide(back));

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		this.unsubscribe = this.store.onSaveFailed((error) => this.say({ text: error.message, color: 'status_crit' }));
		this.context.focus.focus(back);

		const handed = data as Partial<RunRouteScreenData> | undefined;
		this.poiIndex = typeof handed?.poi === 'number' ? handed.poi : -1;
		if (handed?.campaign) this.loaded = this.show(handed.campaign);
		else this.loaded = this.loadSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.rootLayer.hotkeys.unregister('Escape');
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.stack.clearChildren();
		this.campaign = null;
		this.map = null;
		this.poiIndex = -1;
		this.poi = null;
		this.picked = -1;
		this.view = null;
		this.nameLine = null;
		this.dayLine = null;
		this.kindLine = null;
		this.yieldLine = null;
		this.status = null;
		this.cards = null;
		this.stopsList = null;
		this.homeLine = null;
		this.loadOutButton = null;
		this.loadOutReason = null;
		this.departing = false;
	}

	/** Back and the heading, the POI, the status line, the route cards and the picked route's stops, and Load out the crew at the foot. */
	private createSide(back: Button): Stack {
		const side = new Stack({
			id: 'run_route_side',
			width: SIDE_WIDTH,
			heightMode: 'fill',
			crossAlign: 'stretch',
			padding: space.space_4,
			gap: space.space_3,
			style: { backgroundColor: 'bg_panel' },
		});
		const head = new Stack({ id: 'run_route_head', direction: 'horizontal', crossAlign: 'center', gap: space.space_3 });
		head.addChild(back);
		const heading = new Stack({ id: 'run_route_heading', widthMode: 'fill', crossAlign: 'stretch' });
		heading.addChild(kicker({ id: 'run_route_kicker', text: 'Run route to' }));
		this.nameLine = new Text({
			id: 'run_route_name',
			text: '',
			widthMode: 'fill',
			style: { fontRole: 'display', fontSize: 'fs_lg', color: 'text_bright' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		heading.addChild(this.nameLine);
		head.addChild(heading);
		side.addChild(head);

		this.dayLine = new Text({ id: 'run_route_day', text: '', style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text_dim' }, wrap: 'none' });
		side.addChild(this.dayLine);
		this.kindLine = caption({ id: 'run_route_kind', text: '', color: 'text' });
		side.addChild(this.kindLine);
		this.yieldLine = caption({ id: 'run_route_yield', text: '', color: 'text' });
		side.addChild(this.yieldLine);
		this.status = caption({ id: 'run_route_status', text: 'Looking for the saved campaign.' });
		side.addChild(this.status);

		const scroll = new ScrollContainer({ id: 'run_route_scroll', widthMode: 'fill', heightMode: 'fill' });
		const body = new Stack({ id: 'run_route_body', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_2 });
		body.addChild(kicker({ id: 'run_route_routes_kicker', text: 'Routes' }));
		this.cards = new FocusGroup({
			id: 'run_route_cards',
			selection: 'single',
			widthMode: 'fill',
			crossAlign: 'stretch',
			gap: space.space_1_5,
			onSelect: (selected) => {
				const index = this.cards?.selectableMembers.indexOf(selected[0]) ?? -1;
				if (index >= 0) this.pick(index);
			},
		});
		body.addChild(this.cards);
		body.addChild(kicker({ id: 'run_route_stops_kicker', text: 'Stops in order' }));
		this.stopsList = new Stack({ id: 'run_route_stops', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_1 });
		body.addChild(this.stopsList);
		body.addChild(caption({ id: 'run_route_quiet_note', text: QUIET_STOPS }));
		scroll.addChild(body);
		side.addChild(scroll);

		this.homeLine = new Text({ id: 'run_route_home_by', text: '', widthMode: 'fill', style: { fontSize: 'fs_sm', fontWeight: 'bold', color: 'text' } });
		side.addChild(this.homeLine);
		this.loadOutButton = new Button({
			label: 'Load out the crew',
			id: 'run_route_load_out_button',
			tone: 'accent',
			size: 'lg',
			block: true,
			disabled: true,
			onClick: () => { void this.loadOut(); },
		});
		side.addChild(this.loadOutButton);
		this.loadOutReason = caption({ id: 'run_route_load_out_reason', text: '', color: 'status_warn' });
		this.loadOutReason.visible = false;
		side.addChild(this.loadOutReason);
		return side;
	}

	private async loadSave(): Promise<void> {
		const visit = this.visit;
		let campaign: Campaign | null = null;
		let trouble = 'No campaign in progress.';
		try {
			campaign = await this.store.load();
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('RunRouteScreen: loading the save failed', error);
			trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
		}
		if (visit !== this.visit) return;
		if (campaign) await this.show(campaign);
		else this.say({ text: trouble, color: 'status_warn' });
	}

	/** The campaign, then its map, at once when it's been made this session, or once it has, saying how far that's got. */
	private async show(campaign: Campaign): Promise<void> {
		this.campaign = campaign;
		const known = this.maps.known(campaign);
		if (known) {
			this.showMap(known);
			return;
		}
		const visit = this.visit;
		this.say({ text: 'Making the area map.', color: 'text_dim' });
		let map: PlanningMap;
		try {
			map = await this.maps.load(campaign, {
				onProgress: (progress) => {
					if (visit === this.visit) this.say({ text: mapProgressText(progress), color: 'text_dim' });
				},
			});
		} catch (error) {
			if (visit !== this.visit) return;
			console.error('RunRouteScreen: the area map could not be made', error);
			this.say({ text: `The area map couldn't be made. ${error instanceof Error ? error.message : ''}`.trim(), color: 'status_crit' });
			return;
		}
		if (visit !== this.visit) return;
		this.showMap(map);
	}

	/**
	 * The POI and its routes: the view framed on them, a card per route,
	 * and the first route the stores can fuel picked, or the quickest when
	 * none can be. A POI the map doesn't have, a stronghold, or one with no
	 * route says so and offers only Back.
	 */
	private showMap(map: PlanningMap): void {
		const campaign = this.campaign;
		if (!campaign) return;
		this.map = map;
		const poi = plannedPois(map)[this.poiIndex] ?? null;
		const trouble = poi === null ? "That destination isn't on the area map." : poi.stronghold ? STRONGHOLD_NOT_YET : poi.routes.length === 0 ? 'No road reaches it.' : null;
		if (poi === null || trouble !== null) {
			this.say({ text: trouble ?? '', color: 'status_warn' });
			return;
		}
		this.poi = poi;
		const dark = poi.routes[0].dark;
		if (this.nameLine) this.nameLine.text = poi.name;
		if (this.dayLine) this.dayLine.text = `Day ${campaign.day} / dawn ${clockText(dark - map.params.daylightHours)} / dark ${clockText(dark)} / fuel ${campaign.resources.fuel}`;
		if (this.kindLine) this.kindLine.text = poiKindText(poi);
		const destination = this.runRoute(poi.routes[0])?.destination ?? null;
		if (this.yieldLine) this.yieldLine.text = poiYieldText({ stronghold: false, yields: destination?.yield ?? null });
		this.say({ text: 'Pick a route. Fuel is paid when the run sets off, and the run comes home down the road it took.', color: 'text_dim' });

		const view = this.view;
		if (view) {
			view.map = viewData(map);
			view.markers = [{ id: poi.id, kind: 'poi', x: poi.x, y: poi.y, label: poi.name, badge: String(poi.tier), pastDark: poi.pastDark }];
			view.selection = { kind: 'marker', id: poi.id };
			view.camera.fit(frameOf(routesBounds(map, poi)));
		}
		const cards = this.cards;
		if (cards) {
			cards.clearChildren();
			poi.routes.forEach((route) => {
				const blocker = this.departBlocker(route);
				cards.addChild(new RouteCard({
					id: `run_route_card_${route.route}`,
					title: route.name,
					detail: routeDetail(route),
					note: blocker !== null ? departRefusal(blocker) : route.spare < 0 ? 'Back after dark.' : null,
					dim: blocker !== null,
				}));
			});
		}
		const first = poi.routes.findIndex((route) => this.departBlocker(route) === null);
		this.pick(first >= 0 ? first : 0);
	}

	/**
	 * Picks a route: its card, its band and stops on the map, its stops in
	 * order, the time it'd be home against dark, and whether Load out can go.
	 */
	private pick(index: number): void {
		const { map, poi } = this;
		if (!map || !poi || !poi.routes[index]) return;
		this.picked = index;
		const route = poi.routes[index];
		const card = this.cards?.selectableMembers[index];
		if (card && !card.selected) this.cards?.select([card]);
		if (this.view) this.view.routes = mapRoutes(map, poi.routes, index);

		const list = this.stopsList;
		if (list) {
			list.clearChildren();
			route.stops.forEach((stop, place) => list.addChild(stopRow({ id: `run_route_stop_${place}`, tag: stopTag(stop), text: stopText(stop) })));
			if (route.stops.length === 0) list.addChild(caption({ id: 'run_route_stop_none', text: 'No stops: a clear road all the way.' }));
		}
		if (this.homeLine) {
			this.homeLine.text = homeByText(route);
			this.homeLine.color = route.spare < 0 ? 'status_warn' : 'text';
		}
		const reason = this.loadOutBlocked(route);
		if (this.loadOutButton) this.loadOutButton.enabled = reason === null && !this.departing;
		if (this.loadOutReason) {
			this.loadOutReason.text = reason ?? '';
			this.loadOutReason.visible = reason !== null;
		}
	}

	/** The run loop's route for a descriptor: the one `departRun` will check it against. */
	private runRoute(route: RouteDescriptor): RunRoute | null {
		const { map } = this;
		if (!map) return null;
		const id = routeId(route.poi, route.route);
		return routesOnOffer({ map }).find((offered) => offered.id === id) ?? null;
	}

	private departBlocker(route: RouteDescriptor): DepartBlocker | null {
		const { campaign } = this;
		const offered = this.runRoute(route);
		return campaign && offered ? getDepartBlocker({ campaign, route: offered }) : null;
	}

	/** Why the picked route can't set off: nobody can go, or the route itself can't (`getDepartBlocker`); null when it can, past dark or not. */
	private loadOutBlocked(route: RouteDescriptor): string | null {
		const { campaign, map } = this;
		if (!campaign || !map) return null;
		const plan = getPlanBlocker({ campaign, map });
		if (plan !== null && plan.reason !== 'too_little_fuel') return planRefusal(plan);
		const blocker = this.departBlocker(route);
		return blocker === null ? null : departRefusal(blocker);
	}

	/**
	 * The quick load out, then the departure on the picked route against
	 * this map, and the checkpoint, then the run screen, handed the save's
	 * result so it can say a save failed. A load out that can't seat anyone,
	 * or a departure that's refused, says why here, giving up any run decks
	 * it started, and nothing is saved. A save the store has moved on from
	 * stays here, saying nothing more is saved.
	 */
	private async loadOut(): Promise<void> {
		const { campaign, map, poi } = this;
		const route = poi?.routes[this.picked];
		const offered = route ? this.runRoute(route) : null;
		if (!campaign || !map || !offered || this.departing || (route && this.loadOutBlocked(route) !== null)) return;
		this.departing = true;
		if (this.loadOutButton) this.loadOutButton.enabled = false;
		const visit = this.visit;
		try {
			const { escorts } = quickLoadOut({ campaign });
			try {
				departRun({ campaign, map, route: offered, escorts });
			} catch (error) {
				campaign.unwindRunDecks();
				throw error;
			}
		} catch (error) {
			console.error('RunRouteScreen: the run could not set off', error);
			this.say({ text: error instanceof Error ? error.message : "The run couldn't set off.", color: 'status_crit' });
			this.departing = false;
			this.pick(this.picked);
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

	/** To the area map with this POI still chosen, or the menu with no campaign to show. */
	private back(): void {
		if (this.departing) return;
		if (this.campaign) ScreenManager.navigate('areaMapScreen', { campaign: this.campaign, poi: this.poiIndex }, { restoreFocus: true });
		else ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/** The world rect the view frames: the routes' bounds with a margin, at least `MIN_FRAME` each way about their middle. */
function frameOf(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
	const width = Math.max(bounds.width + FRAME_MARGIN * 2, MIN_FRAME);
	const height = Math.max(bounds.height + FRAME_MARGIN * 2, MIN_FRAME);
	return { x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y + bounds.height / 2 - height / 2, width, height };
}

/** A stop in order: its tag, boxed, and what it is. */
function stopRow({ id, tag, text }: { id: string; tag: string; text: string }): Stack {
	const row = new Stack({ id, direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: space.space_2 });
	const chip = new Stack({
		id: `${id}_tag`,
		width: TAG_WIDTH,
		crossAlign: 'center',
		padding: { top: space.space_0_5, bottom: space.space_0_5, left: space.space_1, right: space.space_1 },
		style: { borderColor: 'line_strong', borderWidth: 'bw', borderRadius: 'r_sm' },
	});
	chip.addChild(new Text({ id: `${id}_tag_text`, text: tag, style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text' }, wrap: 'none' }));
	row.addChild(chip);
	row.addChild(new Text({ id: `${id}_text`, text, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text' }, wrap: 'none', textOverflow: 'ellipsis' }));
	return row;
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
}

function kicker({ id, text }: { id: string; text: string }): Text {
	return new Text({ text, id, style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text_dim', textTransform: 'uppercase', letterSpacing: 'ls_wide' }, wrap: 'none' });
}
