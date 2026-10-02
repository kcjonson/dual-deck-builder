import { Stack, StackOptions } from '../../engine/components/Stack';
import { Text } from '../../engine/components/Text';
import type { MountContext } from '../../engine/components/MountContext';
import { tokens } from '../../engine/theme/tokens';
import { Dialog } from '../../engine/ui/Dialog';
import { ScrollContainer } from '../../engine/ui/ScrollContainer';
import type { Card as GameCard } from '../mechanics/Card';
import { Card as UICard } from './Card';
import { CARD_NAME, CARD_MUTED } from './cardStyle';
import { FlowWrap } from './FlowWrap';
import { INSPECT_KEYS, inspectHotkey, inspectOnContextMenu, makeInspectable } from './cardInspect';

const CARD_GAP = 12;

export interface CardPileViewOptions extends StackOptions {
	id: string;
	title: string;
	cards: readonly GameCard[];
	/** The seat whose cards these are, for the frame colour and mark; null for none (a reward). */
	driver?: 1 | 2 | null;
	/** A line under the title. */
	note?: string;
	/** Makes each card a choice, as a reward is: clicked or activated, it is picked. */
	onPick?: (card: GameCard) => void;
}

/**
 * A titled set of card faces that wrap at the view's width, every one
 * inspectable with the same detail view as the hand (Battle Screen Design,
 * section 5): the draw and discard piles, and a reward's choice of cards.
 * Every card takes keyboard focus, which opens its detail view, so a pile
 * can be read without a pointer.
 */
export class CardPileView extends Stack {
	private readonly faces: UICard[];

	constructor({ id, title, cards, driver = null, note, onPick, ...options }: CardPileViewOptions) {
		super({ id, direction: 'vertical', gap: tokens.space.space_3, crossAlign: 'stretch', focusGroup: { orientation: 'horizontal' }, ...options });
		this.addChild(new Text({
			id: `${id}_title`,
			text: title,
			style: { fontRole: 'display', fontSize: 18, color: CARD_NAME, letterSpacing: 0.04, textTransform: 'uppercase' },
			wrap: 'none',
		}));
		if (note) {
			this.addChild(new Text({ id: `${id}_note`, text: note, style: { fontRole: 'mono', fontSize: 11, color: CARD_MUTED } }));
		}
		const row = new FlowWrap({ id: `${id}_cards`, gap: CARD_GAP });
		this.faces = cards.map((card, index) => {
			const face = new UICard({ id: `${id}_card_${index}`, x: 0, y: 0, data: card, driverNumber: driver });
			face.focusable = true;
			face.liftable = false;
			makeInspectable(face);
			if (onPick) face.onSelect = onPick;
			row.addChild(face);
			return face;
		});
		// An empty pile says so rather than hugging an empty row to nothing
		if (cards.length > 0) this.addChild(row);
		else this.addChild(new Text({ id: `${id}_empty`, text: 'Empty.', style: { fontSize: 13, color: CARD_MUTED } }));
		inspectOnContextMenu(this);
	}

	/** The faces, in order. */
	public get cards(): readonly UICard[] {
		return this.faces;
	}
}

/** The deck shown face up gives nothing away in name order, never draw order. */
export function drawPileOrder(cards: readonly GameCard[]): GameCard[] {
	return [...cards].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const PILE_SCROLL_HEIGHT = 420;
/** What the dialog's header, padding and edges take around the scroller. */
const DIALOG_CHROME = 140;

/**
 * A driver's draw and discard piles in a dialog, from the pile icons on their tab:
 * the draw pile in name order, the discard in the order it was made. I
 * pins a card's detail view here too, since a modal dialog's hotkeys are
 * the only ones heard while it is open.
 */
export function openPileDialog(context: MountContext, { driverName, driver, drawPile, discardPile }: {
	driverName: string;
	driver: 1 | 2;
	drawPile: readonly GameCard[];
	discardPile: readonly GameCard[];
}): Dialog {
	const piles = new Stack({ id: 'piles_list', direction: 'vertical', gap: tokens.space.space_6, crossAlign: 'stretch' });
	piles.addChild(new CardPileView({ id: 'piles_draw', title: `Draw pile (${drawPile.length})`, note: 'Shown in name order; the draw order stays hidden.', cards: drawPileOrder(drawPile), driver }));
	piles.addChild(new CardPileView({ id: 'piles_discard', title: `Discard pile (${discardPile.length})`, cards: discardPile, driver }));
	const height = Math.max(200, Math.min(PILE_SCROLL_HEIGHT, context.viewport.logical.height - DIALOG_CHROME));
	const scroller = new ScrollContainer({ id: 'piles_scroll', widthMode: 'fill', height });
	scroller.addChild(piles);
	const dialog = new Dialog({ id: 'piles_dialog', title: driverName, kicker: 'DRAW AND DISCARD', size: 'lg', content: scroller, dismissOnOutsidePress: true });
	dialog.show(context);
	for (const key of INSPECT_KEYS) dialog.overlay?.hotkeys.register(key, () => inspectHotkey(context));
	return dialog;
}
