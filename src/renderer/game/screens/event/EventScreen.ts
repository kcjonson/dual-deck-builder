import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { loadedCardLookup } from '../../core/CardLoader';
import { NO_RESOURCES } from '../../campaign/Campaign';
import { EVENTS, EventParty, EventResult, GameEvent, choiceLock, resolveChoice } from '../../campaign/Events';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { FocusGroup } from '../../../engine/ui/FocusGroup';
import { tokens } from '../../../engine/theme/tokens';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { LegendBox } from '../../ui/atlas/LegendBox';
import { PlateFrame } from '../../ui/atlas/PlateFrame';
import { Card as UICard, CardSize } from '../../ui/Card';
import type { CardLookup } from '../../ui/DriverDetailView';
import { EscortCard } from '../../ui/EscortCard';
import { escortCardData } from '../../ui/escortCardData';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeEscortInspectable, makeInspectable } from '../../ui/cardInspect';
import { PRIMARY_HEIGHT, PRIMARY_LABEL, caption, screenTitle, titleNote } from '../area-map/atlasPanel';
import { CHOICE_CARD_HEIGHT, ChoiceCard } from './ChoiceCard';
import { EventIcon } from './EventIcon';
import { EventPlate } from './EventPlate';
import { JournalPage } from './JournalPage';
import { LedgerLine, eventKicker, goLabel, resultLines } from './eventText';

const { space } = tokens;
const SHEET_GAP = 16;
const COLUMN_GAP = 20;
const CHOICE_GAP = 12;
const GO_WIDTH = 240;
/** The journal's type: larger where the window is tall enough for the page to hold it, as at 1440x882. */
const JOURNAL_SIZE = 14;
const JOURNAL_SIZE_TALL = 17;
const TALL_VIEWPORT = 800;
const JOURNAL_LINE = 1.45;
/** The plate takes this share of the top row against the journal's 1. */
const PLATE_WEIGHT = 0.75;
/** Number keys take the choice in that place, as the cards are numbered left to right. */
const CHOICE_KEYS = ['1', '2', '3', '4'] as const;

/**
 * What opens the event screen: the event at the stop, the party it checks
 * choices against, and the draw the outcome lands on, from the run's stream.
 * The run rolls the draw when the stop opens and saves it with the step, so
 * a reload can't roll the outcome again. With `result`, a choice already
 * made (a saved step reopening mid-event), the screen opens on its outcome.
 */
export interface EventScreenData {
	event: GameEvent;
	party: EventParty;
	/** Mono beside the kicker: "stop 2 of 5". */
	where?: string;
	/** In [0, 1). Default 0. */
	draw?: number;
	result?: EventResult;
	/** Hears the choice as it's made, before the outcome shows, so the run can apply and save it. */
	onChoose?: (result: EventResult) => void;
	/** Drive on, or into the fight the outcome hands off to. Default: back to the main menu, as nothing hooks the screen up yet. */
	onDone?: (result: EventResult) => void;
}

export interface EventScreenOptions {
	/** Where the cards an outcome gives are looked up. Default: the bundled cards, loaded once. */
	cards?: () => Promise<CardLookup>;
}

/**
 * The party the screen checks against when it's opened with no data, by the
 * dev navigate hook or the screen capture: a Road Warrior and a Mechanic,
 * no escort, a little fuel and scrap, so the first event shows a choice
 * open to the Mechanic, one any party can take, and one that's locked.
 */
export const STAND_IN_PARTY: EventParty = Object.freeze<EventParty>({
	archetypes: ['road_warrior', 'mechanic'],
	cards: { ram: 2, repair_kit: 2 },
	escorts: [],
	resources: { ...NO_RESOURCES, fuel: 2, scrap: 5 },
});

/**
 * The event screen (Game Flow and UI Specification, 5; DDB-45): the stops
 * that aren't fights. A storybook page on the atlas sheet: the plate on the
 * left, the journal beside it (the setup, then the situation), and under
 * them the choices as cards (Game Flow 7.0), each with its risks and what it
 * can give, and the locked ones saying why. Taking a choice, by click,
 * Enter, or its number key, resolves it with the draw the screen was
 * handed; the cards give way to what happened: the outcome, what it gave
 * and took, any cards or escort it gave drawn as cards, and the highway on
 * (Drive on, or Fight them for a hand-off).
 *
 * It applies nothing. The result is plain data (`EventResult`) the run
 * applies through `onChoose`, and `onDone` is where it goes next. The
 * decision record is docs/AI_TECHNICAL_DECISIONS/event-screen.md.
 */
export class EventScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private readonly loadCards: () => Promise<CardLookup>;
	private lookup: CardLookup | null = null;
	private event: GameEvent = EVENTS[0];
	private party: EventParty = STAND_IN_PARTY;
	private draw = 0;
	private onChoose: ((result: EventResult) => void) | null = null;
	private onDone: ((result: EventResult) => void) | null = null;
	private taken: EventResult | null = null;
	private top: Stack | null = null;
	private foot: Stack | null = null;
	private cardGroup: FocusGroup | null = null;
	private rewardRow: Stack | null = null;
	private goButton: AtlasButton | null = null;
	private readonly journal: Text[] = [];
	private page: JournalPage | null = null;
	private visit = 0;
	private loaded: Promise<void> = Promise.resolve();

	constructor({ cards = loadedCardLookup }: EventScreenOptions = {}) {
		const root = new AtlasSheet({ id: 'eventScreen', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: SHEET_GAP });
		super('eventScreen', { root, theme: 'atlas' });
		this.sheet = root;
		this.loadCards = cards;
	}

	public get shownEvent(): GameEvent {
		return this.event;
	}

	/** The choice taken and what came of it, once there is one. */
	public get result(): EventResult | null {
		return this.taken;
	}

	/** Settles once the cards an outcome can show are loaded, or failed to. */
	public get cardsLoaded(): Promise<void> {
		return this.loaded;
	}

	protected onMount(data?: unknown): void {
		this.visit += 1;
		const handed = data as Partial<EventScreenData> | undefined;
		this.event = handed?.event ?? EVENTS[0];
		this.party = handed?.party ?? STAND_IN_PARTY;
		this.draw = handed?.draw ?? 0;
		this.onChoose = handed?.onChoose ?? null;
		this.onDone = handed?.onDone ?? null;
		this.taken = null;

		this.top = this.createTop(handed?.where ?? null);
		this.sheet.addChild(this.top);
		this.foot = new Stack({ id: 'event_foot', direction: 'horizontal', widthMode: 'fill', height: CHOICE_CARD_HEIGHT, crossAlign: 'stretch', gap: COLUMN_GAP });
		this.sheet.addChild(this.foot);

		const hotkeys = this.rootLayer.hotkeys;
		CHOICE_KEYS.forEach((key, place) => hotkeys.register(key, () => this.takeAt(place)));
		for (const key of INSPECT_KEYS) hotkeys.register(key, () => inspectHotkey(this.context));

		if (handed?.result) this.showOutcome(handed.result);
		else this.showChoices();
		this.fitJournal();

		const visit = this.visit;
		this.loaded = this.loadCards().then(
			(lookup) => {
				if (visit !== this.visit) return;
				this.lookup = lookup;
				if (this.taken) this.fillRewards(this.taken);
			},
			(error) => {
				console.error('EventScreen: the cards could not be loaded', error);
			},
		);
	}

	protected onUnmount(): void {
		this.visit += 1;
		const hotkeys = this.rootLayer.hotkeys;
		for (const key of [...CHOICE_KEYS, ...INSPECT_KEYS]) hotkeys.unregister(key);
		if (this.top) this.sheet.removeChild(this.top);
		if (this.foot) this.sheet.removeChild(this.foot);
		this.top = null;
		this.foot = null;
		this.cardGroup = null;
		this.rewardRow = null;
		this.goButton = null;
		this.journal.length = 0;
		this.page = null;
		this.taken = null;
		this.onChoose = null;
		this.onDone = null;
	}

	protected onResized(): void {
		this.fitJournal();
	}

	/** The journal's paragraphs at the size the window has room for. */
	private fitJournal(): void {
		const size = this.context.viewport.logical.height >= TALL_VIEWPORT ? JOURNAL_SIZE_TALL : JOURNAL_SIZE;
		for (const paragraph of this.journal) paragraph.fontSize = size;
		if (this.page) this.page.pitch = size * JOURNAL_LINE;
	}

	/** A journal paragraph, kept so a resize can set its size. */
	private paragraph({ id, text }: { id: string; text: string }): Text {
		const paragraph = journalText({ id, text, color: 'text' });
		this.journal.push(paragraph);
		return paragraph;
	}

	/** The plate, and beside it the title and the journal. */
	private createTop(where: string | null): Stack {
		const { event } = this;
		const top = new Stack({ id: 'event_top', direction: 'horizontal', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: COLUMN_GAP });
		const plate = new PlateFrame({ id: 'event_plate', caption: `PLATE · ${event.illustration.caption}`.toUpperCase(), widthMode: 'fill', heightMode: 'fill' });
		plate.fillWeight = PLATE_WEIGHT;
		plate.art.addChild(new EventPlate({ id: 'event_plate_sketch', stopType: event.stopType }));
		top.addChild(plate);

		const journal = new Stack({ id: 'event_journal', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: space.space_2 });
		const head = new Stack({ id: 'event_head', direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: space.space_3 });
		head.addChild(screenTitle({ id: 'event_title', text: event.title }));
		const kicker = [eventKicker(event.stopType), where].filter((part) => part !== null && part !== '').join(' / ');
		head.addChild(titleNote({ id: 'event_kicker', text: kicker }));
		journal.addChild(head);
		const page = new JournalPage({ id: 'event_page', pitch: JOURNAL_SIZE * JOURNAL_LINE, widthMode: 'fill', heightMode: 'fill' });
		this.page = page;
		page.addChild(this.paragraph({ id: 'event_setup', text: event.setup }));
		page.addChild(this.paragraph({ id: 'event_situation', text: event.situation }));
		journal.addChild(page);
		top.addChild(journal);
		return top;
	}

	/** The choices as cards, left to right in the file's order, numbered by place for the keys. */
	private showChoices(): void {
		const foot = this.foot;
		if (!foot) return;
		foot.clearChildren();
		const group = new FocusGroup({ id: 'event_choices', orientation: 'horizontal', direction: 'horizontal', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: CHOICE_GAP });
		this.event.choices.forEach((choice, place) => {
			const lock = choiceLock({ choice, party: this.party });
			group.addChild(new ChoiceCard({ id: `event_choice_${choice.id}`, choice, lock, hotkey: CHOICE_KEYS[place], onClick: () => this.take(choice.id) }));
		});
		foot.addChild(group);
		this.cardGroup = group;
		const first = group.children.find((card) => card instanceof ChoiceCard && card.lock === null);
		if (first) this.context.focus.focus(first);
	}

	private takeAt(place: number): boolean {
		const choice = this.event.choices[place];
		if (!choice || this.taken) return false;
		return this.take(choice.id);
	}

	/** Resolves a choice the party can take, tells the run, and shows what happened. */
	private take(choice: string): boolean {
		if (this.taken) return false;
		const offered = this.event.choices.find(({ id }) => id === choice);
		if (!offered || choiceLock({ choice: offered, party: this.party }) !== null) return false;
		const result = resolveChoice({ event: this.event, choice, party: this.party, draw: this.draw });
		this.onChoose?.(result);
		this.showOutcome(result);
		return true;
	}

	/** The outcome in its box, the cards it gave beside it, and the highway on. */
	private showOutcome(result: EventResult): void {
		const foot = this.foot;
		if (!foot) return;
		this.taken = result;
		this.cardGroup = null;
		foot.clearChildren();
		const { outcome } = result;
		const chosen = this.event.choices.find(({ id }) => id === result.choice);
		const box = new LegendBox({ id: 'event_outcome', title: chosen?.title ?? result.choice, fresh: true, widthMode: 'fill', heightMode: 'fill', gap: space.space_1_5 });
		box.addChild(journalText({ id: 'event_outcome_text', text: outcome.text, color: 'text' }));
		const ledger = new Stack({ id: 'event_outcome_ledger', widthMode: 'fill', crossAlign: 'stretch', gap: space.space_1 });
		const lines = resultLines(result);
		lines.forEach((line, index) => ledger.addChild(ledgerLine({ id: `event_outcome_line_${index}`, line })));
		if (lines.length > 0) box.addChild(ledger);
		foot.addChild(box);

		this.rewardRow = new Stack({ id: 'event_rewards', direction: 'horizontal', heightMode: 'fill', crossAlign: 'center', gap: space.space_3 });
		inspectOnContextMenu(this.rewardRow);
		foot.addChild(this.rewardRow);
		this.fillRewards(result);

		const go = new Stack({ id: 'event_go', width: GO_WIDTH, heightMode: 'fill', distribution: 'end', crossAlign: 'stretch' });
		this.goButton = new AtlasButton({
			id: 'event_go_button',
			label: goLabel({ fight: outcome.fight !== null }),
			variant: 'highway',
			shield: true,
			labelSize: PRIMARY_LABEL,
			height: PRIMARY_HEIGHT,
			block: true,
			onClick: () => this.done(),
		});
		go.addChild(this.goButton);
		foot.addChild(go);
		this.context.focus.focus(this.goButton);
	}

	/** The cards and escort an outcome gave, as cards (Game Flow 7.0), once the cards are loaded. */
	private fillRewards(result: EventResult): void {
		const row = this.rewardRow;
		const lookup = this.lookup;
		if (!row || !lookup) return;
		row.clearChildren();
		const { outcome } = result;
		for (const [cardType, copies] of Object.entries(outcome.cards)) {
			const data = lookup(cardType);
			if (!data) continue;
			const card = new UICard({ id: `event_reward_${cardType}`, x: 0, y: 0, data, size: CardSize.MINI, copies });
			card.focusable = true;
			makeInspectable(card);
			row.addChild(card);
		}
		if (outcome.escort) {
			const escort = new EscortCard({ id: `event_reward_${outcome.escort}`, data: escortCardData({ type: outcome.escort }), cards: lookup });
			escort.focusable = true;
			makeEscortInspectable(escort);
			row.addChild(escort);
		}
		row.visible = row.children.length > 0;
	}

	private done(): void {
		const result = this.taken;
		if (!result) return;
		if (this.onDone) this.onDone(result);
		else ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/** A journal paragraph: body at 14 over 1.45, wrapping to the page. */
function journalText({ id, text, color }: { id: string; text: string; color: 'text' | 'text_dim' }): Text {
	return new Text({ id, text, widthMode: 'fill', lineHeight: JOURNAL_LINE, style: { fontSize: JOURNAL_SIZE, color } });
}

/** A ledger line under the outcome: its icon, then what it says. */
function ledgerLine({ id, line }: { id: string; line: LedgerLine }): Stack {
	const row = new Stack({ id, direction: 'horizontal', widthMode: 'fill', crossAlign: 'center', gap: space.space_2 });
	row.addChild(new EventIcon({ id: `${id}_icon`, kind: line.icon, tone: line.tone }));
	row.addChild(caption({ id: `${id}_text`, text: line.text, color: line.tone === 'cost' ? 'status_crit' : 'text' }));
	return row;
}
