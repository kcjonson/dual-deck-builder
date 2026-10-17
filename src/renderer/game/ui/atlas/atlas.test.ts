/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import type { Component } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import { renderTree } from '../../../engine/components/renderTree';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { createTestContext } from '../../../engine/components/testing';
import type { CircleCommand, DrawCommand, PolygonCommand, RectCommand, TextCommand } from '../../../engine/draw';
import type { RGBA } from '../../../engine/draw/geometry';
import { isSingleOutline } from '../../../engine/draw/triangulate';
import { NO_MODIFIERS } from '../../../engine/input/events';
import { createMeasuringDrawApi, MeasuringRecordingBackend } from '../../../engine/text/testing';
import { themes, tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import { Checkbox } from '../../../engine/ui/Checkbox';
import { Scrollbar } from '../../../engine/ui/Scrollbar';
import { SegmentedControl } from '../../../engine/ui/SegmentedControl';
import { Select } from '../../../engine/ui/Select';
import { Slider } from '../../../engine/ui/Slider';
import { TabBar } from '../../../engine/ui/TabBar';
import { Toggle } from '../../../engine/ui/Toggle';
import { drawAtlasArt, paperPiece } from './atlasArt';
import { AtlasButton } from './AtlasButton';
import { AtlasSheet } from './AtlasSheet';
import { ATLAS, DISPLAY_BOLD, atlasInks } from './atlasStyle';
import { AtlasTag } from './AtlasTag';
import { resolveFont } from '../../../engine/text/fontRoles';
import { ContentsRow } from './ContentsRow';
import { DeckFan, DeckStack } from './deck';
import { DamageMark, damagePiece } from './DamageMark';
import { uiArtSize } from '../../art/uiArt';
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

describe('atlas type', () => {
	it('draws its heads, labels, and tabs in the display 700 face, asked for by weight', () => {
		expect(DISPLAY_BOLD).toBe('display-700');
		const button = add(new AtlasButton({ label: 'Plan a run', variant: 'highway', width: 200 }));
		expect(draws(button).find((command): command is TextCommand => command.kind === 'text')?.font).toBe('display-700');
		const tabs = add(new SectionTabs({ tabs: [{ id: 'a', label: 'Menu' }] }));
		expect(draws(tabs).find((command): command is TextCommand => command.kind === 'text')?.font).toBe('display-700');
		const box = add(new LegendBox({ title: 'Needs', width: 300 }));
		expect(draws(box).find((command): command is TextCommand => command.kind === 'text' && command.text === 'Needs')?.font).toBe('display-700');
		const column = new Stack({ width: 500 });
		const row = new ContentsRow({ label: 'Settings', value: 'B' });
		column.addChild(row);
		add(column);
		expect(draws(row).find((command): command is TextCommand => command.kind === 'text' && command.text === 'Settings')?.font).toBe('display-700');
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
		// The face keeps its laid-out rect; the lift is a translation, so no geometry is rebuilt per frame.
		expect(face).toMatchObject({ rect: { y: 0 }, border: { color: ink } });
		expect(face?.transform[5]).toBe(-ATLAS.hoverLift);
		button.hovered = false;
		button.pressed = true;
		context.frame.update(1);
		const drawn = rects(button);
		face = drawn.find((command) => command.id === 'go');
		expect(face?.rect.y).toBe(0);
		expect(face?.transform[5]).toBe(ATLAS.highwayOffset);
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

	it('sets the highway label at the left with the shield at the right, or centred on request', () => {
		const label = (button: AtlasButton): TextCommand | undefined => draws(button).find((command): command is TextCommand => command.kind === 'text');
		const start = add(new AtlasButton({ label: 'Plan a supply run', variant: 'highway', shield: true, width: 320 }));
		const text = label(start);
		expect(text?.align).toBe('left');
		expect(text?.box?.x).toBe(20);
		const shield = draws(start).find((command): command is PolygonCommand => command.kind === 'polygon');
		const shieldLeft = Math.min(...(shield?.points ?? []).map((point) => point.x));
		expect(shieldLeft).toBeGreaterThan(320 / 2);
		expect((text?.box?.x ?? 0) + (text?.box?.width ?? 0)).toBeLessThanOrEqual(shieldLeft);
		expect(label(add(new AtlasButton({ label: 'Plan', variant: 'highway', labelAlign: 'center', width: 200 })))?.align).toBe('center');
		expect(label(add(new AtlasButton({ label: 'Rest', width: 200 })))?.align).toBe('center');
	});

	describe('the back road', () => {
		function road(): AtlasButton {
			return add(new AtlasButton({ id: 'road', label: 'Scavenge', width: 160 }));
		}

		it('rests on fresh paper with a 1.6 px back-road border and a 1 px inner rule 3 px in', () => {
			const drawn = rects(road());
			expect(drawn.find((command) => command.id === 'road')).toMatchObject({
				fill: atlas.color.bg_panel_raised,
				border: { color: atlas.color.back_road, width: ATLAS.backRoadBorder },
				rect: { y: 0 },
			});
			const inset = ATLAS.backRoadBorder + ATLAS.backRoadRuleInset;
			expect(drawn.find((command) => command.border?.width === ATLAS.backRoadRule)).toMatchObject({ border: { color: atlas.color.line_hairline }, rect: { x: inset, y: inset } });
			expect(drawn.some((command) => same(command.fill, atlas.color.accent_dim))).toBe(false);
		});

		it('lifts with an ink border on hover, and sinks a pixel with a wash when pressed', () => {
			const button = road();
			button.hovered = true;
			context.frame.update(1);
			let face = rects(button).find((command) => command.id === 'road');
			expect(face?.border?.color).toEqual(ink);
			expect(face?.transform[5]).toBe(-ATLAS.hoverLift);
			button.hovered = false;
			button.pressed = true;
			context.frame.update(1);
			face = rects(button).find((command) => command.id === 'road');
			expect(face?.border?.color).toEqual(ink);
			expect(face?.transform[5]).toBe(ATLAS.hoverLift);
			expect(face?.fill).not.toEqual(atlas.color.bg_panel_raised);
		});

		it('rings focus in ink outside, and is faded print with a dashed border and no inner rule when disabled', () => {
			const button = road();
			button.setFocusState(true, true);
			context.frame.update(1);
			expect(rects(button).find((command) => command.border?.position === 'outside')?.border?.color).toEqual(ink);
			button.enabled = false;
			context.frame.update(1);
			const drawn = draws(button);
			expect(drawn.some((command) => command.kind === 'polygon' && same(command.fill, atlas.color.text_disabled))).toBe(true);
			expect(drawn.some((command) => command.kind === 'rect' && command.border?.width === ATLAS.backRoadRule)).toBe(false);
			expect(drawn.some((command) => command.kind === 'rect' && command.border?.position === 'outside')).toBe(false);
			expect(drawn.find((command): command is TextCommand => command.kind === 'text')?.color).toEqual(atlas.color.text_disabled);
		});
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

	it('names each tab after the row and its own id', () => {
		const tabs = add(new SectionTabs({ id: 'sections', tabs: specs }));
		expect(tabs.tabs.map((tab) => tab.id)).toEqual(['sections.menu', 'sections.compound', 'sections.locked', 'sections.crew']);
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

	it('names its tabs after itself when it has an id', () => {
		const named = add(new SectionTabs({ id: 'crew_tabs', tabs: specs }));
		expect(named.tabs.map((tab) => tab.id)).toEqual(['crew_tabs.menu', 'crew_tabs.compound', 'crew_tabs.locked', 'crew_tabs.crew']);
		const unnamed = add(new SectionTabs({ tabs: specs }));
		expect(unnamed.tabs[0].id).toBeNull();
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

	it('follows a theme change after mount, its tabs too', () => {
		const tabs = new SectionTabs({ tabs: [{ id: 'a', label: 'Menu' }, { id: 'b', label: 'Crew' }] });
		const sheet = add(new AtlasSheet({ tabs, width: 1024, height: 600 }));
		root.theme = null;
		context.frame.layout();
		const drawn = rects(sheet);
		expect(drawn[0].fill).toEqual(tokens.color.bg_void);
		expect(drawn[1].fill).toEqual(tokens.color.bg_base);
		expect(tabs.tabs[0].look.fill).toEqual(tokens.color.bg_panel_raised);
		root.theme = 'atlas';
		expect(rects(sheet)[1].fill).toEqual(atlas.color.bg_base);
	});

	it('takes W3 and its hero mark for an event shown after mount, and settles back to W2 (DDB-511)', () => {
		const sheet = add(new AtlasSheet({ width: 1024, height: 600 }));
		expect(sheet.surfacePiece).toBe('paper_w2_a');
		sheet.wear = 3;
		sheet.paper = 'b';
		context.frame.layout();
		expect([sheet.wear, sheet.paper, sheet.surfacePiece]).toEqual([3, 'b', 'paper_w3_b']);
		sheet.wear = 2;
		context.frame.layout();
		expect(sheet.surfacePiece).toBe('paper_w2_b');
	});

	it('tapes a burnt sheet on the other diagonal, so no tape pins the burnt corner (DDB-511)', () => {
		const sheet = add(new AtlasSheet({ width: 1024, height: 600 }));
		const tapeCentres = (): number[][] => rects(sheet).filter((command) => same(command.fill, atlas.color.duct_tape)).map((command) => [command.transform[4], command.transform[5]]);
		const [start, end] = tapeCentres();
		expect([start[0] < 512, start[1] < 300, end[0] > 512, end[1] > 300]).toEqual([true, true, true, true]);
		sheet.wear = 3;
		context.frame.layout();
		expect(sheet.surfacePiece).toBe('paper_w3_a');
		const [burntStart, burntEnd] = tapeCentres();
		expect([burntStart[0] > 512, burntStart[1] < 300, burntEnd[0] < 512, burntEnd[1] > 300]).toEqual([true, true, true, true]);
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

	it('clears its content and keeps its tabs', () => {
		const tabs = new SectionTabs({ tabs: [{ id: 'a', label: 'Menu' }] });
		const sheet = add(new AtlasSheet({ tabs, width: 1024, height: 600 }));
		sheet.addChild(new Stack({ id: 'page', width: 100, height: 20 }));
		sheet.clearContent();
		expect(sheet.children).toEqual([tabs]);
		expect(sheet.tabs).toBe(tabs);
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

	it('names the line of a row after the row, and inks it as asked', () => {
		const row = add(new LegendRow({ id: 'need', symbol: 'diamond', text: 'Food runs out tonight', color: 'status_crit' }));
		expect(row.findById('need_text')).not.toBeNull();
		expect(row.color).toEqual(atlas.color.status_crit);
		row.color = 'text';
		expect(row.color).toEqual(ink);
		expect(add(new LegendRow({ symbol: 'dash', text: 'Radio: no new rumors' })).color).toEqual(atlas.color.text_faint);
		const counted = add(new LegendRow({ id: 'poi', text: 'Hospital', value: 'tier 2' }));
		expect([counted.value, counted.findById('poi_value') !== null, counted.findById('poi_text') !== null]).toEqual(['tier 2', true, true]);
		const named = add(new LegendRow({ id: 'row', text: 'Clinic', value: '1', textId: 'clinic', valueId: 'clinic_count' }));
		expect([named.findById('clinic') !== null, named.findById('clinic_count') !== null, named.findById('row_text')]).toEqual([true, true, null]);
	});

	it('sets a ledger row\'s value at the right in mono 500, and its line and value take ids (DDB-511)', () => {
		const box = new LegendBox({ title: 'Campaign record', width: 320 });
		const row = new LegendRow({ id: 'days', text: 'Days held', value: '9 days', textId: 'days_label', valueId: 'days_value' });
		box.addChild(row);
		add(box);
		const value = row.findById('days_value');
		const line = row.findById('days_label');
		if (!value || !line) throw new Error('the row should carry its line and value');
		expect([row.text, row.value]).toEqual(['Days held', '9 days']);
		expect(value.placedX + value.width).toBe(row.width);
		expect(line.placedX + line.width).toBeLessThanOrEqual(value.placedX);
		const valueRun = draws(row).find((command): command is TextCommand => command.kind === 'text' && command.text === '9 days');
		expect(valueRun?.font).toBe(resolveFont({ family: 'mono', weight: 500 }));
		expect(new LegendRow({ id: 'radio', text: 'Radio: no new rumors' }).findById('radio_text')).not.toBeNull();
		expect(new LegendRow({ text: 'Radio: no new rumors' }).value).toBeNull();
	});

	it('sets its head further in than its padding by the head indent, and its content below it', () => {
		const box = new LegendBox({ title: 'Locker', padding: 8, headIndent: 4, gap: 0, width: 320 });
		const content = new Stack({ width: 100, height: 20 });
		box.addChild(content);
		add(box);
		const head = box.children.find((child): child is Text => child instanceof Text && child.isPart);
		expect([head?.placedX, head?.placedY]).toEqual([12, 12]);
		expect([content.placedX, content.placedY]).toEqual([8, 12 + 24]);
	});

	it('names the body line of a row when asked', () => {
		const row = add(new LegendRow({ text: 'No campaign has ended yet.', symbol: 'dash', textId: 'history_empty' }));
		expect(row.findById('history_empty')).not.toBeNull();
	});

	it('names the text and value of a row after it by default, and sets the value in mono at the right', () => {
		const row = add(new LegendRow({ id: 'need', text: 'Water runs out', symbol: 'diamond', value: '2 DAYS' }));
		expect((row.findById('need_text') as Text | null)?.text).toBe('Water runs out');
		const value = row.findById('need_value') as Text | null;
		expect([value?.text, row.children[row.children.length - 1]]).toEqual(['2 DAYS', value]);
		row.value = '1 DAY';
		expect(row.value).toBe('1 DAY');
		expect(new LegendRow({ text: 'Quiet' }).value).toBeNull();
	});

	it('draws the thing in focus on flat fresh paper, W0, with no art', () => {
		const box = add(new LegendBox({ fresh: true, width: 200 }));
		expect(rects(box)[0].fill).toEqual(atlas.color.bg_panel_raised);
	});

	it('follows a theme change after mount', () => {
		const box = new LegendBox({ id: 'needs', title: 'Needs', width: 320 });
		box.addChild(new LegendRow({ symbol: 'diamond', text: 'Food runs out in 2 days' }));
		add(box);
		root.theme = null;
		context.frame.layout();
		const drawn = rects(box);
		expect(drawn[0].fill).toEqual(tokens.color.bg_panel);
		expect(drawn[1].border?.color).toEqual(tokens.color.text);
		expect(draws(box).find((command): command is PolygonCommand => command.kind === 'polygon')?.fill).toEqual(tokens.color.status_crit);
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

	it('keeps one lead column, so labels line up whatever leads the row', () => {
		const column = new Stack({ width: 600 });
		const rows = [
			new ContentsRow({ variant: 'primary', lead: { glyph: '9' }, label: 'Continue', value: 'DAY 09' }),
			new ContentsRow({ lead: { glyph: '1' }, label: 'New campaign', value: 'DAY 01' }),
			new ContentsRow({ label: 'Campaign history', value: 'PAST RUNS' }),
			new ContentsRow({ lead: 'deck', label: 'Card showcase' }),
		];
		for (const row of rows) column.addChild(row);
		add(column);
		const labelX = rows.map((row) => draws(row).find((command): command is TextCommand => command.kind === 'text' && command.text === row.label)?.transform[4]);
		expect(new Set(labelX).size).toBe(1);
		expect(labelX[0]).toBe(12 + 46 + 16);
	});

	it('follows a theme change after mount', () => {
		const column = new Stack({ width: 600 });
		const row = new ContentsRow({ lead: { glyph: '1' }, label: 'New campaign', value: 'DAY 01' });
		column.addChild(row);
		add(column);
		root.theme = null;
		context.frame.layout();
		const drawn = draws(row);
		expect(drawn.find((command): command is CircleCommand => command.kind === 'circle')?.border?.color).toEqual(tokens.color.text);
		expect(drawn.find((command): command is TextCommand => command.kind === 'text' && command.text === 'New campaign')?.color).toEqual(tokens.color.text);
		expect(drawn.some((command) => command.kind === 'rect' && same(command.fill, tokens.color.text_disabled))).toBe(true);
	});

	it('lists at the minimum hit height with a small lead, a diamond for a hostile place, and dims a row still in reach in dim ink and a faded glyph', () => {
		const column = new Stack({ width: 340 });
		const store = new ContentsRow({ variant: 'list', lead: { glyph: 'G' }, label: 'General store, south-east', value: 'tier 1' });
		const held = new ContentsRow({ variant: 'list', lead: { glyph: '', diamond: true }, label: 'Volt Vultures stronghold', value: 'stronghold', dim: true });
		column.addChild(store);
		column.addChild(held);
		add(column);
		expect(store.height).toBe(ATLAS.minHit);
		expect(draws(store).find((command): command is CircleCommand => command.kind === 'circle')?.border?.color).toEqual(ink);
		const diamond = draws(held).find((command): command is PolygonCommand => command.kind === 'polygon');
		expect(diamond?.fill).toEqual(atlas.color.status_crit);
		const label = (row: ContentsRow) => draws(row).find((command): command is TextCommand => command.kind === 'text' && command.text === row.label);
		expect(label(held)?.color).toEqual(atlas.color.text_dim);
		expect(held.canReceiveFocus()).toBe(true);
		held.dim = false;
		expect(label(held)?.color).toEqual(ink);
		store.dim = true;
		const dimmed = draws(store);
		expect(dimmed.find((command): command is TextCommand => command.kind === 'text' && command.text === 'tier 1')?.color).toEqual(atlas.color.text_dim);
		// The glyph says it too, in faded print; a stronghold's diamond keeps its red.
		expect(dimmed.find((command): command is CircleCommand => command.kind === 'circle')?.border?.color).toEqual(atlas.color.text_disabled);
		held.dim = true;
		expect(draws(held).find((command): command is PolygonCommand => command.kind === 'polygon')?.fill).toEqual(atlas.color.status_crit);
	});

	it('names its label, value, and subtitle after the row', () => {
		const column = new Stack({ width: 600 });
		const row = new ContentsRow({ id: 'history_row_0', label: 'Starved', value: '34 days', subtitle: 'Seed 7', focusable: false, pointerEvents: 'none' });
		column.addChild(row);
		add(column);
		expect(['label', 'value', 'subtitle'].map((part) => (row.findById(`history_row_0_${part}`) as Text | null)?.text)).toEqual(['Starved', '34 days', 'Seed 7']);
		expect(row.canReceiveFocus()).toBe(false);
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

describe('ResourceStrip ids and formats', () => {
	it('names each item after the strip and its kind, and prints values as asked', () => {
		const strip = add(new ResourceStrip({ id: 'stores', width: 600, items: [{ kind: 'scrap', value: 12_000 }], format: (value) => `${Math.floor(value / 1000)}k` }));
		const item = strip.item('scrap');
		expect(item?.id).toBe('stores_scrap');
		expect((strip.findById('stores_scrap_value') as { text: string } | null)?.text).toBe('12k');
		if (item) item.value = 3000;
		expect((strip.findById('stores_scrap_value') as { text: string } | null)?.text).toBe('3k');
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

	it('takes a heavier frame, as the splash loader\'s Casing frame is', () => {
		const loader = add(new ScaleBar({ segments: 10, value: 0.6, tone: 'highway', frame: 2, width: 420, height: 12 }));
		const [frame, firstCell] = rects(loader);
		expect(frame.border?.color).toEqual(atlas.color.accent_dim);
		expect(frame.border?.width).toBe(2);
		expect(firstCell.rect).toMatchObject({ x: 2, y: 2, height: 8 });
		expect(firstCell.fill).toEqual(atlas.color.accent);
		expect(loader.filled).toBe(6);
	});

	it('fills a cased bar in the driver\'s colour on its casing', () => {
		const bar = add(new CasedBar({ value: 0.5, driver: 'b', width: 200, height: 10 }));
		const drawn = rects(bar);
		expect(drawn[0].fill).toEqual(atlas.color.driver_b_casing);
		expect(drawn[2].fill).toEqual(atlas.color.driver_b);
		expect(drawn[2].rect.width).toBeCloseTo(drawn[1].rect.width / 2);
	});
});

describe('deck objects', () => {
	it('stacks a deck\'s card edges down and right under its back', () => {
		const deck = add(new DeckStack({ driver: 'b', width: 100, edges: 4 }));
		expect(deck.width).toBe(Math.ceil(100 + 2.5 * 4));
		const commands = draws(deck);
		expect(commands[0].kind).toBe('shadow');
		const edges = commands.filter((command): command is RectCommand => command.kind === 'rect' && same(command.fill, atlas.color.bg_inset));
		expect(edges.map((command) => command.rect.x)).toEqual([10, 7.5, 5, 2.5]);
		expect(commands.some((command) => command.kind === 'rect' && same(command.fill, atlas.color.driver_b))).toBe(true);
	});

	it('fans a deck\'s backs about a point under them, the last on top, bounded by its box', () => {
		const fan = add(new DeckFan({ driver: 'a', width: 100, cards: 5, spread: 8 }));
		expect(fan.cards).toBe(5);
		// Turned plus and minus 16 degrees about (50, 150), the fan is wider than a card and symmetric.
		expect(fan.width).toBeGreaterThan(100);
		expect(fan.cardOrigin.x).toBeCloseTo((fan.width - 100) / 2, 0);
		const commands = draws(fan);
		const bands = commands.filter((command): command is RectCommand => command.kind === 'rect' && same(command.fill, atlas.color.driver_a));
		expect(bands).toHaveLength(5);
		expect(commands.filter((command) => command.kind === 'shadow')).toHaveLength(5);
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
		expect(swipe?.rect).toMatchObject({ x: -4, width: 308 });
		expect(swipe?.rect.height).toBeCloseTo(44);
		const loop = over.loop({ x: 0, y: 0, width: 50, height: 20 });
		expect(draws(over).some((command) => command.kind === 'polyline')).toBe(true);
		over.remove(loop);
		expect(over.marks).toHaveLength(0);
		expect(under.highlight(first).variant).not.toBe(mark.variant);
	});
});

describe('focus rings on an atlas screen', () => {
	function focus(component: Component): void {
		component.setFocusState(true, true);
		context.frame.update(1);
	}

	it('rings a focusable with no look of its own in its theme\'s focus ring, ink on the atlas', () => {
		const plain = add(new Stack({ id: 'plain', width: 80, height: 40, focusable: true }));
		focus(plain);
		expect(rects(plain).find((command) => command.id === 'plain.focus_ring')?.border?.color).toEqual(ink);
		root.theme = null;
		expect(rects(plain).find((command) => command.id === 'plain.focus_ring')?.border?.color).toEqual(tokens.color.accent);
	});

	it('rings a TabBar tab in ink and underlines it in the theme\'s accent', () => {
		const bar = add(new TabBar({ tabs: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }] }));
		const [first] = bar.tabs;
		focus(first);
		expect(first.look.focusRing).toEqual(ink);
		const drawn = rects(first);
		expect(drawn.some((command) => same(command.fill, atlas.color.accent))).toBe(true);
		expect(rects(bar).some((command) => same(command.fill, atlas.color.line_hairline))).toBe(true);
	});

	it('draws a Slider in the theme\'s colours, with the walk\'s ring in ink', () => {
		const slider = add(new Slider({ id: 'volume', min: 0, max: 10, value: 5, width: 200 }));
		expect(slider.resolvedColors.fill).toEqual(atlas.color.accent);
		focus(slider);
		expect(rects(slider).find((command) => command.id === 'volume.focus_ring')?.border?.color).toEqual(ink);
	});

	it('draws a scrollbar in the theme\'s colours, so its thumb shows on paper', () => {
		const bar = add(new Scrollbar({ id: 'bar', height: 120, range: { offset: 0, extent: 300, viewport: 120 } }));
		const [track, thumb] = rects(bar);
		expect(track.fill).toEqual(atlas.color.line_hairline);
		expect(thumb.fill).toEqual(atlas.color.line_strong);
		root.theme = null;
		expect(rects(bar)[1].fill).toEqual(tokens.color.line_strong);
	});
});

describe('DamageMark', () => {
	it('is its art\'s own size, follows a change of stamp, and takes no hits (DDB-511)', () => {
		const mark = add(new DamageMark({ id: 'stamp', kind: 'looted' }));
		const looted = uiArtSize('stamp_looted');
		expect([mark.width, mark.height, mark.piece]).toEqual([looted.width, looted.height, 'stamp_looted']);
		mark.kind = 'depleted';
		context.frame.layout();
		const depleted = uiArtSize('stamp_depleted');
		expect([mark.width, mark.height, mark.piece]).toEqual([depleted.width, depleted.height, 'stamp_depleted']);
		expect(mark.pointerEvents).toBe('none');
		expect(['lost', 'fallen', 'tear'].map((kind) => damagePiece(kind as 'lost'))).toEqual(['stamp_lost', 'stamp_fallen', 'tear_a']);
	});
});

describe('AtlasTag', () => {
	it('keeps its text clear of where a tear runs in, torn or not, and reds a costly caption (DDB-511)', () => {
		const torn = new AtlasTag({ label: 'Road Warrior 1', caption: 'Injured, fit in 2 days', warn: true, torn: true, width: 200, labelId: 'name', captionId: 'state' });
		const whole = new AtlasTag({ label: 'Road Warrior 1', caption: 'Fit', width: 200 });
		const column = new Stack({ gap: 8 });
		column.addChild(torn);
		column.addChild(whole);
		add(column);
		const tear = uiArtSize('tear_a');
		for (const tag of [torn, whole]) {
			for (const child of tag.children) expect(child.placedX + child.width).toBeLessThanOrEqual(tag.width - tear.width);
		}
		expect(torn.height).toBeGreaterThanOrEqual(tear.height);
		expect([torn.torn, whole.torn, torn.label, torn.caption]).toEqual([true, false, 'Road Warrior 1', 'Injured, fit in 2 days']);
		const caption = draws(torn).find((command): command is TextCommand => command.kind === 'text' && command.text.toLowerCase().startsWith('injured'));
		expect(caption?.color).toEqual(atlas.color.status_crit);
	});
});

describe('settings controls on an atlas screen', () => {
	const dark = themes.dark;

	it('draws a Checkbox and a Toggle on paper, filled with the highway when on, square where the theme is', () => {
		const box = add(new Checkbox({ label: 'Subtitles', checked: true }));
		const toggle = add(new Toggle({ label: 'Screen shake' }));
		expect(box.look.fill).toEqual(atlas.color.accent);
		expect(box.look.radius).toBe(0);
		expect(toggle.look.fill).toEqual(atlas.color.bg_inset);
		expect(toggle.look.border).toEqual(atlas.color.line_strong);
		const label = draws(toggle).find((command): command is TextCommand => command.kind === 'text');
		expect(label?.color).toEqual(atlas.color.text);
		root.theme = null;
		expect(box.look.fill).toEqual(dark.color.accent);
		expect(toggle.look.fill).toEqual(dark.color.bg_inset);
	});

	it('marks a SegmentedControl choice with the highlighter and ink, in a square index well', () => {
		const control = add(new SegmentedControl({ id: 'motion', tone: 'highlight', options: [{ label: 'System', value: 'system' }, { label: 'Full', value: 'full' }], selected: 'full' }));
		const [first, second] = control.items;
		expect(second.look.fill).toEqual(atlas.color.bg_selection);
		expect(second.look.text).toEqual(atlas.color.text_bright);
		expect(first.look.text).toEqual(atlas.color.text_dim);
		const well = rects(control).find((command) => command.id === 'motion');
		expect(well?.fill).toEqual(atlas.color.bg_inset);
		expect(well?.radius ?? 0).toBe(0);
		first.setFocusState(true, true);
		context.frame.update(1);
		expect(first.look.focusRing).toEqual(ink);
	});

	it('keeps an accent SegmentedControl chip and well as they were on a dark screen, and moves them to the atlas', () => {
		root.theme = null;
		const control = add(new SegmentedControl({ id: 'filter', options: [{ label: 'All', value: 'all' }], selected: 'all' }));
		expect(control.items[0].look.fill).toEqual(dark.color.accent);
		expect(rects(control).find((command) => command.id === 'filter')?.radius).toBe(dark.radius.r_md);
		root.theme = 'atlas';
		expect(control.items[0].look.fill).toEqual(atlas.color.accent);
	});

	it('draws a Select field, its placeholder, and its menu on paper', () => {
		const select = add(new Select({ id: 'driver', options: [{ label: 'Road warrior', value: 'a' }], placeholder: 'Pick one' }));
		expect(select.resolvedColors.fill).toEqual(atlas.color.bg_inset);
		const placeholder = draws(select).find((command): command is TextCommand => command.kind === 'text');
		expect(placeholder?.color).toEqual(atlas.color.text_faint);
		select.show();
		const menu = select.openMenu;
		if (!menu) throw new Error('the select should open');
		expect(menu.effectiveTheme).toBe('atlas');
		expect(menu.resolvedColors.fill).toEqual(atlas.color.bg_panel_raised);
		select.closeMenu();
	});
});

describe('drawAtlasArt', () => {
	it('prints W2 and W3 only on surfaces with room for them, W1 below', () => {
		const square = (side: number) => ({ x: 0, y: 0, width: side * 2, height: side });
		expect(paperPiece(2, square(288))).toBe('paper_w2_a');
		expect(paperPiece(2, square(287))).toBe('paper_w1_a');
		expect(paperPiece(3, square(352), 'b')).toBe('paper_w3_b');
		expect(paperPiece(3, square(300))).toBe('paper_w2_a');
		expect(paperPiece(3, square(100), 'c')).toBe('paper_w1_c');
	});

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
