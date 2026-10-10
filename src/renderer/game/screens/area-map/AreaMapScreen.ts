import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { Campaign } from '../../campaign/Campaign';
import { CampaignStore, CampaignStoreError } from '../../campaign/CampaignStore';
import { getPlanBlocker, routesOnOffer } from '../../campaign/SupplyRun';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Divider } from '../../../engine/ui/Divider';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { ListRow } from '../../../engine/ui/ListRow';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { AreaMapView } from '../../ui/areaMap/AreaMapView';
import type { AreaMapSelection } from '../../ui/areaMap/layers';
import { mapProgressText } from '../main-menu/campaignText';
import { planRefusal } from '../run/runText';
import { STRONGHOLD_NOT_YET, darkText, poiKindText, poiYieldText, routesText } from './areaMapText';
import { PlannedPoi, PlanningMap, PlanningMaps, byDistance, plannedPois, poiMarkers, viewData } from './planningMap';

const { space } = tokens;
const SIDE_WIDTH = 340;
const BACK_WIDTH = 96;
/** A detail line's height, one line of caption, so the details never change height and the list above them never moves. */
const LINE_HEIGHT = tokens.fontSize.fs_sm * tokens.lineHeight.lh;
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
 * POIs: Back, the map, the list, then Plan a run here, in that order. Picking
 * on the map scrolls the list to it; picking in the list brings it into view
 * on the map. A click anywhere else on the map clears the choice.
 *
 * The map is the campaign's own (`getAreaMap`), made again on Continue, so
 * the screen says how far that's got while it waits, and drops the answer
 * if it has gone by then. Back and Escape return to the compound. Opened
 * with no campaign, as a capture or the dev navigate hook does, it loads
 * the save as Continue would. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/area-map-route-pick.md.
 */
export class AreaMapScreen extends Screen {
	private readonly stack: Stack;
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
	private readonly rows = new Map<number, ListRow>();
	private details: Stack | null = null;
	private nameLine: Text | null = null;
	private kindLine: Text | null = null;
	private yieldLine: Text | null = null;
	private routesLine: Text | null = null;
	private darkLine: Text | null = null;
	private planButton: Button | null = null;
	private planReason: Text | null = null;
	/** Counts mounts and unmounts, so a map or save that arrives after the screen has gone changes nothing. */
	private visit = 0;
	/** Stops waiting for the map once the screen has gone. */
	private waiting: AbortController | null = null;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ store = CampaignStore.shared, maps = PlanningMaps.shared }: AreaMapScreenOptions = {}) {
		const root = new Stack({
			id: 'areaMapScreen',
			direction: 'horizontal',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
			style: { backgroundColor: 'bg_base' },
		});
		super('areaMapScreen', { root });
		this.stack = root;
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
		this.stack.addChild(this.view);
		const back = new Button({ label: 'Back', id: 'area_map_back_button', icon: 'arrow_back', size: 'sm', width: BACK_WIDTH, onClick: () => this.back() });
		this.stack.addChild(this.createSide(back));

		this.rootLayer.hotkeys.register('Escape', () => this.back());
		this.context.focus.focus(back);

		const handed = data as Partial<AreaMapScreenData> | undefined;
		if (handed?.campaign) this.loaded = this.show(handed.campaign, handed.poi);
		else this.loaded = this.loadSave(handed?.poi);
	}

	protected onUnmount(): void {
		this.visit += 1;
		this.waiting?.abort();
		this.waiting = null;
		this.rootLayer.hotkeys.unregister('Escape');
		this.stack.clearChildren();
		this.campaign = null;
		this.map = null;
		this.pois = [];
		this.chosen = null;
		this.view = null;
		this.dayLine = null;
		this.status = null;
		this.listScroll = null;
		this.list = null;
		this.rows.clear();
		this.details = null;
		this.nameLine = null;
		this.kindLine = null;
		this.yieldLine = null;
		this.routesLine = null;
		this.darkLine = null;
		this.planButton = null;
		this.planReason = null;
	}

	/** The side panel: Back and the heading, the status line, the destinations, and the chosen one's details over Plan a run here. */
	private createSide(back: Button): Stack {
		const side = new Stack({
			id: 'area_map_side',
			width: SIDE_WIDTH,
			heightMode: 'fill',
			crossAlign: 'stretch',
			padding: space.space_4,
			gap: space.space_3,
			style: { backgroundColor: 'bg_panel' },
		});
		const head = new Stack({ id: 'area_map_head', direction: 'horizontal', crossAlign: 'center', gap: space.space_3 });
		head.addChild(back);
		const heading = new Stack({ id: 'area_map_heading', crossAlign: 'start' });
		heading.addChild(new Text({
			text: 'Area map',
			id: 'area_map_title',
			style: { fontRole: 'display', fontSize: 'fs_xl', color: 'text_bright', textTransform: 'uppercase', letterSpacing: 'ls_wide' },
			wrap: 'none',
		}));
		this.dayLine = new Text({ id: 'area_map_day', text: '', style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none' });
		heading.addChild(this.dayLine);
		head.addChild(heading);
		side.addChild(head);

		this.status = caption({ id: 'area_map_status', text: 'Looking for the saved campaign.' });
		side.addChild(this.status);

		side.addChild(kicker({ id: 'area_map_destinations_kicker', text: 'Destinations' }));
		this.listScroll = new ScrollContainer({ id: 'area_map_destinations_scroll', widthMode: 'fill', heightMode: 'fill' });
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
		this.listScroll.addChild(this.list);
		side.addChild(this.listScroll);
		side.addChild(new Divider({ id: 'area_map_details_rule' }));
		side.addChild(this.createDetails());
		return side;
	}

	/**
	 * The chosen POI, every line a fixed height, so choosing one, or a
	 * stronghold with its reason, never moves the list above it.
	 */
	private createDetails(): Stack {
		const details = new Stack({ id: 'area_map_details', crossAlign: 'stretch', gap: space.space_1 });
		details.addChild(kicker({ id: 'area_map_selected_kicker', text: 'Selected' }));
		this.nameLine = new Text({
			id: 'area_map_selected_name',
			text: NOTHING_CHOSEN,
			widthMode: 'fill',
			style: { fontRole: 'display', fontSize: 'fs_lg', color: 'text_bright' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		details.addChild(this.nameLine);
		this.kindLine = detailLine({ id: 'area_map_selected_kind', color: 'text' });
		details.addChild(this.kindLine);
		this.yieldLine = detailLine({ id: 'area_map_selected_yield', color: 'text' });
		details.addChild(this.yieldLine);
		this.routesLine = detailLine({ id: 'area_map_selected_routes' });
		details.addChild(this.routesLine);
		this.darkLine = detailLine({ id: 'area_map_selected_dark' });
		details.addChild(this.darkLine);
		this.planButton = new Button({
			label: 'Plan a run here',
			id: 'area_map_plan_button',
			tone: 'accent',
			block: true,
			disabled: true,
			margin: { top: space.space_2 },
			onClick: () => this.plan(),
		});
		details.addChild(this.planButton);
		this.planReason = detailLine({ id: 'area_map_plan_reason', color: 'status_warn', lines: REASON_LINES });
		details.addChild(this.planReason);
		this.details = details;
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
		else this.say({ text: trouble, color: 'status_warn' });
	}

	/** The campaign, then its map: at once when it's been made this session, or once it has, saying how far that's got. */
	private async show(campaign: Campaign, poi: number | undefined): Promise<void> {
		this.campaign = campaign;
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
		this.pois = plannedPois(map);
		const view = this.view;
		if (view) {
			view.map = viewData(map);
			view.markers = poiMarkers(this.pois);
		}
		const list = this.list;
		if (list) {
			list.clearChildren();
			this.rows.clear();
			for (const planned of byDistance(this.pois)) {
				const row = new ListRow({ id: `area_map_poi_${planned.poi}`, label: planned.name, trailing: rowTrailing(planned), dim: planned.stronghold });
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
			if (this.nameLine) this.nameLine.text = NOTHING_CHOSEN;
			for (const line of [this.kindLine, this.yieldLine, this.routesLine, this.darkLine, this.planReason]) if (line) line.text = '';
			if (this.planButton) this.planButton.enabled = false;
			return;
		}
		const destination = routesOnOffer({ map }).find((route) => route.destination.id === poi.id)?.destination ?? null;
		if (this.nameLine) this.nameLine.text = poi.name;
		if (this.kindLine) this.kindLine.text = poiKindText(poi);
		if (this.yieldLine) this.yieldLine.text = poiYieldText({ stronghold: poi.stronghold, yields: destination?.yield ?? null });
		if (this.routesLine) this.routesLine.text = routesText(poi);
		if (this.darkLine) {
			this.darkLine.text = darkText(poi);
			this.darkLine.color = poi.pastDark ? 'status_warn' : 'text_dim';
		}
		const reason = this.planBlocked(poi);
		if (this.planButton) this.planButton.enabled = reason === null;
		if (this.planReason) this.planReason.text = reason ?? '';
	}

	/** Why Plan a run here is off for this POI, or null. */
	private planBlocked(poi: PlannedPoi): string | null {
		const { campaign, map } = this;
		if (!campaign || !map) return null;
		if (poi.stronghold) return STRONGHOLD_NOT_YET;
		if (poi.routes.length === 0) return 'No road reaches it.';
		const blocker = getPlanBlocker({ campaign, map });
		return blocker === null || blocker.reason === 'too_little_fuel' ? null : planRefusal(blocker);
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

/** A destination row's trailing text: its tier, and when no route gets home by dark; a stronghold says so. */
function rowTrailing(poi: PlannedPoi): string {
	if (poi.stronghold) return 'stronghold';
	return poi.pastDark ? `tier ${poi.tier}, past dark` : `tier ${poi.tier}`;
}

/** Whether a POI is inside the part of the world the view shows. */
function inView(view: AreaMapView, { x, y }: { x: number; y: number }): boolean {
	const shown = view.camera.visibleWorld;
	return x >= shown.x && x <= shown.x + shown.width && y >= shown.y && y <= shown.y + shown.height;
}

function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
}

/** A detail line held at `lines` lines of caption, a longer one ending in an ellipsis. */
function detailLine({ id, color = 'text_dim', lines = 1 }: { id: string; color?: ColorToken; lines?: number }): Text {
	return new Text({
		text: '',
		id,
		widthMode: 'fill',
		height: LINE_HEIGHT * lines,
		lineHeight: tokens.lineHeight.lh,
		wrap: lines === 1 ? 'none' : undefined,
		textOverflow: 'ellipsis',
		style: { fontSize: 'fs_sm', color },
	});
}

function kicker({ id, text }: { id: string; text: string }): Text {
	return new Text({ text, id, style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text_dim', textTransform: 'uppercase', letterSpacing: 'ls_wide' }, wrap: 'none' });
}
