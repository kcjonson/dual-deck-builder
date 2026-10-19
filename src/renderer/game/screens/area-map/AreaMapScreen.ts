import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { getPlanBlocker, routesOnOffer } from '../../campaign/SupplyRun';
import { Stack } from '../../../engine/components/Stack';
import type { Text } from '../../../engine/components/Text';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import type { ColorToken } from '../../../engine/theme/tokens';
import { AreaMapView } from '../../ui/areaMap/AreaMapView';
import type { AreaMapSelection } from '../../ui/areaMap/layers';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { ContentsRow } from '../../ui/atlas/ContentsRow';
import { HandMarkLayer, HandMarkVariant } from '../../ui/atlas/HandMarkLayer';
import { LegendBox } from '../../ui/atlas/LegendBox';
import { PlateFrame } from '../../ui/atlas/PlateFrame';
import { mapProgressText } from '../main-menu/campaignText';
import { gateSectionTabs, metaSectionTabs } from '../metaSections';
import { planRefusal } from '../run/runText';
import { POI_CLEARED, STRONGHOLD_NOT_YET, darkText, poiKindText, poiYieldText, routesText } from './areaMapText';
import { COLUMN_GAP, PRIMARY_HEIGHT, PRIMARY_LABEL, PoiHead, SHEET_GAP, SIDE_WIDTH, caption, detailLine, poiLead, screenTitle, titleNote } from './atlasPanel';
import { PlannedPoi, PlanningMap, PlanningMaps, byDistance, plannedPois, poiCleared, poiMarkers, viewData } from './planningMap';

/** Plan's reason holds two lines, the most any takes. */
const REASON_LINES = 2;
const NOTHING_CHOSEN = 'No destination chosen';

/** What opens the area map: the campaign, and the POI to select, coming back from its run route. */
export interface AreaMapScreenData {
	campaign: Campaign;
	/** A POI's index in the map's POI layer. */
	poi?: number;
}

export interface AreaMapScreenOptions {
	/** Where the campaign is loaded from when none is handed over. Default: the game's shared store. */
	store?: CampaignStore;
	/** Where the campaign's map comes from. Default: the session's (`PlanningMaps.shared`). */
	maps?: PlanningMaps;
}

/**
 * The area map (Compound and Supply Runs, The area map; Game Flow 3.3),
 * opened by Plan a supply run as the MVP's route pick (DDB-43): the whole
 * map in an `AreaMapView`, every POI marked with its tier, a night ring on
 * one no route gets home from by dark, and the strongholds; beside it the
 * destinations nearest first as a list, and the chosen one's type, tier,
 * yield, routes, and Plan a run here, which opens its run route screen.
 * A stronghold shows, but its Plan is off until assaults exist.
 *
 * A POI is chosen by a click on its marker (the view picks in world space
 * through its camera) or from the list, which is the keyboard's way to the
 * POIs: Tab goes the section tabs, the map, the list, then Plan a run
 * here, and the arrows choose as they move through the list. Picking on the
 * map scrolls the list to it; picking in the list brings it into view on
 * the map. A click anywhere else on the map clears the choice.
 *
 * It's an atlas sheet (UI Art Direction, Screens; DDB-509): the map as a
 * plate under the title, and beside it a column of legend boxes, the
 * destinations as contents rows with the chosen one's highlighted by hand,
 * the chosen POI's box, and Plan a run here as the highway. The map draws
 * its own paper and is unchanged.
 *
 * The map is the campaign's own (`getAreaMap`), made again on Continue, so
 * the screen says how far that's got while it waits, and drops the answer
 * if it has gone by then. The section tabs go to the compound, the crew, or
 * the menu, and Escape returns to the compound. Opened
 * with no campaign, as a capture or the dev navigate hook does, it loads
 * the save as Continue would. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/area-map-route-pick.md.
 */
export class AreaMapScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private main: Stack | null = null;
	private side: Stack | null = null;
	private readonly store: CampaignStore;
	private readonly maps: PlanningMaps;
	private campaign: Campaign | null = null;
	private map: PlanningMap | null = null;
	private pois: readonly PlannedPoi[] = [];
	private chosen: PlannedPoi | null = null;
	private view: AreaMapView | null = null;
	private dayLine: Text | null = null;
	private status: Text | null = null;
	private listScroll: ScrollContainer | null = null;
	private list: FocusGroup | null = null;
	private marks: HandMarkLayer | null = null;
	private readonly rows = new Map<number, ContentsRow>();
	private nameHead: PoiHead | null = null;
	private kindLine: Text | null = null;
	private yieldLine: Text | null = null;
	private routesLine: Text | null = null;
	private darkLine: Text | null = null;
	private planButton: AtlasButton | null = null;
	private planReason: Text | null = null;
	/** Counts mounts and unmounts, so a map or save that arrives after the screen has gone changes nothing. */
	private visit = 0;
	/** Stops waiting for the map once the screen has gone. */
	private waiting: AbortController | null = null;
	private stopHearingFocus: (() => void) | null = null;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, maps = PlanningMaps.shared }: AreaMapScreenOptions = {}) {
		// The tabs are the sheet's, built with it; they read the campaign the screen holds when pressed.
		let shown: () => Campaign | null = () => null;
		const tabs = metaSectionTabs({ id: 'area_map_tabs', open: 'area_map', campaignOf: () => shown() });
		const root = new AtlasSheet({
			id: 'areaMapScreen',
			tabs,
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			gap: SHEET_GAP,
		});
		super('areaMapScreen', { root, theme: 'atlas' });
		shown = () => this.campaign;
		this.sheet = root;
		this.store = store;
		this.maps = maps;
	}

	/** The campaign on show, once there is one. */
	public get shown(): Campaign | null {
		return this.campaign;
	}

	/** The POI chosen, or null. */
	public get selected(): PlannedPoi | null {
		return this.chosen;
	}

	/** Settles once the save loaded on mount, and then its map, have been shown, or failed to. */
	public get campaignLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		this.waiting = new AbortController();
		this.view = new AreaMapView({
			id: 'area_map_view',
			widthMode: 'fill',
			heightMode: 'fill',
			onSelect: (selection) => this.pickedOnMap(selection),
		});
		this.main = this.createMain(this.view);
		this.sheet.addChild(this.main);
		this.side = this.createSide();
		this.sheet.addChild(this.side);

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		// Focus moving onto a destination's row chooses it, so the arrows choose as they move.
		this.stopHearingFocus = this.context.focus.onFocusChange((focused) => this.focusedRow(focused));
		this.gateTabs();
		const open = this.sheet.tabs?.tabs.find(({ selected }) => selected);
		if (open) this.context.focus.focus(open);

		const handed = data as Partial<AreaMapScreenData> | undefined;
		if (handed?.campaign) this.loaded = this.show(handed.campaign, handed.poi);
		else this.loaded = this.loadSave(handed?.poi);
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.waiting?.abort();
		this.waiting = null;
		this.stopHearingFocus?.();
		this.stopHearingFocus = null;
		this.rootLayer.hotkeys.unregister('Escape');
		if (this.main) this.sheet.removeChild(this.main);
		if (this.side) this.sheet.removeChild(this.side);
		this.main = null;
		this.side = null;
		this.campaign = null;
		this.map = null;
		this.pois = [];
		this.chosen = null;
		this.view = null;
		this.dayLine = null;
		this.status = null;
		this.listScroll = null;
		this.list = null;
		this.marks = null;
		this.rows.clear();
		this.nameHead = null;
		this.kindLine = null;
		this.yieldLine = null;
		this.routesLine = null;
		this.darkLine = null;
		this.planButton = null;
		this.planReason = null;
	}

	/** The title and the day over the map's plate, and the status line under it. */
	private createMain(view: AreaMapView): Stack {
		const main = new Stack({ id: 'area_map_main', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: 10 });
		const head = new Stack({ id: 'area_map_head', direction: 'horizontal', widthMode: 'fill', crossAlign: 'end', gap: 16 });
		head.addChild(screenTitle({ id: 'area_map_title', text: 'Area map' }));
		this.dayLine = titleNote({ id: 'area_map_day' });
		head.addChild(this.dayLine);
		main.addChild(head);
		const plate = new PlateFrame({ id: 'area_map_plate', widthMode: 'fill', heightMode: 'fill' });
		plate.art.addChild(view);
		main.addChild(plate);
		this.status = caption({ id: 'area_map_status', text: 'Looking for the saved campaign.' });
		main.addChild(this.status);
		return main;
	}

	/** The column beside the map: the destinations, the chosen one's box, and Plan a run here with its reason under it. */
	private createSide(): Stack {
		const side = new Stack({ id: 'area_map_side', width: SIDE_WIDTH, heightMode: 'fill', crossAlign: 'stretch', gap: COLUMN_GAP });
		const destinations = new LegendBox({ id: 'area_map_destinations_box', title: 'Destinations', widthMode: 'fill', heightMode: 'fill' });
		this.listScroll = new ScrollContainer({ id: 'area_map_destinations_scroll', widthMode: 'fill', heightMode: 'fill' });
		const page = new Stack({ id: 'area_map_destinations_page', widthMode: 'fill', crossAlign: 'stretch' });
		// The highlighter goes down under the rows, so their ink stays at full strength.
		this.marks = new HandMarkLayer({ id: 'area_map_destinations_marks', place: 'under' });
		page.addChild(this.marks);
		this.list = new FocusGroup({
			id: 'area_map_destinations',
			selection: 'single',
			widthMode: 'fill',
			crossAlign: 'stretch',
			onSelect: (selected) => {
				const poi = this.pois.find(({ poi: index }) => this.rows.get(index) === selected[0]);
				if (poi) this.choose(poi, { from: 'list' });
			},
		});
		page.addChild(this.list);
		this.listScroll.addChild(page);
		destinations.addChild(this.listScroll);
		side.addChild(destinations);
		side.addChild(this.createDetails());

		const plan = new Stack({ id: 'area_map_plan', widthMode: 'fill', crossAlign: 'stretch', gap: 6 });
		this.planButton = new AtlasButton({
			label: 'Plan a run here',
			id: 'area_map_plan_button',
			variant: 'highway',
			shield: true,
			labelSize: PRIMARY_LABEL,
			height: PRIMARY_HEIGHT,
			block: true,
			disabled: true,
			onClick: () => this.plan(),
		});
		plan.addChild(this.planButton);
		this.planReason = detailLine({ id: 'area_map_plan_reason', color: 'status_crit', lines: REASON_LINES });
		plan.addChild(this.planReason);
		side.addChild(plan);
		return side;
	}

	/**
	 * The chosen POI's box, fresh paper as the thing in focus, every line a
	 * fixed height, so choosing one, or a stronghold with its reason, never
	 * moves the list above it.
	 */
	private createDetails(): LegendBox {
		const details = new LegendBox({ id: 'area_map_details', fresh: true, widthMode: 'fill', gap: 4, padding: 14 });
		this.nameHead = new PoiHead({ id: 'area_map_selected_name', empty: NOTHING_CHOSEN });
		details.addChild(this.nameHead);
		this.kindLine = detailLine({ id: 'area_map_selected_kind', color: 'text' });
		details.addChild(this.kindLine);
		this.yieldLine = detailLine({ id: 'area_map_selected_yield', color: 'text' });
		details.addChild(this.yieldLine);
		this.routesLine = detailLine({ id: 'area_map_selected_routes' });
		details.addChild(this.routesLine);
		this.darkLine = detailLine({ id: 'area_map_selected_dark' });
		details.addChild(this.darkLine);
		return details;
	}

	private async loadSave(poi: number | undefined): Promise<void> {
		const visit = this.visit;
		let campaign: Campaign | null = null;
		let trouble = 'No campaign in progress.';
		try {
			campaign = await this.store.load();
		} catch (error) {
			if (!(error instanceof CampaignStoreError)) console.error('AreaMapScreen: loading the save failed', error);
			trouble = error instanceof CampaignStoreError ? error.message : "The saved campaign couldn't be read.";
		}
		if (visit !== this.visit) return;
		if (campaign) await this.show(campaign, poi);
		else this.say({ text: trouble, color: 'status_crit' });
	}

	/** The campaign, then its map: at once when it's been made this session, or once it has, saying how far that's got. */
	private async show(campaign: Campaign, poi: number | undefined): Promise<void> {
		this.campaign = campaign;
		this.gateTabs();
		if (this.dayLine) this.dayLine.text = `Day ${campaign.day} / Fuel ${campaign.resources.fuel}`;
		const known = this.maps.known(campaign);
		if (known) {
			this.showMap(known, poi);
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
			console.error('AreaMapScreen: the area map could not be made', error);
			this.say({ text: `The area map couldn't be made. ${error instanceof Error ? error.message : ''}`.trim(), color: 'status_crit' });
			return;
		}
		if (visit !== this.visit) return;
		this.showMap(map, poi);
	}

	private showMap(map: PlanningMap, poi: number | undefined): void {
		this.map = map;
		this.gateTabs();
		this.pois = plannedPois(map);
		const view = this.view;
		const cleared = (planned: PlannedPoi): boolean => this.isCleared(planned);
		if (view) {
			view.map = viewData(map);
			view.markers = poiMarkers({ pois: this.pois, stateOf: (planned) => (cleared(planned) ? 'depleted' : 'unvisited') });
		}
		const list = this.list;
		if (list) {
			list.clearChildren();
			this.marks?.clear();
			this.rows.clear();
			for (const planned of byDistance(this.pois)) {
				// A cleared POI is dimmed rather than named in the value, which would squeeze the names out of the list.
				const row = new ContentsRow({
					id: `area_map_poi_${planned.poi}`,
					variant: 'list',
					lead: poiLead(planned),
					label: planned.name,
					value: rowValue(planned),
					dim: planned.stronghold || cleared(planned),
				});
				this.rows.set(planned.poi, row);
				list.addChild(row);
			}
		}
		const strongholds = this.pois.filter(({ stronghold }) => stronghold).length;
		this.say({ text: `${this.pois.length - strongholds} destinations and ${strongholds} strongholds. Pick one on the map or in the list.`, color: 'text_dim' });
		const handed = poi === undefined ? undefined : this.pois[poi];
		if (handed) {
			this.choose(handed, { from: 'return' });
			if (this.planButton?.enabled) this.context.focus.focus(this.planButton);
		}
	}

	/** Focus on a destination's row chooses its POI, unless it's chosen already. */
	private focusedRow(focused: unknown): void {
		const poi = this.pois.find(({ poi: index }) => this.rows.get(index) === focused);
		if (poi && poi !== this.chosen) this.choose(poi, { from: 'list' });
	}

	/** A click on the map: a POI's marker chooses it; anywhere else clears the choice, roads included. */
	private pickedOnMap(selection: AreaMapSelection | null): void {
		const poi = selection?.kind === 'marker' ? this.pois.find(({ id }) => id === selection.id) : undefined;
		if (poi) {
			this.choose(poi, { from: 'map' });
			return;
		}
		this.chosen = null;
		if (this.view) this.view.selection = null;
		this.list?.select([]);
		this.marks?.clear();
		this.refreshDetails();
	}

	/**
	 * Chooses a POI: its marker selected and its row picked. From the map,
	 * the list scrolls to its row; from the list or coming back to it, the
	 * map brings it into view if it's out of it.
	 */
	private choose(poi: PlannedPoi, { from }: { from: 'map' | 'list' | 'return' }): void {
		this.chosen = poi;
		const view = this.view;
		if (view) {
			view.selection = { kind: 'marker', id: poi.id };
			// A view with no area yet is fitted to the whole disc when it gets one, which shows every POI.
			if (from !== 'map' && view.width > 0 && view.height > 0 && !inView(view, poi)) view.camera.center = { x: poi.x, y: poi.y };
		}
		const row = this.rows.get(poi.poi);
		if (row && this.list) {
			if (!row.selected) this.list.select([row]);
			if (from !== 'list') this.listScroll?.scrollIntoView(row);
		}
		const marks = this.marks;
		if (marks) {
			marks.clear();
			// The swipe varies by POI, so the same choice always gets the same mark.
			if (row) marks.highlight(row, { variant: (poi.poi % 4) as HandMarkVariant });
		}
		this.refreshDetails();
	}

	/**
	 * The chosen POI's details and whether Plan a run here can go: off for a
	 * stronghold, a POI no road reaches, and whatever keeps the compound's
	 * Plan off but fuel, since its run route screen says which of its
	 * routes the stores can pay for.
	 */
	private refreshDetails(): void {
		const poi = this.chosen;
		const { campaign, map } = this;
		if (!poi || !campaign || !map) {
			this.nameHead?.show(null, NOTHING_CHOSEN);
			for (const line of [this.kindLine, this.yieldLine, this.routesLine, this.darkLine, this.planReason]) if (line) line.text = '';
			if (this.planButton) this.planButton.enabled = false;
			return;
		}
		const destination = routesOnOffer({ map, campaign }).find((route) => route.destination.id === poi.id)?.destination ?? null;
		const cleared = this.isCleared(poi);
		this.nameHead?.show(poi);
		if (this.kindLine) this.kindLine.text = poiKindText({ ...poi, cleared });
		if (this.yieldLine) this.yieldLine.text = poiYieldText({ stronghold: poi.stronghold, yields: destination?.yield ?? null, cleared });
		if (this.routesLine) this.routesLine.text = routesText(poi);
		if (this.darkLine) {
			this.darkLine.text = darkText(poi);
			this.darkLine.color = poi.pastDark ? 'status_crit' : 'text_dim';
		}
		const reason = this.planBlocked(poi);
		if (this.planButton) this.planButton.enabled = reason === null;
		if (this.planReason) this.planReason.text = reason ?? '';
	}

	/** Whether a run has cleared the POI, which nothing has until there's a campaign. */
	private isCleared(poi: PlannedPoi): boolean {
		return this.campaign ? poiCleared({ campaign: this.campaign, poi }) : false;
	}

	/** Why Plan a run here is off for this POI, or null. */
	private planBlocked(poi: PlannedPoi): string | null {
		const { campaign, map } = this;
		if (!campaign || !map) return null;
		if (poi.stronghold) return STRONGHOLD_NOT_YET;
		if (this.isCleared(poi)) return POI_CLEARED;
		if (poi.routes.length === 0) return 'No road reaches it.';
		const blocker = getPlanBlocker({ campaign, map });
		return blocker === null || blocker.reason === 'too_little_fuel' ? null : planRefusal(blocker);
	}

	/** The section tabs this screen can take now (`sectionAvailability`). */
	private gateTabs(): void {
		const { campaign, map } = this;
		const tabs = this.sheet.tabs;
		if (!tabs) return;
		gateSectionTabs(tabs, { campaign, mapKnown: map !== null, planBlocked: campaign !== null && map !== null && getPlanBlocker({ campaign, map }) !== null, busy: false });
	}

	/** The run route screen for the chosen POI. */
	private plan(): void {
		const { campaign, chosen } = this;
		if (!campaign || !chosen || this.planBlocked(chosen) !== null) return;
		ScreenManager.navigate('runRouteScreen', { campaign, poi: chosen.poi });
	}

	private say({ text, color }: { text: string; color: ColorToken }): void {
		if (!this.status) return;
		this.status.text = text;
		this.status.color = color;
	}

	/** To the compound with the campaign, or the menu with none to show. */
	private back(): void {
		if (this.campaign) ScreenManager.navigate('compoundScreen', { campaign: this.campaign }, { restoreFocus: true });
		else ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/** A destination row's value: its tier, and when no route gets home by dark; a stronghold says so. */
function rowValue(poi: PlannedPoi): string {
	if (poi.stronghold) return 'stronghold';
	return poi.pastDark ? `tier ${poi.tier}, past dark` : `tier ${poi.tier}`;
}

/** Whether a POI is inside the part of the world the view shows. */
function inView(view: AreaMapView, { x, y }: { x: number; y: number }): boolean {
	const shown = view.camera.visibleWorld;
	return x >= shown.x && x <= shown.x + shown.width && y >= shown.y && y <= shown.y + shown.height;
}
