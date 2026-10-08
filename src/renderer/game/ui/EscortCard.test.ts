/**
 * @jest-environment jsdom
 */
import { Container } from '../../engine/components/Container';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import { advance, key, pointer, send } from '../../engine/services/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Clock } from '../../engine/animation/Clock';
import { renderTree } from '../../engine/components/renderTree';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { tokens } from '../../engine/theme/tokens';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { ESCORT_CONFIGS, EscortType, convertToEscort } from '../mechanics/Escort';
import { Vehicle } from '../mechanics/Vehicle';
import { STRUCTURE_COLOR, hexRgba } from '../screens/combat/combatStyle';
import { MINI_CARD_INK, MINI_GRID } from './Card';
import { CARD_DIM_FILLS, CARD_GROUND_FILLS, CARD_MUTED_FILLS } from './cardStyle';
import { CardLookup } from './DriverDetailView';
import { ESCORT_CARD_INK, ESCORT_CARD_SIZE, EscortCard } from './EscortCard';
import { EscortInspectSurface, INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeEscortInspectable } from './cardInspect';
import { EscortCardData, escortCardData, escortCardDataOf } from './escortCardData';
import { RecordedDraw, lookup, part, recordFrame } from './testing';

const TYPES = Object.keys(ESCORT_CONFIGS) as EscortType[];
const STRUCTURE_FULL = hexRgba(STRUCTURE_COLOR);

let measuring: ReturnType<typeof createMeasuringDrawApi>;
let context: MountContext;

beforeEach(() => {
	measuring = createMeasuringDrawApi();
	context = createTestContext({ draw: measuring.api, clock: new Clock() });
});

/** A driven vehicle carrying on unmanned, `name` and all, as the convoy keeps it. */
function unmanned(name: string = DRIVER_CONFIGS.road_warrior.metadata.vehicleName, structure = 31): EscortCardData {
	const { vehicleStats } = DRIVER_CONFIGS.road_warrior;
	const vehicle = new Vehicle({
		name,
		armor: vehicleStats.armor,
		maxArmor: vehicleStats.armor,
		structure,
		maxStructure: vehicleStats.maxStructure,
		baseSpeed: vehicleStats.speed,
		slot: null,
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: [],
	});
	convertToEscort(vehicle);
	return escortCardDataOf(vehicle);
}

/** Mounted and laid out, so its words and tag have measured through the context (R1.6). */
function mount(data: EscortCardData, { staying = false, cards = lookup }: { staying?: boolean; cards?: CardLookup } = {}): EscortCard {
	const card = new EscortCard({ id: 'card', data, cards, staying });
	card.mount(context);
	context.frame.layout();
	return card;
}

const frame = (card: EscortCard): RecordedDraw[] => recordFrame({ root: card, context, measuring });
const texts = (commands: RecordedDraw[]): string[] => commands.flatMap((command) => (command.kind === 'text' && command.text ? [command.text] : []));
const tagBoxes = (commands: RecordedDraw[]): Rect[] => commands.flatMap((command) => (command.kind === 'rect' && command.rect && command.rect.y < 0 && command.rect.height === 13 ? [command.rect] : []));
const structureFills = (commands: RecordedDraw[]): Rect[] => commands.flatMap((command) => (command.kind === 'rect' && command.rect && command.fill && command.fill.every((channel, index) => channel === STRUCTURE_FULL[index]) ? [command.rect] : []));
/** The line drawn over the header: the card-sized rect that is border only. */
const outline = (commands: RecordedDraw[]): { color: RGBA; width: number } | null | undefined => commands.find((command) => command.kind === 'rect' && command.rect?.width === 80 && command.rect.height === 112 && command.fill?.[3] === 0)?.border;
const ground = (commands: RecordedDraw[]): RGBA | null | undefined => commands.find((command) => command.kind === 'rect' && command.id === 'card')?.fill;

describe('Escort card (Game Flow 7.0)', () => {
	it('is 80x112, a mini card\'s size, so it lines up with the cards it adds', () => {
		expect(ESCORT_CARD_SIZE).toEqual({ width: 80, height: 112 });
		const card = mount(escortCardData({ type: 'fuel_hauler' }));
		expect([card.width, card.height]).toEqual([80, 112]);
	});

	it('shows the name, its structure, and the signature card it brings', () => {
		const card = mount(escortCardData({ type: 'fuel_hauler', structure: 18 }));
		expect(part(card, 'name').text).toBe('Fuel Hauler');
		expect(part(card, 'structure').text).toBe('18/40');
		expect(part(card, 'signature').text).toBe('+ Top Off');
	});

	it('names every type\'s signature card from the screen\'s cards', () => {
		const names = TYPES.map((type) => part(mount(escortCardData({ type })), 'signature').text);
		expect(names).toEqual(['+ Run Ahead', '+ Flag Down', '+ Top Off', '+ Triage']);
	});

	it('shows no card for a vehicle carrying on unmanned, or a card the lookup doesn\'t know', () => {
		expect(part(mount(unmanned()), 'signature').text).toBe('');
		expect(part(mount(escortCardData({ type: 'med_truck' }), { cards: () => null }), 'signature').text).toBe('');
	});

	it('fits every type\'s words and figures whole, and an unmanned vehicle\'s two-digit structure', () => {
		const cases = [...TYPES.map((type) => escortCardData({ type })), escortCardData({ type: 'outrider', structure: 9 }), unmanned()];
		for (const data of cases) {
			const card = mount(data);
			for (const suffix of ['name', 'structure', 'signature']) {
				expect([data.name, suffix, part(card, suffix).overflowOutcome ?? 'none']).toEqual([data.name, suffix, 'none']);
			}
			card.unmount();
		}
	});

	it('wraps a long name to a second line and keeps the bar and the card under it level either way', () => {
		const rig = mount(unmanned());
		const hauler = mount(escortCardData({ type: 'fuel_hauler' }));
		expect(part(rig, 'name').measured?.lines).toBe(2);
		expect(part(hauler, 'name').measured?.lines).toBe(1);
		for (const suffix of ['name', 'structure', 'signature']) {
			expect(part(rig, suffix).y).toBe(part(hauler, suffix).y);
		}
		const nameBottom = part(rig, 'name').y + part(rig, 'name').height;
		expect(nameBottom).toBeLessThanOrEqual(part(rig, 'structure').y);
	});

	it('cuts a name too long for two lines with an ellipsis', () => {
		expect(part(mount(unmanned('The Last Rig That Hauled the Whole Convoy Home')), 'name').overflowOutcome).toBe('ellipsis');
	});

	it('fills the structure bar in the road\'s structure green by the share left, the same length on every card, and an empty bar not at all', () => {
		const full = structureFills(frame(mount(escortCardData({ type: 'pilot_car' }))));
		const hurt = structureFills(frame(mount(escortCardData({ type: 'med_truck', structure: 7 }))));
		expect(full).toHaveLength(1);
		expect(hurt[0].x).toBe(full[0].x);
		expect(hurt[0].width).toBeCloseTo(full[0].width * (7 / 35), 5);
		expect(structureFills(frame(mount(escortCardData({ type: 'outrider', structure: 0 }))))).toEqual([]);
		expect(structureFills(frame(mount(unmanned())))[0].width).toBeCloseTo(full[0].width * (31 / 80), 5);
	});

	it('draws a hazard-stripe header inside its line, the stripes clear of the rounded corners', () => {
		const commands = frame(mount(escortCardData({ type: 'fuel_hauler' })));
		const stripes = commands.find((command) => command.kind === 'polygon');
		expect(stripes?.fill).toEqual(CARD_MUTED_FILLS.full);
		const points = stripes?.points ?? [];
		expect(points.length).toBeGreaterThan(30);
		for (const { x, y } of points) {
			expect(x).toBeGreaterThanOrEqual(2);
			expect(x).toBeLessThanOrEqual(78);
			expect(y).toBeGreaterThanOrEqual(2);
			expect(y).toBeLessThanOrEqual(12);
			// Inside the band's rounded top corners: radius 3, inside the line's 2 at the frame's 5
			const corner = x < 5 ? 5 : x > 75 ? 75 : null;
			if (corner !== null && y < 5) expect(Math.hypot(x - corner, y - 5)).toBeLessThanOrEqual(3 + 1e-6);
		}
		// The line is drawn over the header, so the header never covers it
		const lineAt = commands.findIndex((command) => command.kind === 'rect' && command.rect?.width === 80 && command.fill?.[3] === 0);
		expect(lineAt).toBeGreaterThan(commands.indexOf(stripes as RecordedDraw));
	});

	it('stays STAYING on the top edge, hanging past the right one, and faded through colours rather than opacity', () => {
		const card = mount(escortCardData({ type: 'outrider', structure: 9 }), { staying: true });
		const commands = frame(card);
		expect(texts(commands)).toContain('STAYING');
		const [box] = tagBoxes(commands);
		expect(box.y).toBe(-7);
		expect(box.x + box.width).toBeCloseTo(84);
		expect(card.drawnText).toEqual(['STAYING']);
		expect(card.faded).toBe(true);
		expect(card.opacity).toBe(1);
		expect(ground(commands)).toEqual(CARD_GROUND_FILLS.dimmed);
		expect(outline(commands)?.color).toEqual(CARD_DIM_FILLS.dimmed);
		expect(commands.find((command) => command.kind === 'polygon')?.fill).toEqual(CARD_MUTED_FILLS.dimmed);
	});

	it('brings a card back from staying in place, and tells the walk its tag came or went', () => {
		const card = mount(escortCardData({ type: 'outrider' }), { staying: true });
		frame(card);
		expect(card.walkedGroupCount).toBeGreaterThan(0);
		card.staying = false;
		expect(card.walkedGroupCount).toBe(-1);
		const commands = frame(card);
		expect(card.faded).toBe(false);
		expect(card.drawnText).toBeNull();
		expect(tagBoxes(commands)).toEqual([]);
		expect(ground(commands)).toEqual(CARD_GROUND_FILLS.full);
		card.staying = true;
		expect(card.walkedGroupCount).toBe(-1);
		expect(tagBoxes(frame(card))).toHaveLength(1);
	});

	it('stays enabled and focusable when staying, since its detail view still opens', () => {
		const card = mount(escortCardData({ type: 'outrider' }), { staying: true });
		card.focusable = true;
		expect(card.effectivelyEnabled).toBe(true);
		expect(card.canReceiveFocus()).toBe(true);
	});

	it('outlines in the interaction yellow on hover and keyboard focus, and not while disabled, when it fades too', () => {
		const card = mount(escortCardData({ type: 'fuel_hauler' }));
		const line = (): { color: RGBA; width: number } | null | undefined => outline(frame(card));
		const resting = line();
		expect(resting?.color).toEqual(CARD_DIM_FILLS.full);
		card.hovered = true;
		expect(line()).toEqual({ color: tokens.color.accent, width: 2, position: 'inside' });
		card.hovered = false;
		expect(line()).toEqual(resting);
		card.focusable = true;
		context.focus.pushScope(card);
		context.focus.focus(card, 'keyboard');
		expect(line()?.color).toEqual(tokens.color.accent);
		context.focus.blur();
		context.focus.popScope(card);
		card.enabled = false;
		card.hovered = true;
		expect(line()?.color).not.toEqual(tokens.color.accent);
		expect(card.resolvedColors.fill).toEqual(CARD_GROUND_FILLS.dimmed);
	});

	it('outlines a selected card in the bright yellow, a pixel heavier, as a selected mini', () => {
		const card = mount(escortCardData({ type: 'pilot_car' }));
		card.selected = true;
		expect(outline(frame(card))).toEqual({ color: tokens.color.accent_bright, width: 3, position: 'inside' });
		card.selected = false;
		expect(outline(frame(card))?.width).toBe(2);
	});

	it('comes back to its resting line when mounted again after leaving hovered', () => {
		const card = mount(escortCardData({ type: 'fuel_hauler' }));
		const resting = outline(frame(card));
		card.hovered = true;
		expect(outline(frame(card))?.color).toEqual(tokens.color.accent);
		// Unmounting clears hover without a callback (R9.21)
		card.unmount();
		card.mount(context);
		expect(card.hovered).toBe(false);
		expect(outline(frame(card))).toEqual(resting);
	});

	it('selects on a click and on Enter when focused, with the data it shows, and shows the pointer only once something listens', () => {
		const data = escortCardData({ type: 'med_truck' });
		const card = mount(data);
		expect(card.cursor).toBeNull();
		const picked: EscortCardData[] = [];
		card.onSelect = (selected) => picked.push(selected);
		expect(card.cursor).toBe('pointer');
		send(context, [pointer('down', 40, 60), pointer('up', 40, 60)]);
		expect(picked).toEqual([data]);
		card.focusable = true;
		context.focus.pushScope(card);
		context.focus.focus(card, 'keyboard');
		send(context, [key('Enter'), key('Enter', 'up')]);
		send(context, [key(' '), key(' ', 'up')]);
		expect(picked).toEqual([data, data, data]);
		context.focus.popScope(card);
	});

	it('lets Enter through to the screen\'s hotkeys when nothing listens for its selection, and takes it when something does', () => {
		const screen = new Container({ id: 'screen', x: 0, y: 0, width: 400, height: 400 });
		const card = new EscortCard({ id: 'card', x: 20, y: 20, data: escortCardData({ type: 'med_truck' }), cards: lookup });
		card.focusable = true;
		screen.addChild(card);
		screen.mount(context);
		context.frame.layout();
		const heard: string[] = [];
		screen.hotkeys.register('Enter', () => heard.push('screen'));
		context.focus.pushScope(screen);
		context.focus.focus(card, 'keyboard');
		send(context, [key('Enter'), key('Enter', 'up')]);
		expect(heard).toEqual(['screen']);
		card.onSelect = () => heard.push('card');
		send(context, [key('Enter'), key('Enter', 'up')]);
		expect(heard).toEqual(['screen', 'card']);
		context.focus.popScope(screen);
	});

	it('moves between cards in a row on the arrow keys, as a focus group', () => {
		const row = new Container({ id: 'row', x: 0, y: 0, width: 400, height: 200, focusGroup: { orientation: 'horizontal' } });
		const cards = TYPES.slice(0, 2).map((type, index) => {
			const card = new EscortCard({ id: `card_${type}`, x: 20 + index * 100, y: 20, data: escortCardData({ type }), cards: lookup });
			card.focusable = true;
			row.addChild(card);
			return card;
		});
		row.mount(context);
		context.frame.layout();
		context.focus.pushScope(row);
		context.focus.focus(cards[0], 'keyboard');
		send(context, [key('ArrowRight'), key('ArrowRight', 'up')]);
		expect(context.focus.focused).toBe(cards[1]);
		context.focus.popScope(row);
	});

	it('shows another escort in place, measuring only the words that changed', () => {
		const card = mount(escortCardData({ type: 'med_truck', structure: 20 }));
		const children = [...card.children];
		const measured = jest.spyOn(measuring.api, 'measureText');
		card.data = escortCardData({ type: 'med_truck', structure: 12 });
		context.frame.layout();
		expect(card.children).toEqual(children);
		expect(part(card, 'structure').text).toBe('12/35');
		expect(measured.mock.calls.map(([options]) => options.text)).toEqual(['12/35']);
		measured.mockRestore();
		card.data = escortCardData({ type: 'outrider' });
		expect(part(card, 'name').text).toBe('Outrider');
		expect(part(card, 'signature').text).toBe('+ Run Ahead');
	});

	it('hands the draw API the same objects every frame, and measures its tag once', () => {
		const card = new EscortCard({ id: 'card', data: escortCardData({ type: 'outrider', structure: 9 }), cards: lookup, staying: true });
		const measured = jest.spyOn(measuring.api, 'measureText');
		card.mount(context);
		context.frame.layout();
		const handed: unknown[][] = [];
		for (let index = 0; index < 3; index++) {
			const calls: unknown[] = [];
			const record = (options: unknown): void => { calls.push(options); };
			const spies = [
				jest.spyOn(measuring.api, 'drawRect').mockImplementation(record),
				jest.spyOn(measuring.api, 'drawPolygon').mockImplementation(record),
				jest.spyOn(measuring.api, 'drawCircle').mockImplementation(record),
				jest.spyOn(measuring.api, 'drawText').mockImplementation(record),
			];
			card.render(measuring.api);
			for (const spy of spies) spy.mockRestore();
			handed.push(calls);
			card.invalidateLayout();
			context.frame.layout();
		}
		expect(handed[0].length).toBeGreaterThan(0);
		for (const calls of handed.slice(1)) {
			expect(calls).toHaveLength(handed[0].length);
			calls.forEach((options, index) => expect(options).toBe(handed[0][index]));
		}
		expect(measured.mock.calls.filter(([options]) => options.text === 'STAYING')).toHaveLength(1);
		measured.mockRestore();
	});

	it('draws nothing further than ESCORT_CARD_INK past its box, staying or selected, a mini\'s reach, so MINI_GRID spaces it', () => {
		expect(ESCORT_CARD_INK).toBe(7);
		expect(ESCORT_CARD_INK).toBeLessThanOrEqual(MINI_CARD_INK);
		expect(MINI_GRID.gap).toBeGreaterThanOrEqual(ESCORT_CARD_INK * 2);
		for (const staying of [false, true]) {
			const card = mount(escortCardData({ type: 'pilot_car' }), { staying });
			card.selected = true;
			card.focusable = true;
			context.focus.pushScope(card);
			context.focus.focus(card, 'keyboard');
			expect(card.inkExtent).toBe(ESCORT_CARD_INK);
			for (const command of frame(card)) {
				const box = command.rect ?? command.box ?? null;
				const border = command.border as { width: number; position?: string } | null | undefined;
				const outside = border?.position === 'outside' ? border.width : 0;
				const xs = box ? [box.x - outside, box.x + box.width + outside] : (command.points ?? []).map((point) => point.x);
				const ys = box ? [box.y - outside, box.y + box.height + outside] : (command.points ?? []).map((point) => point.y);
				for (const x of xs) expect([staying, x >= -ESCORT_CARD_INK && x <= 80 + ESCORT_CARD_INK]).toEqual([staying, true]);
				for (const y of ys) expect([staying, y >= -ESCORT_CARD_INK && y <= 112 + ESCORT_CARD_INK]).toEqual([staying, true]);
			}
			context.focus.blur();
			context.focus.popScope(card);
		}
	});

	it('takes the pointer on its tag, as on its body', () => {
		const card = mount(escortCardData({ type: 'outrider' }), { staying: true });
		const [tag] = tagBoxes(frame(card));
		expect(card.containsPoint(82, -3)).toBe(true);
		expect(card.containsPoint(tag.x + 1, -3)).toBe(true);
		expect(card.containsPoint(tag.x - 1.5, -3)).toBe(false);
		expect(card.containsPoint(86, 20)).toBe(false);
		expect(mount(escortCardData({ type: 'outrider' })).containsPoint(82, -3)).toBe(false);
	});

	it('draws its own focus ring, once, under its tag', () => {
		const card = mount(escortCardData({ type: 'outrider' }), { staying: true });
		expect(card.drawsOwnFocusRing).toBe(true);
		card.focusable = true;
		context.focus.pushScope(card);
		context.focus.focus(card, 'keyboard');
		const commands = frame(card);
		const rings = commands.filter((command) => command.id === 'card.focus_ring');
		expect(rings).toHaveLength(1);
		expect(commands.indexOf(rings[0])).toBeLessThan(commands.findIndex((command) => command.text === 'STAYING'));
		context.focus.blur();
		context.focus.popScope(card);
		expect(frame(card).filter((command) => command.id === 'card.focus_ring')).toEqual([]);
	});

	// The count is what a walk adds for the card when it skips it whole (R4.2a)
	it('counts one group fewer once its bar empties, when a walk skips it whole', () => {
		const card = mount(escortCardData({ type: 'med_truck' }));
		const { api } = measuring;
		const walk = (clipped: boolean): number => {
			context.frame.layout();
			api.beginFrame({ viewport: { width: 400, height: 400 } });
			// A clip the card's ink misses makes the walk skip it, once it has a count
			if (clipped) api.pushClip({ x: 300, y: 300, width: 10, height: 10 });
			const before = api.groupsRequested;
			renderTree(card, api);
			const groups = api.groupsRequested - before;
			if (clipped) api.popClip();
			api.endFrame();
			return groups;
		};
		const full = walk(false);
		card.data = escortCardData({ type: 'med_truck', structure: 0 });
		expect(walk(true)).toBe(full - 1);
		expect(card.walkedGroupCount).toBe(full - 1);
	});

	it('lints clean for every type, staying or not, and an unmanned vehicle', () => {
		for (const data of [...TYPES.map((type) => escortCardData({ type, structure: 1 })), unmanned()]) {
			for (const staying of [false, true]) {
				const card = mount(data, { staying });
				const result = layoutLint(treeSnapshot([card], { width: 80, height: 112 }));
				expect({ name: data.name, staying, violations: result.violations }).toEqual({ name: data.name, staying, violations: [] });
				card.unmount();
			}
		}
	});
});

describe('Escort card detail view, through the inspect path', () => {
	/** A card in a container that handles the context menu, as load out's escort row would. */
	function strip(data = escortCardData({ type: 'fuel_hauler', structure: 18 }), x = 20): { card: EscortCard; centre: { x: number; y: number } } {
		const row = new Container({ id: 'convoy', x: 0, y: 0, width: 1440, height: 400 });
		const card = new EscortCard({ id: 'card', x, y: 20, data, cards: lookup });
		card.focusable = true;
		makeEscortInspectable(card);
		row.addChild(card);
		inspectOnContextMenu(row);
		row.mount(context);
		context.frame.layout();
		const box = card.screenBounds;
		return { card, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
	}

	function settleHidden(): void {
		advance(context, tokens.motion.dur_tooltip_hide + 100);
		expect(context.tooltips.surface).toBeNull();
	}

	it('opens on hover after the delay, at once on keyboard focus, and on a touch hold, with the card\'s data and lookup', () => {
		const { card, centre } = strip();
		send(context, [pointer('move', centre.x, centre.y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(context.tooltips.owner).toBe(card);
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(EscortInspectSurface);
		if (surface instanceof EscortInspectSurface) {
			expect(surface.view.data).toBe(card.data);
			expect(surface.view.signatureCard?.data.type).toBe('top_off');
		}
		send(context, [pointer('move', 1200, 600)]);
		settleHidden();

		context.focus.pushScope(card.parent as Container);
		context.focus.focus(card, 'keyboard');
		context.frame.layout();
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface).toBeInstanceOf(EscortInspectSurface);
		context.focus.popScope(card.parent as Container);
		context.tooltips.hide();
		settleHidden();

		send(context, [pointer('down', centre.x, centre.y, { pointerType: 'touch', pointerId: 2 })]);
		advance(context, 600);
		expect(context.tooltips.owner).toBe(card);
		expect(context.tooltips.surface).toBeInstanceOf(EscortInspectSurface);
		send(context, [pointer('up', centre.x, centre.y, { pointerType: 'touch', pointerId: 2 })]);
		context.tooltips.hide();
	});

	it('opens on a staying card too, since staying fades it but leaves it enabled', () => {
		const { card, centre } = strip();
		card.staying = true;
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);
		context.tooltips.unpin();
	});

	it('pins on a secondary click, its foot saying so, and lets go on the next', () => {
		const { card, centre } = strip();
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(card);
		const view = (context.tooltips.surface as EscortInspectSurface).view;
		expect(part(view, 'pin').text).toBe('PINNED');
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		expect(context.tooltips.pinned).toBeNull();
	});

	it('pins on I while its view shows or while it has focus, and lets go on the next I', () => {
		const { card } = strip();
		expect(INSPECT_KEYS).toContain('I');
		context.focus.pushScope(card.parent as Container);
		context.focus.focus(card, 'keyboard');
		context.frame.layout();
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBe(card);
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBeNull();
		context.focus.popScope(card.parent as Container);
	});

	it('pins a changed escort\'s view again, with the new data, and keeps the one it has when new data shows the same', () => {
		const { card, centre } = strip();
		send(context, [pointer('down', centre.x, centre.y, { button: 2 }), pointer('up', centre.x, centre.y, { button: 2 })]);
		const first = context.tooltips.surface;
		card.data = escortCardData({ type: 'fuel_hauler', structure: 18 });
		context.frame.layout();
		expect(context.tooltips.surface === first).toBe(true);
		const repaired = escortCardData({ type: 'fuel_hauler' });
		card.data = repaired;
		context.frame.layout();
		expect(context.tooltips.pinned).toBe(card);
		const view = (context.tooltips.surface as EscortInspectSurface).view;
		expect(view.data).toBe(repaired);
		expect(part(view, 'structure').text).toBe('STRUCTURE 40/40');
		expect(part(view, 'pin').text).toBe('PINNED');
		context.tooltips.unpin();
	});

	it('rests on the screen\'s bottom edge, centred over the card and kept inside the screen', () => {
		const middle = strip(escortCardData({ type: 'outrider' }), 680);
		context.tooltips.show(middle.card);
		advance(context, tokens.motion.dur_fast + 50);
		const bounds = (context.tooltips.surface as EscortInspectSurface).screenBounds;
		expect(bounds.x + bounds.width / 2).toBeCloseTo(middle.centre.x, 0);
		expect(bounds.y + bounds.height).toBeCloseTo(882 - 10, 0);
		context.tooltips.hide();
		settleHidden();

		const edge = strip(escortCardData({ type: 'outrider' }), 0);
		context.tooltips.show(edge.card);
		advance(context, tokens.motion.dur_fast + 50);
		expect((context.tooltips.surface as EscortInspectSurface).screenBounds.x).toBeCloseTo(8, 0);
		context.tooltips.hide();
	});

	it('fits a 1024x600 screen at full size', () => {
		const screen = createTestContext({ draw: createMeasuringDrawApi().api, viewport: { logical: { width: 1024, height: 600 } }, clock: new Clock() });
		const root = new Container({ id: 'screen', x: 0, y: 0, width: 1024, height: 600 });
		const card = new EscortCard({ id: 'card', x: 472, y: 440, data: escortCardData({ type: 'med_truck', structure: 12 }), cards: lookup });
		makeEscortInspectable(card);
		root.addChild(card);
		root.mount(screen);
		screen.frame.layout();
		screen.tooltips.show(card);
		advance(screen, tokens.motion.dur_fast + 50);
		const surface = screen.tooltips.surface as EscortInspectSurface;
		expect(surface.viewScale).toBe(1);
		const bounds = surface.screenBounds;
		expect(bounds.y).toBeGreaterThanOrEqual(8);
		expect(bounds.y + bounds.height).toBeCloseTo(600 - 10, 5);
	});
});
