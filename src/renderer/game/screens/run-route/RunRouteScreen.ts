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
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { AreaMapView } from '../../ui/areaMap/AreaMapView';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { LegendBox } from '../../ui/atlas/LegendBox';
import { PlateFrame } from '../../ui/atlas/PlateFrame';
import { RouteCard } from '../../ui/RouteCard';
import { STRONGHOLD_NOT_YET, QUIET_STOPS, clockText, homeByText, poiKindText, poiYieldText, routeDetail, stopTag, stopText } from '../area-map/areaMapText';
import { COLUMN_GAP, PRIMARY_HEIGHT, PRIMARY_LABEL, PoiHead, SHEET_GAP, SIDE_WIDTH, caption, screenTitle } from '../area-map/atlasPanel';
import { PlannedPoi, PlanningMap, PlanningMaps, byDistance, mapRoutes, plannedPois, poiStock, quickestOf, routesBounds, viewData } from '../area-map/planningMap';
import { mapProgressText } from '../main-menu/campaignText';
import { departRefusal, planRefusal } from '../run/runText';

const { space } = tokens;
/** World units round the compound, the POI, and its routes, past the camera's own fit margin. */
const FRAME_MARGIN = 60;
/**
 * The least world the frame spans each way, so a POI near the compound
 * isn't drawn so close that the baked land shows its texels.
 */
const MIN_FRAME = 800;
/** What the status line says once the store has moved on from this campaign; Back then goes to the menu. */
export const STRANDED_RUN_ROUTE = "This campaign isn't the save any more, so nothing more is saved here. Back goes to the menu to pick up the save.";
/** A stop's tag holds the longest, CHECKPOINT, so the rows' text lines up. */
const TAG_WIDTH = 92;

/** What Plan a run here hands the run route screen: the campaign, and the POI by its index in the map's POI layer. */
export interface RunRouteScreenData {
	campaign: Campaign;
	/** The nearest destination when left out, as a capture or the dev navigate hook opens it. */
	poi?: number;
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
 * campaign it loads the save as Continue would, and with no POI it shows
 * the nearest destination (`byDistance`). The decision record is
 * docs/AI_TECHNICAL_DECISIONS/area-map-route-pick.md.
 *
 * It's an atlas sheet like the area map's (DDB-509): Back and the title over
 * the map's plate, and beside it a column of legend boxes, the destination,
 * the routes, and the stops, with Load out the crew as the highway. It's a
 * step under the area map rather than its sibling, so it has a back link
 * where the area map has section tabs.
 */
export class RunRouteScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private main: Stack | null = null;
	private side: Stack | null = null;
	private readonly store: CampaignStore;
	private readonly maps: PlanningMaps;
	private campaign: Campaign | null = null;
	private map: PlanningMap | null = null;
	/** The POI handed over, or null for the nearest. */
	private poiIndex: number | null = null;
	private poi: PlannedPoi | null = null;
	private picked = -1;
	private view: AreaMapView | null = null;
	private nameHead: PoiHead | null = null;
	private dayLine: Text | null = null;
	private kindLine: Text | null = null;
	private status: Text | null = null;
	private cards: FocusGroup | null = null;
	private stopsList: Stack | null = null;
	private homeLine: Text | null = null;
	private loadOutButton: AtlasButton | null = null;
	private loadOutReason: Text | null = null;
	/** The run is setting off, so another press waits for it. */
	private departing = false;
	/** The store has moved on from this campaign: nothing here is saved, and Back goes to the menu. */
	private stranded = false;
	private unsubscribe: (() => void) | null = null;
	private visit = 0;
	/** Stops waiting for the map once the screen has gone. */
	private waiting: AbortController | null = null;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, maps = PlanningMaps.shared }: RunRouteScreenOptions = {}) {
		const root = new AtlasSheet({
			id: 'runRouteScreen',
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			gap: SHEET_GAP,
		});
		super('runRouteScreen', { root, theme: 'atlas' });
		this.sheet = root;
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
		this.waiting = new AbortController();
		this.view = new AreaMapView({ id: 'run_route_view', widthMode: 'fill', heightMode: 'fill' });
		const back = new AtlasButton({ label: 'Back to the area map', id: 'run_route_back_button', onClick: () => this.back() });
		this.main = this.createMain(back, this.view);
		this.sheet.addChild(this.main);
		this.side = this.createSide();
		this.sheet.addChild(this.side);

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		this.unsubscribe = this.store.onSaveFailed((error) => this.say({ text: error.message, color: 'status_crit' }));
		this.context.focus.focus(back);

		const handed = data as Partial<RunRouteScreenData> | undefined;
		this.poiIndex = typeof handed?.poi === 'number' ? handed.poi : null;
		if (handed?.campaign) this.loaded = this.show(handed.campaign);
		else this.loaded = this.loadSave();
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.waiting?.abort();
		this.waiting = null;
		this.rootLayer.hotkeys.unregister('Escape');
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.main) this.sheet.removeChild(this.main);
		if (this.side) this.sheet.removeChild(this.side);
		this.main = null;
		this.side = null;
		this.campaign = null;
		this.map = null;
		this.poiIndex = null;
		this.poi = null;
		this.picked = -1;
		this.view = null;
		this.nameHead = null;
		this.dayLine = null;
		this.kindLine = null;
		this.status = null;
		this.cards = null;
		this.stopsList = null;
		this.homeLine = null;
		this.loadOutButton = null;
		this.loadOutReason = null;
		this.departing = false;
		this.stranded = false;
	}

	/** Back and the title over the map's plate, and the status line under it, hidden with nothing to say. */
	private createMain(back: AtlasButton, view: AreaMapView): Stack {
		const main = new Stack({ id: 'run_route_main', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: 10 });
		const head = new Stack({ id: 'run_route_head', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: 20 });
		head.addChild(back);
		head.addChild(screenTitle({ id: 'run_route_title', text: 'Run route' }));
		main.addChild(head);
		const plate = new PlateFrame({ id: 'run_route_plate', widthMode: 'fill', heightMode: 'fill' });
		plate.addChild(view);
		main.addChild(plate);
		this.status = caption({ id: 'run_route_status', text: 'Looking for the saved campaign.' });
		main.addChild(this.status);
		return main;
	}

	/** The destination's box, the routes and their stops (scrolling together), and Load out the crew at the foot. */
	private createSide(): Stack {
		const side = new Stack({ id: 'run_route_side', width: SIDE_WIDTH, heightMode: 'fill', crossAlign: 'stretch', gap: COLUMN_GAP });
		const destination = new LegendBox({ id: 'run_route_destination', fresh: true, widthMode: 'fill', gap: 4, padding: 14 });
		this.nameHead = new PoiHead({ id: 'run_route_name' });
		destination.addChild(this.nameHead);
		this.dayLine = new Text({ id: 'run_route_day', text: '', widthMode: 'fill', style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
		destination.addChild(this.dayLine);
		this.kindLine = caption({ id: 'run_route_kind', text: '', color: 'text' });
		destination.addChild(this.kindLine);
		side.addChild(destination);

		const scroll = new ScrollContainer({ id: 'run_route_scroll', widthMode: 'fill', heightMode: 'fill' });
		const body = new Stack({ id: 'run_route_body', widthMode: 'fill', crossAlign: 'stretch', gap: COLUMN_GAP });
		const routes = new LegendBox({ id: 'run_route_routes', title: 'Routes', widthMode: 'fill' });
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
		routes.addChild(this.cards);
		body.addChild(routes);
		const stops = new LegendBox({ id: 'run_route_stops_box', title: 'Stops in order', widthMode: 'fill' });
		this.stopsList = new Stack({ id: 'run_route_stops', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_1 });
		stops.addChild(this.stopsList);
		stops.addChild(caption({ id: 'run_route_quiet_note', text: QUIET_STOPS }));
		body.addChild(stops);
		scroll.addChild(body);
		side.addChild(scroll);

		const go = new Stack({ id: 'run_route_go', widthMode: 'fill', crossAlign: 'stretch', gap: 6 });
		this.homeLine = new Text({ id: 'run_route_home_by', text: '', widthMode: 'fill', style: { fontSize: 'fs_sm', fontWeight: 'bold', color: 'text' } });
		go.addChild(this.homeLine);
		this.loadOutButton = new AtlasButton({
			label: 'Load out the crew',
			id: 'run_route_load_out_button',
			variant: 'highway',
			shield: true,
			labelSize: PRIMARY_LABEL,
			height: PRIMARY_HEIGHT,
			block: true,
			disabled: true,
			onClick: () => { void this.loadOut(); },
		});
		go.addChild(this.loadOutButton);
		this.loadOutReason = caption({ id: 'run_route_load_out_reason', text: '', color: 'status_crit' });
		this.loadOutReason.visible = false;
		go.addChild(this.loadOutReason);
		side.addChild(go);
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
		else this.say({ text: trouble, color: 'status_crit' });
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
				signal: this.waiting?.signal,
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
	 * and the quickest route the stores can fuel picked (fewest hours out,
	 * stops included), or the quickest of all when none can be fuelled. A POI
	 * the map doesn't have, a stronghold, or one with no
	 * route says so and offers only Back.
	 */
	private showMap(map: PlanningMap): void {
		const campaign = this.campaign;
		if (!campaign) return;
		this.map = map;
		const pois = plannedPois(map);
		const poi = (this.poiIndex === null ? byDistance(pois).find(({ stronghold }) => !stronghold) : pois[this.poiIndex]) ?? null;
		const trouble = poi === null ? "That destination isn't on the area map." : poi.stronghold ? STRONGHOLD_NOT_YET : poi.routes.length === 0 ? 'No road reaches it.' : null;
		if (poi === null || trouble !== null) {
			this.say({ text: trouble ?? '', color: 'status_crit' });
			return;
		}
		this.poi = poi;
		this.poiIndex = poi.poi;
		const dark = poi.routes[0].dark;
		this.nameHead?.show(poi);
		if (this.dayLine) this.dayLine.text = `Day ${campaign.day} / dawn ${clockText(dark - map.params.daylightHours)} / dark ${clockText(dark)} / fuel ${campaign.resources.fuel}`;
		const destination = this.runRoute(poi.routes[0])?.destination ?? null;
		const { state } = poiStock({ campaign, poi });
		if (this.kindLine) this.kindLine.text = `${poiKindText({ ...poi, state })}. ${poiYieldText({ stronghold: false, yields: destination?.yield ?? null, state })}`;
		// Nothing to wait for or warn of: the cards say the rest.
		this.say({ text: '', color: 'text_dim' });

		const view = this.view;
		if (view) {
			view.map = viewData(map);
			view.markers = [{ id: poi.id, kind: 'poi', x: poi.x, y: poi.y, label: poi.name, type: poi.type, pastDark: poi.pastDark, ...(state === 'unvisited' ? {} : { state }) }];
			view.selection = { kind: 'marker', id: poi.id };
			view.camera.fit(frameOf(routesBounds({ map, poi })));
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
					noteColor: 'status_crit',
					dim: blocker !== null,
				}));
			});
		}
		const fuelled = quickestOf(poi.routes.filter((route) => this.departBlocker(route) === null)) ?? poi.quickest;
		this.pick(fuelled ? poi.routes.indexOf(fuelled) : 0);
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
		if (this.view) this.view.routes = mapRoutes({ map, routes: poi.routes, picked: route.route });

		const list = this.stopsList;
		if (list) {
			list.clearChildren();
			route.stops.forEach((stop, place) => list.addChild(stopRow({ id: `run_route_stop_${place}`, tag: stopTag(stop), text: stopText(stop) })));
			if (route.stops.length === 0) list.addChild(caption({ id: 'run_route_stop_none', text: 'No stops: a clear road all the way.' }));
		}
		if (this.homeLine) {
			this.homeLine.text = homeByText(route);
			this.homeLine.color = route.spare < 0 ? 'status_crit' : 'text';
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
		const { campaign, map } = this;
		if (!campaign || !map) return null;
		const id = routeId(route.poi, route.route);
		return routesOnOffer({ map, campaign }).find((offered) => offered.id === id) ?? null;
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
		if (this.stranded) return STRANDED_RUN_ROUTE;
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
	 * stays here, saying nothing more is saved, with Load out off and Back
	 * going to the menu, where Continue picks up the save.
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
			this.departing = false;
			this.stranded = true;
			this.say({ text: STRANDED_RUN_ROUTE, color: 'status_crit' });
			this.pick(this.picked);
			return;
		}
		ScreenManager.navigate('runScreen', { campaign, saved: Promise.resolve(result) });
	}

	/** The status line, hidden with nothing to say. */
	private say({ text, color }: { text: string; color: ColorToken }): void {
		if (!this.status) return;
		this.status.text = text;
		this.status.color = color;
		this.status.visible = text !== '';
	}

	/** To the area map with this POI still chosen, or the menu with no campaign to show or once it isn't the save. */
	private back(): void {
		if (this.departing) return;
		if (this.campaign && !this.stranded) ScreenManager.navigate('areaMapScreen', { campaign: this.campaign, poi: this.poiIndex ?? undefined }, { restoreFocus: true });
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
