/**
 * @jest-environment jsdom
 */
import { Text } from '../../engine/components/Text';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import { advance, pointer, send } from '../../engine/services/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import { CARD_LIFT, Card, CardSize, MINI_CARD_INK, MINI_GRID, MiniCardState, miniGridHeight } from './Card';
import { KeywordText } from './KeywordText';
import { Icon } from '../../engine/components/Icon';
import type { Component } from '../../engine/components/Component';
import { DRIVER_COLORS, hexRgba } from '../screens/combat/combatStyle';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';
import { renderTree } from '../../engine/components/renderTree';
import { Clock } from '../../engine/animation/Clock';
import { tokens } from '../../engine/theme/tokens';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { CARD_DIM_FILLS, GEM_FILLS, scale } from './cardStyle';
import { CardInspectSurface, inspectOnContextMenu, makeInspectable } from './cardInspect';
import { Container } from '../../engine/components/Container';

// Lays out every card face at both sizes; the 5 s default fails under a loaded machine.
jest.setTimeout(30_000);

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

function part(card: Card, suffix: string): Text {
	const found = card.children.find((child) => child.id === `card_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

let context: MountContext;

/** Mounted and laid out, so its texts have measured through the context (R1.6). */
function build(data: CardData, driverNumber: 1 | 2 | null, upgraded = false, size = CardSize.NORMAL): Card {
	const model = new GameCard({ ...data, upgraded });
	const card = new Card({ id: 'card', x: 0, y: 0, data: model, size, driverNumber });
	card.mount(context);
	context.frame.layout();
	return card;
}

/** Every Text under `root`, at any depth. */
function texts(root: Component): Text[] {
	return root.children.flatMap((child) => (child instanceof Text ? [child] : texts(child)));
}

describe('Card face (Battle Screen Design, section 5)', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it('is 128x180, the hand\'s card size', () => {
		expect(Card.getDimensions(CardSize.NORMAL)).toEqual({ width: 128, height: 180 });
	});

	it('fits every name from cards.json in its slot at 16 or 14, upgraded or not, without the ellipsis', () => {
		for (const data of cardData) {
			for (const upgraded of [false, true]) {
				const card = build(data, 1, upgraded);
				const title = part(card, 'title');
				expect([data.name, upgraded, [16, 14]]).toEqual([data.name, upgraded, expect.arrayContaining([card.nameSize])]);
				expect([data.name, upgraded, (title.measured?.width ?? Infinity) <= title.width]).toEqual([data.name, upgraded, true]);
			}
		}
	});

	it('shrinks a name too wide at 16 to 14, then cuts one too wide even then with an ellipsis', () => {
		const base = cardData.find((candidate) => candidate.name === 'Ram') as CardData;
		expect(build(base, 1).nameSize).toBe(16);
		const longer = build({ ...base, name: 'Coordinated Rammings' }, 1);
		expect(longer.nameSize).toBe(14);
		expect(part(longer, 'title').overflowOutcome).toBe('none');
		const longest = build({ ...base, name: 'Coordinated Convoy Ramming Assault' }, 1);
		expect(longest.nameSize).toBe(14);
		expect(part(longest, 'title').overflowOutcome).toBe('ellipsis');
	});

	it('cuts nothing on any face, badged or not, upgraded or not', () => {
		for (const size of [CardSize.NORMAL, CardSize.MINI]) {
			for (const driverNumber of [1, null] as const) {
				for (const data of cardData) {
					for (const upgraded of [false, true]) {
						const card = build(data, driverNumber, upgraded, size);
						for (const child of texts(card)) {
							if (!child.visible) continue;
							const measured = child.measured;
							const label = `${data.name}${upgraded ? '+' : ''} ${size} ${child.id}`;
							expect([label, measured]).not.toEqual([label, null]);
							expect([label, (measured?.width ?? 0) <= child.width + 1e-6]).toEqual([label, true]);
							expect([label, (measured?.height ?? 0) <= child.height + 1e-6]).toEqual([label, true]);
						}
					}
				}
			}
		}
	});

	it('shows the summary with its bracketed keywords highlighted and the brackets gone', () => {
		const data = cardData.find((candidate) => candidate.type === 'ramming_speed') as CardData;
		const card = build(data, 1);
		const words = card.faceWords;
		expect(words.flat().some((piece) => /[[\]]/.test(piece.text))).toBe(false);
		expect(words.flat().filter((piece) => piece.keyword).map((piece) => piece.text)).toEqual(['Range', '1', 'Vulnerable']);
		expect(words.map((word) => word.map((piece) => piece.text).join('')).join(' ')).toBe(new GameCard({ ...data }).displaySummary.replace(/[[\]]/g, ''));
	});

	it('keeps the summary inside its three lines, above the foot', () => {
		for (const data of cardData) {
			const card = build(data, null);
			expect([data.name, card.summaryLines <= 3]).toEqual([data.name, true]);
			for (const word of texts(card).filter((text) => text.id?.startsWith('card_description_'))) {
				expect(word.y + word.height).toBeLessThanOrEqual(51 + 1e-6);
			}
		}
	});

	it('frames the card in its driver\'s colour, never its rarity\'s', () => {
		const rare = cardData.find((candidate) => candidate.rarity === 'rare') as CardData;
		const amber = hexRgba(DRIVER_COLORS[1]);
		expect(build(rare, 1).resolvedColors?.border).toEqual(amber);
		const unowned = build(rare, null).resolvedColors?.border;
		expect(unowned).not.toEqual(hexRgba(Card.colorForRarity('rare')));
	});

	it('reaches past its top-left corner for the cost hex, and says so in its ink', () => {
		expect(build(cardData[0], 1).inkExtent).toBe(9);
		expect(build(cardData[0], 1, false, CardSize.MINI).inkExtent).toBe(MINI_CARD_INK);
	});

	it('marks a card its driver can\'t pay for, apart from being disabled', () => {
		const card = build(cardData[0], 1);
		expect(card.unaffordable).toBe(false);
		card.unaffordable = true;
		expect(card.unaffordable).toBe(true);
		expect(card.effectivelyEnabled).toBe(true);
	});

	it('shows the range a card reaches as a chip, and none on a card without one', () => {
		const ranged = build(cardData.find((candidate) => candidate.type === 'far_shoot') as CardData, 1);
		expect(part(ranged, 'range').text).toBe('R2');
		const unranged = build(cardData.find((candidate) => candidate.type === 'repair_kit') as CardData, 1);
		expect(unranged.children.some((child) => child.id === 'card_range')).toBe(false);
	});
});

describe('Card state', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it('shows the pointer cursor only once something listens for its click (R8.2)', () => {
		const card = build(cardData[0], 1);
		expect(card.cursor).toBeNull();
		card.onSelect = () => undefined;
		expect(card.cursor).toBe('pointer');
	});

	it('shows the arrow on screen while disabled, select handler or not (R8.2)', () => {
		const shown: string[] = [];
		const local = createTestContext({ draw: createMeasuringDrawApi().api, onCursorChange: (cursor) => shown.push(cursor) });
		const card = new Card({ id: 'card', x: 0, y: 0, data: new GameCard({ ...cardData[0] }), driverNumber: 1 });
		card.onSelect = () => undefined;
		card.mount(local);
		local.frame.layout();
		const box = card.screenBounds;
		local.dispatcher.enqueue(pointer('move', box.x + box.width / 2, box.y + box.height / 2));
		local.dispatcher.dispatchPending();
		card.enabled = false;
		local.dispatcher.dispatchPending();
		expect(shown).toEqual(['pointer', 'default']);
		card.unmount();
	});

	it('rises by its transform when hovered or selected, leaving its position to layout', () => {
		const card = build(cardData[0], 1);
		card.setPosition(40, 25);

		card.hovered = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		expect(card.y).toBe(25);
		card.hovered = false;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, 0]);

		card.selected = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		card.selected = false;
		context.animator.settle();
		expect(card.y).toBe(25);
	});

	it('eases up on the animator rather than jumping', () => {
		const card = build(cardData[0], 1);
		card.hovered = true;
		// The tween starts from where the card rests
		expect(card.transform.translate).toEqual([0, 0]);
		expect(context.animator.settle()).toBeGreaterThan(0);
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
	});

	it('straightens out of its fan pose when lifted, and paints raised over its neighbours', () => {
		const card = build(cardData[0], 1);
		card.fanPose = { rotate: 0.03, drop: 4, order: 2 };
		expect(card.zIndex).toBe(2);
		expect(card.transform.rotate).toBe(0.03);
		expect(card.transform.translate).toEqual([0, 4]);
		expect(card.transform.origin).toEqual([0.5, 1]);
		expect(card.layer).toBeNull();

		card.hovered = true;
		context.animator.settle();
		expect(card.transform.rotate).toBe(0);
		expect(card.transform.scale).toBeGreaterThan(1);
		expect(card.layer).toBe('raised');
		expect(card.zIndex).toBe(2);

		card.hovered = false;
		context.animator.settle();
		expect(card.transform.rotate).toBe(0.03);
		expect(card.layer).toBeNull();
		expect(card.zIndex).toBe(2);
	});

	it('takes a press on the cost hex hanging off its corner, at either size', () => {
		const card = build(cardData[0], 1);
		expect(card.containsPoint(-5, -5)).toBe(true);
		expect(card.containsPoint(-5, 40)).toBe(false);
		const mini = build(cardData[0], 1, false, CardSize.MINI);
		expect(mini.containsPoint(-3, -3)).toBe(true);
		expect(mini.containsPoint(-3, 40)).toBe(false);
	});

	it('dims its resting border when it is disabled under the pointer', () => {
		const card = build(cardData[0], 1);
		card.hovered = true;
		card.enabled = false;
		context.animator.settle();
		expect(card.resolvedColors?.border).not.toEqual(hexRgba(DRIVER_COLORS[1]));
	});

	it('stays in its place when not liftable, as a pile\'s or the browser\'s cards do', () => {
		const card = build(cardData[0], 1);
		card.liftable = false;
		card.hovered = true;
		card.selected = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, 0]);
		expect(card.layer).toBeNull();
		expect(card.resolvedColors?.border).not.toEqual(hexRgba(DRIVER_COLORS[1]));
	});

	it('keeps the strip it rose out of while lifted, so the pointer on its bottom edge holds it up', () => {
		const card = build(cardData[0], 1);
		const below = card.height + CARD_LIFT / 2;
		expect(card.containsPoint(10, below)).toBe(false);
		card.hovered = true;
		context.animator.settle();
		expect(card.containsPoint(10, below)).toBe(true);
	});

	it('does not rise under the pointer while disabled, and dims through the base enabled flag', () => {
		const card = build(cardData[0], 1);
		const enabledFill = card.resolvedColors.fill;

		card.enabled = false;
		card.hovered = true;
		context.animator.settle();
		expect(card.effectivelyEnabled).toBe(false);
		expect(card.transform.translate).toEqual([0, 0]);
		expect(card.resolvedColors.fill).not.toEqual(enabledFill);

		card.enabled = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		expect(card.resolvedColors.fill).toEqual(enabledFill);
	});
});

describe('Card layout lint (DDB-91)', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it.each([CardSize.MINI, CardSize.NORMAL])('lints clean for every card at %s, badged or not', (size) => {
		for (const data of cardData) {
			for (const driverNumber of [1, null] as const) {
				const card = build(data, driverNumber, false, size);
				const { width, height } = Card.getDimensions(size);
				const result = layoutLint(treeSnapshot([card], { width, height }));
				expect({ card: data.name, violations: result.violations }).toEqual({ card: data.name, violations: [] });
			}
		}
	});

	it('draws its frame, art ground, hex, mark and gem itself rather than as child shapes', () => {
		const card = build(cardData[0], 1);
		expect(card.children.every((child) => child instanceof Text || child instanceof KeywordText || child instanceof Icon)).toBe(true);
	});
});

describe('Mini card (Game Flow 7.0)', () => {
	interface Recorded {
		kind: string;
		id?: string | null;
		text?: string;
		rect?: Rect;
		box?: Rect | null;
		points?: readonly { x: number; y: number }[];
		border?: { color: RGBA; width: number } | null;
		fill?: RGBA | null;
	}

	let measuring: ReturnType<typeof createMeasuringDrawApi>;

	beforeAll(() => {
		measuring = createMeasuringDrawApi();
		context = createTestContext({ draw: measuring.api });
	});

	function mini(type: string, options: { copies?: number; miniState?: MiniCardState | null; driverNumber?: 1 | 2 | null } = {}): Card {
		const data = cardData.find((candidate) => candidate.type === type) as CardData;
		const card = new Card({ id: 'card', x: 0, y: 0, data: new GameCard({ ...data }), size: CardSize.MINI, ...options });
		card.mount(context);
		context.frame.layout();
		return card;
	}

	/** One frame of the card's drawing, as it stands on the shared context. */
	function frame(card: Card): Recorded[] {
		const { api, backend } = measuring;
		context.frame.layout();
		api.beginFrame({ viewport: { width: 200, height: 200 } });
		renderTree(card, api);
		api.endFrame();
		return [...backend.commands] as unknown as Recorded[];
	}

	const isTag = (text: string): boolean => text === 'HOME' || text === 'LOCKED' || text.startsWith('+');

	const isFrame = (command: Recorded): boolean => command.kind === 'rect' && command.rect?.x === 0 && command.rect.y === 0 && command.rect.width === 80;

	/** A stack's card edges: card-sized rects drawn ahead of the frame. */
	function edges(commands: Recorded[]): Rect[] {
		const frameAt = commands.findIndex(isFrame);
		return commands.slice(0, frameAt).flatMap((command) => (command.kind === 'rect' && command.rect ? [command.rect] : []));
	}

	const texts = (commands: Recorded[]): string[] => commands.flatMap((command) => (command.kind === 'text' && command.text ? [command.text] : []));
	const dashes = (commands: Recorded[]): Recorded[] => commands.filter((command) => command.kind === 'polygon' && (command.points?.length ?? 0) > 60);

	it('is 80x112, a size of the same Card as the face', () => {
		expect(Card.getDimensions(CardSize.MINI)).toEqual({ width: 80, height: 112 });
		const card = mini('ramming_speed');
		expect(card).toBeInstanceOf(Card);
		expect([card.width, card.height]).toEqual([80, 112]);
		expect(card.size).toBe(CardSize.MINI);
	});

	it('fits every name from cards.json on two lines at most, upgraded or not, without the ellipsis', () => {
		for (const data of cardData) {
			for (const upgraded of [false, true]) {
				const card = new Card({ id: 'card', x: 0, y: 0, data: new GameCard({ ...data, upgraded }), size: CardSize.MINI });
				card.mount(context);
				context.frame.layout();
				const title = part(card, 'title');
				expect([data.name, upgraded, (title.measured?.lines ?? 3) <= 2, title.overflowOutcome]).toEqual([data.name, upgraded, true, 'none']);
			}
		}
	});

	it('shows the cost, name, art, type and rarity gem, and no summary', () => {
		const card = mini('ramming_speed', { driverNumber: 1 });
		expect(card.children.map((child) => child.id)).toEqual(['card_title', 'card_art', 'card_type']);
		expect(part(card, 'title').text).toBe('Ramming Speed');
		expect(part(card, 'type').text).toBe('ATK');
		expect(card.faceWords).toEqual([]);
		expect(card.summaryLines).toBe(0);
		const commands = frame(card);
		expect(texts(commands)).toContain(`${card.data.cost}`);
		const gem = GEM_FILLS[card.data.rarity].full;
		expect(commands.filter((command) => command.kind === 'polygon' && command.points?.length === 4).map((command) => command.fill)).toContainEqual(gem);
	});

	it('stacks copies with up to two card edges behind and an xN count', () => {
		const one = frame(mini('ramming_speed'));
		expect(edges(one)).toEqual([]);
		expect(texts(one).filter((text) => text.startsWith('x'))).toEqual([]);

		const pair = frame(mini('ramming_speed', { copies: 2 }));
		expect(edges(pair).map((rect) => [rect.x, rect.y])).toEqual([[3, 3]]);
		expect(texts(pair)).toContain('x2');

		for (const copies of [5, 20]) {
			const card = mini('ramming_speed', { copies });
			const commands = frame(card);
			// Back to front, the furthest first
			expect(edges(commands).map((rect) => [rect.x, rect.y])).toEqual([[6, 6], [3, 3]]);
			expect(texts(commands)).toContain(`x${copies}`);
			expect(card.drawnText).toEqual([`x${copies}`]);
		}
	});

	it('puts the count across the bottom edge, flush with the stack\'s last edge', () => {
		const countBox = (card: Card): Rect | null => frame(card).find((command) => command.kind === 'text' && command.text?.startsWith('x'))?.box ?? null;
		const pair = countBox(mini('ramming_speed', { copies: 2 }));
		const five = countBox(mini('ramming_speed', { copies: 5 }));
		if (!pair || !five) throw new Error('no count drawn');
		expect(pair.x + pair.width).toBeCloseTo(83);
		expect(five.x + five.width).toBeCloseTo(86);
		expect(five.y + five.height / 2).toBeCloseTo(112);
	});

	it('restacks in place when its copies change', () => {
		const card = mini('ramming_speed');
		card.copies = 3;
		expect(edges(frame(card))).toHaveLength(2);
		expect(card.drawnText).toEqual(['x3']);
		card.copies = 2;
		expect(edges(frame(card))).toHaveLength(1);
		card.copies = 1;
		expect(edges(frame(card))).toEqual([]);
		expect(card.drawnText).toBeNull();
	});

	it('draws a borrowed copy\'s frame in dashes, one triangle list in its driver\'s colour, and tags it +1', () => {
		const card = mini('medical_kit', { miniState: 'borrowed', driverNumber: 1 });
		const commands = frame(card);
		expect(commands.find(isFrame)?.border).toBeNull();
		const dashed = dashes(commands);
		expect(dashed).toHaveLength(1);
		expect((dashed[0].points?.length ?? 0) % 3).toBe(0);
		expect(dashed[0].fill).toEqual(hexRgba(DRIVER_COLORS[1]));
		expect(texts(commands)).toContain('+1');
		expect(card.drawnText).toEqual(['+1']);
		expect(card.resolvedColors.border).toEqual(hexRgba(DRIVER_COLORS[1]));
		// A borrowed pair adds two
		card.copies = 2;
		expect(card.drawnText).toEqual(['+2', 'x2']);
	});

	it('keeps its dashes inside its box and clear of the rounded corners', () => {
		const [dashed] = dashes(frame(mini('medical_kit', { miniState: 'borrowed' })));
		for (const point of dashed.points ?? []) {
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x).toBeLessThanOrEqual(80);
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y).toBeLessThanOrEqual(112);
			const fromSide = Math.min(point.x, 80 - point.x);
			const fromEnd = Math.min(point.y, 112 - point.y);
			expect(fromSide >= 5 - 1e-6 || fromEnd >= 5 - 1e-6).toBe(true);
		}
	});

	it('goes solid under the pointer and back to dashes after', () => {
		const card = mini('medical_kit', { miniState: 'borrowed' });
		card.hovered = true;
		const hovered = frame(card);
		expect(dashes(hovered)).toEqual([]);
		expect(hovered.find(isFrame)?.border?.width).toBe(2);
		card.hovered = false;
		expect(dashes(frame(card))).toHaveLength(1);
	});

	it('fades a card left at home and tags it HOME, and fades an unavailable one with no tag', () => {
		const plain = mini('nitro_boost').resolvedColors.fill;
		const home = mini('nitro_boost', { miniState: 'home' });
		expect(home.resolvedColors.fill).not.toEqual(plain);
		expect(home.drawnText).toEqual(['HOME']);
		expect(texts(frame(home))).toContain('HOME');

		const unavailable = mini('emp_blast', { miniState: 'unavailable' });
		expect(unavailable.resolvedColors.fill).not.toEqual(plain);
		expect(unavailable.drawnText).toBeNull();
		expect(texts(frame(unavailable)).filter(isTag)).toEqual([]);
	});

	it('stays enabled and focusable when faded, since its detail view still opens', () => {
		const card = mini('emp_blast', { miniState: 'unavailable' });
		card.focusable = true;
		expect(card.effectivelyEnabled).toBe(true);
		expect(card.canReceiveFocus()).toBe(true);
	});

	it('tags an escort\'s locked card LOCKED at full strength', () => {
		const plain = mini('triage', { driverNumber: 1 }).resolvedColors;
		const locked = mini('triage', { miniState: 'locked', driverNumber: 1 });
		expect(locked.resolvedColors).toEqual(plain);
		expect(locked.drawnText).toEqual(['LOCKED']);
	});

	it('drops its tag, fade and dashes when its state goes back to null', () => {
		const card = mini('nitro_boost');
		const plain = card.resolvedColors.fill;
		card.miniState = 'home';
		card.miniState = 'borrowed';
		card.miniState = null;
		expect(card.resolvedColors.fill).toEqual(plain);
		expect(card.drawnText).toBeNull();
		const commands = frame(card);
		expect(dashes(commands)).toEqual([]);
		expect(commands.find(isFrame)?.border?.width).toBe(2);
	});

	it('refuses a count that is not a whole number of copies, and a stack or a state on a face', () => {
		const card = mini('ram');
		expect(() => { card.copies = 0; }).toThrow();
		expect(() => { card.copies = 1.5; }).toThrow();
		const face = build(cardData[0], 1);
		expect(() => { face.copies = 2; }).toThrow();
		expect(() => { face.miniState = 'home'; }).toThrow();
		face.copies = 1;
		face.miniState = null;
		expect(face.copies).toBe(1);
		expect(face.miniState).toBeNull();
	});

	it('draws nothing further than MINI_CARD_INK past its box, however it is stacked and tagged', () => {
		for (const miniState of ['borrowed', 'home', 'locked', 'unavailable'] as const) {
			const card = mini('coordinated_attack', { copies: 20, miniState });
			expect(card.inkExtent).toBe(MINI_CARD_INK);
			for (const command of frame(card)) {
				const box = command.rect ?? command.box ?? null;
				const xs = box ? [box.x, box.x + box.width] : (command.points ?? []).map((point) => point.x);
				const ys = box ? [box.y, box.y + box.height] : (command.points ?? []).map((point) => point.y);
				for (const x of xs) expect([miniState, x >= -MINI_CARD_INK && x <= 80 + MINI_CARD_INK]).toEqual([miniState, true]);
				for (const y of ys) expect([miniState, y >= -MINI_CARD_INK && y <= 112 + MINI_CARD_INK]).toEqual([miniState, true]);
			}
		}
	});

	it('stays put under the pointer, as a card in a grid does', () => {
		const card = mini('ram');
		expect(card.liftable).toBe(false);
		card.hovered = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, 0]);
	});

	it('hands the draw API the same objects every frame, and measures its tag and count only once', () => {
		const { api } = createMeasuringDrawApi();
		const local = createTestContext({ draw: api });
		const measured = jest.spyOn(api, 'measureText');
		const card = new Card({ id: 'card', x: 0, y: 0, data: new GameCard({ ...cardData[0] }), size: CardSize.MINI, copies: 5, miniState: 'borrowed' });
		card.mount(local);
		local.frame.layout();
		const handed: unknown[][] = [];
		for (let index = 0; index < 3; index++) {
			const calls: unknown[] = [];
			const record = (options: unknown): void => { calls.push(options); };
			const spies = [
				jest.spyOn(api, 'drawRect').mockImplementation(record),
				jest.spyOn(api, 'drawPolygon').mockImplementation(record),
				jest.spyOn(api, 'drawText').mockImplementation(record),
			];
			card.render(api);
			for (const spy of spies) spy.mockRestore();
			handed.push(calls);
			card.invalidateLayout();
			local.frame.layout();
		}
		expect(handed[0].length).toBeGreaterThan(0);
		for (const calls of handed.slice(1)) {
			expect(calls).toHaveLength(handed[0].length);
			calls.forEach((options, index) => expect(options).toBe(handed[0][index]));
		}
		const own = measured.mock.calls.filter(([options]) => options.text === 'x5' || options.text === '+5');
		expect(own.map(([options]) => options.text).sort()).toEqual(['+5', 'x5']);
		measured.mockRestore();
		card.unmount();
	});

	it('opens the detail view on hover, at once on keyboard focus, and on a touch hold, as every size does', () => {
		const local = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
		const deck = new Container({ id: 'deck', x: 0, y: 0, width: 300, height: 300 });
		const card = new Card({ id: 'card', x: 20, y: 20, data: new GameCard({ ...cardData[0] }), size: CardSize.MINI, copies: 3, miniState: 'home' });
		card.focusable = true;
		makeInspectable(card);
		deck.addChild(card);
		inspectOnContextMenu(deck);
		deck.mount(local);
		local.frame.layout();
		const settleHidden = (): void => {
			advance(local, tokens.motion.dur_tooltip_hide + 100);
			expect(local.tooltips.surface).toBeNull();
		};

		const box = card.screenBounds;
		const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		send(local, [pointer('move', centre.x, centre.y)]);
		advance(local, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(local.tooltips.owner).toBe(card);
		const surface = local.tooltips.surface;
		expect(surface).toBeInstanceOf(CardInspectSurface);
		if (surface instanceof CardInspectSurface) expect(surface.view.detail.data).toBe(card.data);
		send(local, [pointer('move', 600, 600)]);
		settleHidden();

		local.focus.pushScope(deck);
		local.focus.focus(card, 'keyboard');
		local.frame.layout();
		expect(local.tooltips.owner).toBe(card);
		expect(local.tooltips.surface).toBeInstanceOf(CardInspectSurface);
		local.focus.popScope(deck);
		local.tooltips.hide();
		settleHidden();

		send(local, [pointer('down', centre.x, centre.y, { pointerType: 'touch', pointerId: 2 })]);
		advance(local, 600);
		expect(local.tooltips.owner).toBe(card);
		expect(local.tooltips.surface).toBeInstanceOf(CardInspectSurface);
		send(local, [pointer('up', centre.x, centre.y, { pointerType: 'touch', pointerId: 2 })]);
		local.tooltips.hide();
		deck.unmount();
	});

	it('draws its own focus ring, once, under its hex, its tag and its count, at either size', () => {
		const card = mini('ramming_speed', { copies: 5, miniState: 'home' });
		const face = build(cardData[0], 1);
		for (const focused of [card, face]) {
			expect(focused.drawsOwnFocusRing).toBe(true);
			focused.focusable = true;
			context.focus.pushScope(focused);
			context.focus.focus(focused, 'keyboard');
			const commands = frame(focused);
			const rings = commands.filter((command) => command.id === 'card.focus_ring');
			expect(rings).toHaveLength(1);
			const ringAt = commands.indexOf(rings[0]);
			const hexAt = commands.findIndex((command) => command.kind === 'polygon' && command.points?.length === 6);
			expect(ringAt).toBeLessThan(hexAt);
			if (focused === card) {
				expect(ringAt).toBeLessThan(commands.findIndex((command) => command.text === 'HOME'));
				expect(ringAt).toBeLessThan(commands.findIndex((command) => command.text === 'x5'));
			}
			context.focus.blur();
			context.focus.popScope(focused);
			expect(frame(focused).filter((command) => command.id === 'card.focus_ring')).toEqual([]);
		}
	});

	it('takes the pointer on its shown stack edges, tag and count, as on its hex', () => {
		const single = mini('ram');
		expect(single.containsPoint(82, 114)).toBe(false);
		expect(single.containsPoint(82, -3)).toBe(false);
		expect(single.containsPoint(-3, -3)).toBe(true);

		const pair = mini('ram', { copies: 2 });
		expect(pair.containsPoint(82, 114)).toBe(true);
		expect(pair.containsPoint(85, 117)).toBe(false);

		const stack = mini('ram', { copies: 5, miniState: 'home' });
		// The back edge, the count's lower half, and the tag past the right edge
		expect(stack.containsPoint(85, 117)).toBe(true);
		expect(stack.containsPoint(84, 118.5)).toBe(true);
		expect(stack.containsPoint(82, -3)).toBe(true);
		expect(stack.containsPoint(87, 116)).toBe(false);
		expect(stack.containsPoint(40, -3)).toBe(false);
	});

	it('stays hovered as the pointer moves from its body onto its count', () => {
		const card = mini('ram', { copies: 5 });
		context.dispatcher.enqueue(pointer('move', 40, 56));
		context.dispatcher.dispatchPending();
		expect(card.hovered).toBe(true);
		context.dispatcher.enqueue(pointer('move', 84, 118));
		context.dispatcher.dispatchPending();
		expect(card.hovered).toBe(true);
		context.dispatcher.enqueue(pointer('move', 150, 150));
		context.dispatcher.dispatchPending();
		expect(card.hovered).toBe(false);
	});

	it('keeps a focused face\'s outline through a change of driver, and moves a borrowed stack\'s dashes and edges to the new colour', () => {
		const face = build(cardData[0], 1);
		face.focusable = true;
		context.focus.pushScope(face);
		context.focus.focus(face, 'keyboard');
		face.driver = 2;
		expect(face.resolvedColors.border).toEqual(tokens.color.accent);
		context.focus.blur();
		context.focus.popScope(face);
		expect(face.resolvedColors.border).toEqual(hexRgba(DRIVER_COLORS[2]));

		const stack = mini('medical_kit', { copies: 3, miniState: 'borrowed', driverNumber: 1 });
		stack.driver = 2;
		const commands = frame(stack);
		expect(dashes(commands)[0].fill).toEqual(hexRgba(DRIVER_COLORS[2]));
		const frameAt = commands.findIndex(isFrame);
		const edgeLines = commands.slice(0, frameAt).map((command) => command.border?.color);
		expect(edgeLines).toEqual([scale(hexRgba(DRIVER_COLORS[2]), 0.7), scale(hexRgba(DRIVER_COLORS[2]), 0.7)]);
	});

	it('outlines an unowned stack\'s edges in the opaque dim line, which a dark screen still shows', () => {
		const commands = frame(mini('oil_slick', { copies: 3 }));
		const frameAt = commands.findIndex(isFrame);
		const edgeLines = commands.slice(0, frameAt).map((command) => command.border?.color);
		expect(edgeLines).toEqual([CARD_DIM_FILLS.full, CARD_DIM_FILLS.full]);
		expect(CARD_DIM_FILLS.full[3]).toBe(1);
	});

	it('forgets its walked group count whenever its stack, state or dashes change what it draws', () => {
		const card = mini('ram');
		frame(card);
		expect(card.walkedGroupCount).toBeGreaterThan(0);
		card.copies = 3;
		expect(card.walkedGroupCount).toBe(-1);
		frame(card);
		card.miniState = 'borrowed';
		expect(card.walkedGroupCount).toBe(-1);
		frame(card);
		card.hovered = true;
		expect(card.walkedGroupCount).toBe(-1);
		frame(card);
		card.driver = 1;
		expect(card.walkedGroupCount).toBe(-1);
	});

	it('spaces a grid of minis clear of every card\'s ink', () => {
		expect(MINI_GRID.gap).toBeGreaterThanOrEqual(MINI_CARD_INK * 2);
		expect(MINI_GRID.margin).toBeGreaterThanOrEqual(MINI_CARD_INK);
		expect(miniGridHeight(1)).toBe(112);
		expect(miniGridHeight(2)).toBe(112 * 2 + MINI_GRID.gap);
		expect(miniGridHeight(0)).toBe(0);
	});

	it.each(['borrowed', 'home', 'locked', 'unavailable', null] as const)('lints clean for every card stacked and %s', (miniState) => {
		for (const data of cardData) {
			const card = new Card({ id: 'card', x: 0, y: 0, data: new GameCard({ ...data }), size: CardSize.MINI, copies: 5, miniState, driverNumber: 1 });
			card.mount(context);
			context.frame.layout();
			const result = layoutLint(treeSnapshot([card], { width: 80, height: 112 }));
			expect({ card: data.name, violations: result.violations }).toEqual({ card: data.name, violations: [] });
		}
	});
});
