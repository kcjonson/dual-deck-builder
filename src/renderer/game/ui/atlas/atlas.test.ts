/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import type { Component } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { Stack } from '../../../engine/components/Stack';
import { createTestContext } from '../../../engine/components/testing';
import type { CircleCommand, DrawCommand, PolygonCommand, RectCommand, TextCommand } from '../../../engine/draw';
import type { RGBA } from '../../../engine/draw/geometry';
import { isSingleOutline } from '../../../engine/draw/triangulate';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../../engine/text/testing';
import { themes, tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import { drawAtlasArt } from './atlasArt';
import { AtlasButton } from './AtlasButton';
import { AtlasSheet } from './AtlasSheet';
import { ATLAS, atlasInks } from './atlasStyle';
import { ContentsRow } from './ContentsRow';
import { CasedBar, ScaleBar } from './gauges';
import { HandMarkLayer } from './HandMarkLayer';
import { LegendBox, LegendRow } from './LegendBox';
import { MapGlyph } from './mapGlyphs';
import { ResourceStrip } from './ResourceStrip';
import { SectionTabs } from './SectionTabs';

const atlas = themes.atlas;
const ink = atlas.color.text;

let context: MountContext;
let backend: MeasuringRecordingBackend;
let root: Container;

beforeEach(() => {
	const measuring = createMeasuringDrawApi();
	backend = measuring.backend;
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
	root = new Container({ id: 'root', width: 1024, height: 600, theme: 'atlas' });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
});

function add<T extends Component>(component: T): T {
	root.addChild(component);
	context.frame.layout();
	return component;
}

function draws(subject: Component = root): readonly DrawCommand[] {
	const api = context.draw;
	api.beginFrame({ viewport: { width: 1024, height: 600 } });
	renderTree(subject, api);
	api.endFrame();
	return backend.commands;
}

function rects(subject?: Component): RectCommand[] {
	return draws(subject).filter((command): command is RectCommand => command.kind === 'rect');
}

/** Commands copy colours at submission, so a colour is compared by value. */
function same(a: RGBA | null | undefined, b: RGBA): boolean {
	return !!a && a.length === b.length && a.every((channel, index) => channel === b[index]);
}

function press(key: string): void {
	context.dispatcher.enqueue({ kind: 'key', phase: 'down', key, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.enqueue({ kind: 'key', phase: 'up', key, repeat: false, modifiers: NO_MODIFIERS });
	context.dispatcher.dispatchPending();
}

describe('atlas inks', () => {
	it('resolves the spec palette from the atlas theme', () => {
		const inks = atlasInks(atlas);
		expect(inks.ink).toEqual(atlas.color.text);
		expect(inks.highway).toEqual(atlas.color.accent);
		expect(inks.casing).toEqual(atlas.color.accent_dim);
		expect(inks.focusRing).toEqual(ink);
		expect(inks.backRoad).toEqual(atlas.color.back_road);
		expect(inks.drivers.b.casing).toEqual(atlas.color.driver_b_casing);
		expect(atlasInks(atlas)).toBe(inks);
	});

	it('keeps the dark theme\'s accent edge and focus ring on the accent', () => {
		expect(tokens.color.accent_edge).toEqual(tokens.color.accent);
		expect(tokens.color.focus_ring).toEqual(tokens.color.accent);
		expect(atlas.color.accent_edge).toEqual(atlas.color.accent_dim);
	});
});

describe('the engine Button on an atlas screen (DDB-502 review)', () => {
	it('borders the accent in Casing and rings focus in ink there, and is unchanged in the dark', () => {
		const onAtlas = add(new Button({ id: 'atlas_accent', label: 'Go', tone: 'accent', width: 120 }));
		const dark = new Button({ id: 'dark_accent', label: 'Go', tone: 'accent', width: 120 });
		const darkRoot = new Container({ width: 200, height: 100 });
		darkRoot.addChild(dark);
		darkRoot.mount(context);
		context.frame.layout();
		expect(onAtlas.look.border).toEqual(atlas.color.accent_dim);
		expect(dark.look.border).toEqual(tokens.color.accent);
		onAtlas.setFocusState(true, true);
		dark.setFocusState(true, true);
		expect(onAtlas.look.focusRing).toEqual(ink);
		expect(dark.look.focusRing).toEqual(tokens.color.accent);
		darkRoot.unmount();
	});
});

describe('AtlasButton', () => {
	it('resolves from the theme it is inserted under', () => {
		const button = new AtlasButton({ id: 'go', label: 'Plan a run', variant: 'highway', width: 220 });
		expect(button.look.fill).toEqual(tokens.color.accent);
		add(button);
		expect(button.look.fill).toEqual(atlas.color.accent);
		expect(button.look.border).toEqual(atlas.color.accent_dim);
		expect(button.look.text).toEqual(atlas.color.accent_contrast);
	});

	it('draws the highway: the Casing offset beneath, the face with a 4 px Casing border', () => {
		const button = add(new AtlasButton({ id: 'go', label: 'Plan a run', variant: 'highway', width: 220, height: 60 }));
		const drawn = rects(button);
		expect(drawn[0]).toMatchObject({ fill: atlas.color.accent_dim, rect: { y: ATLAS.highwayOffset, height: 60 - ATLAS.highwayOffset } });
		expect(drawn[1]).toMatchObject({ id: 'go', fill: atlas.color.accent, border: { color: atlas.color.accent_dim, width: ATLAS.highwayBorder }, rect: { y: 0 } });
	});

	it('lifts 1 px with an ink border on hover, and collapses the offset when pressed', () => {
		const button = add(new AtlasButton({ id: 'go', label: 'Plan a run', variant: 'highway', width: 220 }));
		button.hovered = true;
		context.frame.update(1);
		let face = rects(button).find((command) => command.id === 'go');
		expect(face).toMatchObject({ rect: { y: -ATLAS.hoverLift }, border: { color: ink } });
		button.hovered = false;
		button.pressed = true;
		context.frame.update(1);
		const drawn = rects(button);
		face = drawn.find((command) => command.id === 'go');
		expect(face).toMatchObject({ rect: { y: ATLAS.highwayOffset } });
		expect(drawn.filter((command) => same(command.fill, atlas.color.accent_dim) && command.id === undefined)).toHaveLength(0);
	});

	it('rings focus in ink, 2 px wide and 3 px out', () => {
		const button = add(new AtlasButton({ id: 'go', label: 'Rest', width: 160 }));
		button.setFocusState(true, true);
		context.frame.update(1);
		const ring = rects(button).find((command) => command.border?.position === 'outside');
		expect(ring).toMatchObject({ border: { color: ink, width: ATLAS.focusRingWidth }, rect: { x: -ATLAS.focusRingGap } });
		expect(button.drawsWalkFocusRing).toBe(false);
	});

	it('is faded print with a dashed border when disabled, and takes no focus', () => {
		const button = add(new AtlasButton({ id: 'go', label: 'Plan a run', variant: 'highway', width: 220, disabled: true }));
		const drawn = draws(button);
		const polygons = drawn.filter((command): command is PolygonCommand => command.kind === 'polygon');
		expect(polygons.some((command) => same(command.fill, atlas.color.text_disabled))).toBe(true);
		const text = drawn.find((command): command is TextCommand => command.kind === 'text');
		expect(text?.color).toEqual(atlas.color.text_disabled);
		expect(button.canReceiveFocus()).toBe(false);
	});

	it('keeps the highway label at 18.66 px or more, and every button 44 px tall or more', () => {
		const small = add(new AtlasButton({ label: 'Go', variant: 'highway', labelSize: 12, height: 30, width: 120 }));
		const text = draws(small).find((command): command is TextCommand => command.kind === 'text');
		expect(text?.size).toBe(ATLAS.highwayLabelMin);
		expect(small.height).toBe(ATLAS.minHit);
	});

	it('presses from the keyboard', () => {
		let clicks = 0;
		add(new AtlasButton({ label: 'Rest', width: 160, onClick: () => clicks++ }));
		press('Tab');
		press('Enter');
		press(' ');
		expect(clicks).toBe(2);
	});
});

describe('SectionTabs', () => {
	const specs = [
		{ id: 'menu', label: 'Menu' },
		{ id: 'compound', label: 'Compound' },
		{ id: 'locked', label: 'Locked', disabled: true },
		{ id: 'crew', label: 'Crew', deck: true },
	];

	it('raises the open section 4 px and draws it in fresh paper with an ink label', () => {
		const tabs = add(new SectionTabs({ tabs: specs, selectedId: 'compound' }));
		const [menu, compound] = tabs.tabs;
		expect(compound.height - menu.height).toBe(ATLAS.tabRaise);
		expect(compound.look.fill).toEqual(atlas.color.bg_panel_raised);
		expect(compound.look.text).toEqual(ink);
		expect(menu.look.fill).toEqual(atlas.color.bg_inset);
		expect(menu.look.text).toEqual(atlas.color.text_dim);
		expect(menu.width).toBeGreaterThan(0);
	});

	it('moves focus and selection with the arrows, Home and End, past a disabled tab, wrapping', () => {
		const chosen: string[] = [];
		const tabs = add(new SectionTabs({ tabs: specs, onSelect: (id) => chosen.push(id) }));
		expect(tabs.selectedId).toBe('menu');
		press('Tab');
		expect(tabs.tabs[0].focused).toBe(true);
		press('ArrowRight');
		press('ArrowRight');
		expect(tabs.selectedId).toBe('crew');
		press('ArrowRight');
		expect(tabs.selectedId).toBe('menu');
		press('End');
		press('Home');
		expect(chosen).toEqual(['compound', 'crew', 'menu', 'crew', 'menu']);
	});

	it('selects on activate, and never fires for the tab already open', () => {
		const chosen: string[] = [];
		const tabs = add(new SectionTabs({ tabs: specs, selectedId: 'menu', onSelect: (id) => chosen.push(id) }));
		press('Tab');
		press('Enter');
		expect(chosen).toEqual([]);
		tabs.selectedId = 'locked';
		expect(tabs.selectedId).toBeNull();
	});
});

describe('AtlasSheet', () => {
	it('fills its box, draws the table, the sheet inside the margin, and the double neatline', () => {
		const tabs = new SectionTabs({ tabs: [{ id: 'a', label: 'Menu' }] });
		const sheet = add(new AtlasSheet({ id: 'sheet', tabs, width: 1024, height: 600 }));
		const margin = tokens.space.sheet_margin;
		expect(sheet.sheet).toEqual({ x: margin, y: margin, width: 1024 - margin * 2, height: 600 - margin * 2 });
		const drawn = rects(sheet);
		expect(drawn[0]).toMatchObject({ fill: atlas.color.bg_void, rect: { width: 1024, height: 600 } });
		expect(drawn[1]).toMatchObject({ fill: atlas.color.bg_base, rect: { x: margin } });
		const rules = drawn.filter((command) => same(command.border?.color, ink));
		expect(rules.map((command) => command.border?.width)).toEqual([ATLAS.neatlineOuter, ATLAS.neatlineInner]);
		expect(rules[1].rect.x - rules[0].rect.x).toBe(ATLAS.neatlineGap);
		expect(tabs.y).toBe(0);
		expect(tabs.x).toBe(Math.round((1024 - tabs.width) / 2));
	});

	it('flows its content inside the neatline', () => {
		const sheet = new AtlasSheet({ width: 1024, height: 600 });
		const child = new Stack({ width: 100, height: 20 });
		sheet.addChild(child);
		add(sheet);
		const inset = tokens.space.sheet_margin + ATLAS.neatlineInset + ATLAS.neatlineGap + ATLAS.sheetPadding;
		expect(child.placedX).toBe(inset);
		expect(child.placedY).toBe(inset);
	});
});

describe('LegendBox', () => {
	it('draws paper, the ink border, the inner rule 6 px in, and a hairline over each row', () => {
		const box = new LegendBox({ id: 'needs', title: 'Needs', width: 320 });
		box.addChild(new LegendRow({ symbol: 'diamond', text: 'Food runs out in 2 days' }));
		box.addChild(new LegendRow({ symbol: 'dash', text: 'Radio: no new rumors' }));
		add(box);
		const drawn = rects(box);
		expect(drawn[0]).toMatchObject({ id: 'needs', fill: atlas.color.bg_panel });
		expect(drawn[1]).toMatchObject({ border: { color: ink, width: ATLAS.legendBorder } });
		expect(drawn[2]).toMatchObject({ border: { width: ATLAS.legendRule }, rect: { x: ATLAS.legendRuleInset } });
		expect(drawn.filter((command) => same(command.fill, atlas.color.line_hairline))).toHaveLength(2);
		expect(box.title).toBe('Needs');
	});

	it('uses fresh paper for the thing in focus', () => {
		const box = add(new LegendBox({ fresh: true, width: 200 }));
		expect(rects(box)[0].fill).toEqual(atlas.color.bg_panel_raised);
	});
});

describe('ContentsRow', () => {
	it('leads with a shield on the primary row, and draws leaders between label and value', () => {
		const column = new Stack({ width: 600 });
		const row = new ContentsRow({ id: 'continue', variant: 'primary', lead: { glyph: '9' }, label: 'Continue', value: 'DAY 09' });
		column.addChild(row);
		add(column);
		const drawn = draws(row);
		const shield = drawn.find((command): command is PolygonCommand => command.kind === 'polygon');
		expect(shield?.fill).toEqual(atlas.color.accent);
		const dots = drawn.filter((command): command is RectCommand => command.kind === 'rect' && same(command.fill, atlas.color.text_disabled));
		expect(dots.length).toBeGreaterThan(10);
		expect(row.drawnText).toBeNull();
	});

	it('circles a standard row\'s number, and fades a row out of reach', () => {
		const column = new Stack({ width: 600 });
		const row = new ContentsRow({ lead: { glyph: '1' }, label: 'New campaign', value: 'DAY 01' });
		column.addChild(row);
		add(column);
		const circle = draws(row).find((command): command is CircleCommand => command.kind === 'circle');
		expect(circle?.border?.color).toEqual(ink);
		row.faded = true;
		expect(row.enabled).toBe(false);
		expect(row.canReceiveFocus()).toBe(false);
		const faded = draws(row).find((command): command is CircleCommand => command.kind === 'circle');
		expect(faded?.border?.color).toEqual(atlas.color.text_disabled);
	});

	it('activates from the keyboard', () => {
		let opened = 0;
		const column = new Stack({ width: 600 });
		column.addChild(new ContentsRow({ label: 'Settings', variant: 'compact', value: 'B', onClick: () => opened++ }));
		add(column);
		press('Tab');
		press('Enter');
		expect(opened).toBe(1);
	});
});

describe('ResourceStrip', () => {
	it('turns a shortfall stronghold red and names it under the strip', () => {
		const strip = add(new ResourceStrip({ width: 600, items: [{ kind: 'food', value: 14 }, { kind: 'water', value: 3, shortfall: true }], note: 'Water runs out in 2 days' }));
		expect(strip.item('food')?.ink).toEqual(ink);
		expect(strip.item('water')?.ink).toEqual(atlas.color.status_crit);
		expect(strip.note).toBe('Water runs out in 2 days');
		const water = strip.item('water');
		if (!water) throw new Error('no water');
		water.shortfall = false;
		water.value = 7;
		expect(water.ink).toEqual(ink);
		strip.note = null;
		expect(strip.note).toBeNull();
	});
});

describe('gauges', () => {
	it('alternates a scale bar and fills a count from the left', () => {
		const scale = add(new ScaleBar({ segments: 4 }));
		expect([0, 1, 2, 3].map((index) => scale.isFilled(index))).toEqual([true, false, true, false]);
		scale.value = 0.5;
		expect([0, 1, 2, 3].map((index) => scale.isFilled(index))).toEqual([true, true, false, false]);
		expect(scale.filled).toBe(2);
	});

	it('fills a cased bar in the driver\'s colour on its casing', () => {
		const bar = add(new CasedBar({ value: 0.5, driver: 'b', width: 200, height: 10 }));
		const drawn = rects(bar);
		expect(drawn[0].fill).toEqual(atlas.color.driver_b_casing);
		expect(drawn[2].fill).toEqual(atlas.color.driver_b);
		expect(drawn[2].rect.width).toBeCloseTo(drawn[1].rect.width / 2);
	});
});

describe('MapGlyph', () => {
	it('prints a diamond in stronghold red and a star in ink, and re-resolves on a theme change', () => {
		const diamond = new MapGlyph({ kind: 'diamond', size: 14 });
		expect(diamond.glyphColors.fill).toEqual(tokens.color.status_crit);
		add(diamond);
		expect(diamond.glyphColors.fill).toEqual(atlas.color.status_crit);
		expect(add(new MapGlyph({ kind: 'star' })).glyphColors.fill).toEqual(ink);
	});

	it('fills every outline as one simple polygon, so each keeps its anti-aliasing feather (R5.17)', () => {
		for (const kind of ['shield', 'diamond', 'star'] as const) {
			const glyph = add(new MapGlyph({ kind, size: 30 }));
			const polygon = draws(glyph).find((command): command is PolygonCommand => command.kind === 'polygon');
			if (!polygon) throw new Error(`${kind} drew no polygon`);
			expect(isSingleOutline(polygon.points, polygon.indices ?? [])).toBe(true);
		}
	});
});

describe('HandMarkLayer', () => {
	it('stacks under or over its siblings, takes no hits, and follows its target', () => {
		const column = new Stack({ width: 400, padding: 10 });
		const under = new HandMarkLayer({ place: 'under' });
		const over = new HandMarkLayer();
		const first = new Stack({ width: 300, height: 40 });
		const second = new Stack({ width: 300, height: 40 });
		column.addChild(under);
		column.addChild(over);
		column.addChild(first);
		column.addChild(second);
		add(column);
		expect(under.zIndex).toBe(-1);
		expect(over.zIndex).toBe(1);
		expect(under.pointerEvents).toBe('none');
		const mark = under.highlight(second);
		expect(under.markRect(mark)).toMatchObject({ x: 0, y: 40, width: 300, height: 40 });
		const swipe = rects(under).find((command) => same(command.fill, atlas.color.bg_selection));
		expect(swipe?.rect.y).toBeGreaterThan(40);
		const loop = over.loop({ x: 0, y: 0, width: 50, height: 20 });
		expect(draws(over).some((command) => command.kind === 'polyline')).toBe(true);
		over.remove(loop);
		expect(over.marks).toHaveLength(0);
		expect(under.highlight(first).variant).not.toBe(mark.variant);
	});
});

describe('drawAtlasArt', () => {
	it('draws a surface as a flat tint and reports that no art was drawn, until the art atlas lands', () => {
		const api = context.draw;
		api.beginFrame({ viewport: { width: 100, height: 100 } });
		const rect = { x: 0, y: 0, width: 10, height: 10 };
		expect(drawAtlasArt(api, { name: 'paper_w1_a', rect, tint: ink })).toBe(false);
		expect(drawAtlasArt(api, { name: 'tape_a', rect, tint: ink })).toBe(false);
		api.endFrame();
		expect(backend.commands.filter((command) => command.kind === 'rect')).toHaveLength(1);
	});
});
