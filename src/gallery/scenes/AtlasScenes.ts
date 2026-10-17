import type { Component } from '../../renderer/engine/components/Component';
import { Stack } from '../../renderer/engine/components/Stack';
import { Text } from '../../renderer/engine/components/Text';
import { Panel } from '../../renderer/engine/ui/Panel';
import { AtlasButton } from '../../renderer/game/ui/atlas/AtlasButton';
import { AtlasSheet } from '../../renderer/game/ui/atlas/AtlasSheet';
import { ContentsRow } from '../../renderer/game/ui/atlas/ContentsRow';
import { DeckGlyph, DeckStack } from '../../renderer/game/ui/atlas/deck';
import { CasedBar, ScaleBar } from '../../renderer/game/ui/atlas/gauges';
import { HandMarkLayer } from '../../renderer/game/ui/atlas/HandMarkLayer';
import { LegendBox, LegendRow } from '../../renderer/game/ui/atlas/LegendBox';
import { MapGlyph } from '../../renderer/game/ui/atlas/mapGlyphs';
import { PlateFrame } from '../../renderer/game/ui/atlas/PlateFrame';
import { ResourceStrip } from '../../renderer/game/ui/atlas/ResourceStrip';
import { SectionTabs } from '../../renderer/game/ui/atlas/SectionTabs';
import type { SceneFactoryOptions } from '../registry';

/**
 * The atlas parts (DDB-505, UI Art Direction, Components) under the atlas
 * theme, one scene a group so each fits 1024 by 600. The surfaces are flat
 * paper tints until the UI art atlas lands.
 */

const SECTIONS = [
	{ id: 'menu', label: 'Menu' },
	{ id: 'compound', label: 'Compound' },
	{ id: 'area_map', label: 'Area map' },
	{ id: 'crew', label: 'Crew', deck: true },
];

function caption(text: string): Text {
	return new Text({ text, style: { fontRole: 'mono', fontSize: 11, letterSpacing: 0.12, textTransform: 'uppercase', color: 'text_dim' }, wrap: 'none' });
}

function line(children: Component[], gap = 16): Stack {
	const row = new Stack({ direction: 'horizontal', gap, crossAlign: 'center' });
	for (const child of children) row.addChild(child);
	return row;
}

/** A captioned item, for a row of states. */
function labelled(item: Component, text: string): Stack {
	const cell = new Stack({ gap: 8 });
	cell.addChild(item);
	cell.addChild(caption(text));
	return cell;
}

/** Focused as it mounts and shown as a key would show it, so the first frame already has the ring (as ButtonExamplesSection's demo is). */
class FocusedAtlasButton extends AtlasButton {
	protected onMount(): void {
		const focus = this.context?.focus;
		if (focus?.focus(this, 'pointer')) focus.showFocusVisible();
		super.onMount();
	}
}

/** The frame every atlas catalog scene draws in: the sheet's paper, an ink edge, captioned rows. */
abstract class AtlasCatalogScene extends Panel {
	private readonly rows: Stack;

	constructor({ id, title, x, y, width }: SceneFactoryOptions & { id: string; title: string }) {
		super({ id, title, x, y, width, theme: 'atlas', style: { backgroundColor: 'bg_base', borderColor: 'text', borderWidth: 1, padding: 16 } });
		this.rows = new Stack({ id: `${id}_rows`, gap: 16, widthMode: 'fill' });
		this.addChild(this.rows);
	}

	protected addRow(text: string, content: Component): void {
		const row = new Stack({ gap: 8, widthMode: 'fill' });
		row.addChild(caption(text));
		row.addChild(content);
		this.rows.addChild(row);
	}
}

/** The sheet whole, at the window's size: table margin, neatline, tape, tabs, and a column of parts on it. */
export class AtlasSheetScene extends Panel {
	constructor({ x, y, width, fillHeight }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_atlas_sheet', x, y, width, height: fillHeight, flush: true, theme: 'atlas', style: { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0 } });
		const tabs = new SectionTabs({ id: 'atlas_sheet_tabs', tabs: SECTIONS, selectedId: 'compound' });
		const sheet = new AtlasSheet({ id: 'atlas_sheet', tabs, widthMode: 'fill', heightMode: 'fill', gap: 14 });
		const title = new Stack({ direction: 'horizontal', gap: 16, crossAlign: 'end' });
		title.addChild(new Text({ text: 'The compound', style: { fontRole: 'display', fontWeight: 700, fontSize: 30, letterSpacing: 0.16, textTransform: 'uppercase', color: 'text' } }));
		title.addChild(new Text({ text: 'day 9, dawn', style: { fontSize: 15, color: 'text_dim' } }));
		sheet.addChild(title);
		sheet.addChild(new ResourceStrip({
			id: 'atlas_sheet_resources',
			widthMode: 'fill',
			items: [
				{ kind: 'food', value: 14 },
				{ kind: 'water', value: 11, shortfall: true },
				{ kind: 'fuel', value: 6 },
				{ kind: 'scrap', value: 35 },
			],
		}));
		const body = new Stack({ direction: 'horizontal', gap: 20, widthMode: 'fill' });
		const needs = new LegendBox({ id: 'atlas_sheet_needs', title: 'Needs', widthMode: 'fill' });
		needs.addChild(new LegendRow({ symbol: 'diamond', text: 'Water runs out in 2 days' }));
		needs.addChild(new LegendRow({ symbol: 'ring', text: 'Mechanic 1 is injured, fit in 2 days' }));
		needs.addChild(new LegendRow({ symbol: 'dash', text: 'Radio: no new rumors' }));
		body.addChild(needs);
		const actions = new Stack({ gap: 12, width: 300 });
		actions.addChild(new AtlasButton({ id: 'atlas_sheet_rest', label: 'Rest a day', block: true }));
		actions.addChild(new AtlasButton({ id: 'atlas_sheet_plan', label: 'Plan a supply run', variant: 'highway', shield: true, labelSize: 24, block: true }));
		body.addChild(actions);
		sheet.addChild(body);
		this.addChild(sheet);
	}
}

export class AtlasButtonsScene extends AtlasCatalogScene {
	constructor(options: SceneFactoryOptions) {
		super({ ...options, id: 'gallery_scene_atlas_buttons', title: 'Atlas buttons' });
		const highway = (id: string, label: string, shield = false): AtlasButton => new AtlasButton({ id: `atlas_highway_${id}`, label, variant: 'highway', shield, labelSize: 22, height: 52 });
		const backRoad = (id: string): AtlasButton => new AtlasButton({ id: `atlas_back_road_${id}`, label: 'Scavenge', width: 140 });

		const hovered = highway('hover', 'Hover');
		hovered.hovered = true;
		const pressed = highway('pressed', 'Pressed');
		pressed.pressed = true;
		this.addRow('the highway: one per screen; rest, hover, pressed, focus visible, disabled', line([
			labelled(highway('rest', 'Plan a supply run', true), 'rest, with the shield'),
			labelled(hovered, 'hover'),
			labelled(pressed, 'pressed'),
			labelled(new FocusedAtlasButton({ id: 'atlas_highway_focus', label: 'Focus', variant: 'highway', labelSize: 22, height: 52 }), 'focus'),
			labelled(new AtlasButton({ id: 'atlas_highway_disabled', label: 'Disabled', variant: 'highway', labelSize: 22, height: 52, disabled: true }), 'disabled'),
		]));

		const roadHover = backRoad('hover');
		roadHover.hovered = true;
		const roadPressed = backRoad('pressed');
		roadPressed.pressed = true;
		const roadDisabled = backRoad('disabled');
		roadDisabled.enabled = false;
		this.addRow('the back road: everything secondary', line([
			labelled(backRoad('rest'), 'rest'),
			labelled(roadHover, 'hover'),
			labelled(roadPressed, 'pressed'),
			labelled(roadDisabled, 'disabled'),
		]));

		this.addRow('block: fills its column, the label at its floor of 18.66 px on the highway', line([
			new Stack({ gap: 0, width: 280 }).addChild(new AtlasButton({ id: 'atlas_highway_block', label: 'Plan a run here', variant: 'highway', labelSize: 12, block: true })),
			new Stack({ gap: 0, width: 280 }).addChild(new AtlasButton({ id: 'atlas_back_road_block', label: 'Open the bunkhouse', block: true })),
		], 24));
	}
}

export class AtlasLegendScene extends AtlasCatalogScene {
	constructor(options: SceneFactoryOptions) {
		super({ ...options, id: 'gallery_scene_atlas_legend', title: 'Legend boxes and the resource strip' });
		this.addRow('the resource strip: a shortfall in stronghold red, named under the strip', new ResourceStrip({
			id: 'atlas_legend_resources',
			widthMode: 'fill',
			items: [
				{ kind: 'food', value: 14, shortfall: true },
				{ kind: 'water', value: 11, shortfall: true },
				{ kind: 'fuel', value: 6 },
				{ kind: 'scrap', value: 35 },
				{ kind: 'meds', value: 2 },
				{ kind: 'people', value: 18 },
			],
			note: 'Water and food run out in 2 days',
		}));

		const needs = new LegendBox({ id: 'atlas_legend_needs', title: 'Needs', width: 360 });
		needs.addChild(new LegendRow({ symbol: 'diamond', text: 'Food runs out in 2 days' }));
		needs.addChild(new LegendRow({ symbol: 'diamond', text: 'Water runs out in 2 days' }));
		needs.addChild(new LegendRow({ symbol: 'ring', text: 'Mechanic 1 is injured, fit in 2 days' }));
		needs.addChild(new LegendRow({ symbol: 'dash', text: 'Radio: no new rumors' }));

		const selected = new LegendBox({ id: 'atlas_legend_selected', fresh: true, width: 360, gap: 10 });
		const head = new Stack({ direction: 'horizontal', gap: 10, crossAlign: 'center', widthMode: 'fill' });
		head.addChild(new MapGlyph({ kind: 'circled', label: '1', size: 26 }));
		head.addChild(new Text({ text: 'Bunkhouse', widthMode: 'fill', style: { fontRole: 'display', fontWeight: 700, fontSize: 24, color: 'text' } }));
		head.addChild(new Text({ text: 'Built', style: { fontRole: 'mono', fontSize: 11, textTransform: 'uppercase', color: 'text_dim' } }));
		selected.addChild(head);
		selected.addChild(new Text({ text: 'Drivers, settlers, and the Crew screen, where default decks are built.', widthMode: 'fill', wrap: 'word', style: { fontSize: 14, color: 'text' } }));
		selected.addChild(line([new DeckGlyph(), new Text({ text: '3 drivers · 3 default decks', style: { fontRole: 'mono', fontSize: 12, textTransform: 'uppercase', color: 'text_dim' } })], 8));
		selected.addChild(new AtlasButton({ id: 'atlas_legend_open', label: 'Open the bunkhouse', block: true }));

		this.addRow('the legend box, and a fresh one (W0) for the thing in focus', line([needs, selected], 24));
	}
}

export class AtlasContentsScene extends AtlasCatalogScene {
	constructor(options: SceneFactoryOptions) {
		super({ ...options, id: 'gallery_scene_atlas_contents', title: 'Contents rows' });
		const page = new Stack({ widthMode: 'fill' });
		const marks = new HandMarkLayer({ id: 'atlas_contents_marks', place: 'under' });
		page.addChild(marks);
		page.addChild(new ContentsRow({ id: 'atlas_contents_continue', variant: 'primary', lead: { glyph: '9' }, label: 'Continue', subtitle: 'Day 9 · 3 drivers · 1 stronghold taken', value: 'DAY 09' }));
		page.addChild(new ContentsRow({ id: 'atlas_contents_new', lead: { glyph: '1' }, label: 'New campaign', value: 'DAY 01' }));
		const history = new ContentsRow({ id: 'atlas_contents_history', lead: { glyph: 'H' }, label: 'Campaign history', value: 'PAST RUNS' });
		page.addChild(history);
		marks.highlight(history);
		this.addRow('primary, standard, and one highlighted by hand', page);

		const faded = new ContentsRow({ id: 'atlas_contents_faded', variant: 'primary', lead: { glyph: '' }, label: 'Continue', subtitle: 'No campaign in progress', value: 'NO SAVE', faded: true });
		this.addRow('faded print: in its place, with why', faded);

		const appendix = new Stack({ direction: 'horizontal', gap: 30, widthMode: 'fill' });
		const left = new Stack({ widthMode: 'fill' });
		left.addChild(new ContentsRow({ id: 'atlas_contents_skirmish', variant: 'compact', label: 'Skirmish', value: 'A' }));
		left.addChild(new ContentsRow({ id: 'atlas_contents_settings', variant: 'compact', label: 'Settings', value: 'B' }));
		const right = new Stack({ widthMode: 'fill' });
		right.addChild(new ContentsRow({ id: 'atlas_contents_cards', variant: 'compact', lead: 'deck', label: 'Card showcase', value: 'C' }));
		right.addChild(new ContentsRow({ id: 'atlas_contents_credits', variant: 'compact', label: 'Credits', value: 'D' }));
		appendix.addChild(left);
		appendix.addChild(right);
		this.addRow('compact, for the appendices', appendix);
	}
}

export class AtlasGaugesScene extends AtlasCatalogScene {
	constructor(options: SceneFactoryOptions) {
		super({ ...options, id: 'gallery_scene_atlas_gauges', title: 'Gauges' });
		this.addRow('the scale bar: alternating ink and paper', line([
			new ScaleBar({ id: 'atlas_scale_map', segments: 3, width: 102, height: 7 }),
			new Text({ text: '0 · 20 mi', style: { fontRole: 'mono', fontSize: 11, color: 'text' } }),
		], 8));
		this.addRow('as a count: stores, 6 of 10', new ScaleBar({ id: 'atlas_scale_count', segments: 10, value: 0.6, width: 240, height: 10 }));
		this.addRow('the splash loader: Highway on a Casing frame', line([
			new ScaleBar({ id: 'atlas_scale_loader', segments: 10, value: 0.4, tone: 'highway', width: 320, height: 12 }),
			new Text({ text: 'Unfolding the map 40%', style: { fontRole: 'mono', fontSize: 11, letterSpacing: 0.14, textTransform: 'uppercase', color: 'text_dim' } }),
		], 12));
		this.addRow('the cased bar: each driver\'s colour on its casing', line([
			new CasedBar({ id: 'atlas_cased_a', value: 0.7, driver: 'a', width: 240 }),
			new CasedBar({ id: 'atlas_cased_b', value: 0.35, driver: 'b', width: 240 }),
		], 24));
	}
}

export class AtlasGlyphsScene extends AtlasCatalogScene {
	constructor(options: SceneFactoryOptions) {
		super({ ...options, id: 'gallery_scene_atlas_glyphs', title: 'Map glyphs and decks' });
		this.addRow('circled numbers and letters, the highway shield, the stronghold diamond, the star, the legend\'s ring and dash', line([
			new MapGlyph({ kind: 'circled', label: '1' }),
			new MapGlyph({ kind: 'circled', label: 'H' }),
			new MapGlyph({ kind: 'shield', label: '9', size: 40 }),
			new MapGlyph({ kind: 'shield', arrow: true, tone: 'paper', size: 40 }),
			new MapGlyph({ kind: 'diamond', size: 20 }),
			new MapGlyph({ kind: 'star', size: 28 }),
			new MapGlyph({ kind: 'ring', size: 20 }),
			new MapGlyph({ kind: 'dash', size: 20 }),
			new MapGlyph({ kind: 'circled', label: '2', faded: true }),
		]));
		this.addRow('the deck glyph, and the two decks set down: A always orange, B always teal', line([
			new DeckGlyph(),
			new DeckStack({ id: 'atlas_deck_a', driver: 'a', width: 72 }),
			new DeckStack({ id: 'atlas_deck_b', driver: 'b', width: 72, edges: 4 }),
		], 32));
	}
}

export class AtlasPlateScene extends AtlasCatalogScene {
	constructor(options: SceneFactoryOptions) {
		super({ ...options, id: 'gallery_scene_atlas_plate', title: 'Plates and the hand' });
		const plate = new PlateFrame({ id: 'atlas_plate', caption: 'Plate 1 · The compound from above, at dawn', width: 420, height: 240 });
		const yard = new Stack({ id: 'atlas_plate_yard', widthMode: 'fill', heightMode: 'fill', padding: 28, style: { backgroundColor: 'built_up' } });
		const place = new Stack({ id: 'atlas_plate_bunkhouse', direction: 'horizontal', gap: 6, crossAlign: 'center' });
		place.addChild(new MapGlyph({ kind: 'circled', label: '1', size: 28 }));
		place.addChild(new Text({ text: 'Bunkhouse', style: { fontRole: 'display', fontWeight: 700, fontSize: 22, color: 'text' } }));
		yard.addChild(place);
		const loops = new HandMarkLayer({ id: 'atlas_plate_marks' });
		yard.addChild(loops);
		loops.loop(place);
		plate.addChild(yard);

		const orders = new LegendBox({ id: 'atlas_plate_orders', title: 'The day', width: 340 });
		const marks = new HandMarkLayer({ id: 'atlas_plate_highlights', place: 'under' });
		orders.addChild(marks);
		orders.addChild(new LegendRow({ text: 'Rest a day: the compound eats 5 food and 5 water' }));
		const scavenge = new LegendRow({ text: 'Scavenge: 2 fuel and 12 scrap' });
		orders.addChild(scavenge);
		marks.highlight(scavenge);

		this.addRow('a plate with its caption, a grease loop round the selected place; a highlighter under the chosen order', line([plate, orders], 28));
	}
}
