import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Stack } from '../../../engine/components/Stack';
import { Card as UICard, CardSize, MINI_CARD_INK, MiniCardState } from '../../ui/Card';
import { inspectOnContextMenu, makeInspectable } from '../../ui/cardInspect';
import { sampleCard } from './CardDetailSection';

/** A caption under each mini, wrapping inside this, as the board's do. */
const CAPTION_WIDTH = 96;

interface MiniCase {
	id: string;
	type: string;
	caption: string;
	copies?: number;
	state?: MiniCardState;
}

/** A driver's run deck at load out, every state a copy in it can be in. */
const RUN_DECK: readonly MiniCase[] = [
	{ id: 'one', type: 'precision_shot', caption: 'One copy' },
	{ id: 'pair', type: 'nitro_boost', copies: 2, caption: 'Two copies' },
	{ id: 'five', type: 'ramming_speed', copies: 5, caption: 'A stack of five' },
	{ id: 'borrowed', type: 'medical_kit', state: 'borrowed', caption: 'Borrowed for this run' },
	{ id: 'home', type: 'repair_kit', state: 'home', caption: 'Left at home' },
	{ id: 'locked', type: 'triage', state: 'locked', caption: 'Escort card, locked' },
];

/** The locker's spare cards, which nobody owns. */
const LOCKER: readonly MiniCase[] = [
	{ id: 'locker_one', type: 'berserker', caption: 'One copy' },
	{ id: 'locker_three', type: 'oil_slick', copies: 3, caption: 'Three copies' },
	{ id: 'locker_unavailable', type: 'emp_blast', state: 'unavailable', caption: 'Unavailable' },
];

/**
 * The mini card (Game Flow 7.0, the "Card sizes" board) at its real size in
 * every state, as a driver's run deck and the locker show them: one copy,
 * stacks, borrowed, left at home, an escort's locked card, and
 * unavailable. Each opens the detail view on hover, focus, or a touch hold,
 * as a card of any size does.
 */
export class CardMinisSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_card_minis', title: 'Mini Cards', ...options });
		this.addRow('driver 1\'s run deck: one copy, two, a stack of five, borrowed for this run, left at home, an escort\'s locked card', this.row('dev_card_minis_deck', RUN_DECK, 1));
		this.addRow('the locker, unowned: one copy, three, unavailable (its reason goes on the control under it)', this.row('dev_card_minis_locker', LOCKER, null));
		inspectOnContextMenu(this);
	}

	/** Captioned minis side by side, spaced as any grid of minis is (`MINI_GRID`). */
	private row(id: string, cases: readonly MiniCase[], driver: 1 | 2 | null): Stack {
		const cells = cases.map((entry) => {
			const card = new UICard({
				id: `dev_card_mini_${entry.id}`,
				x: 0,
				y: 0,
				data: sampleCard(entry.type),
				size: CardSize.MINI,
				driverNumber: driver,
				copies: entry.copies,
				miniState: entry.state ?? null,
			});
			card.focusable = true;
			makeInspectable(card);
			return { item: card, caption: entry.caption };
		});
		return this.captionedRow({ id, cells, ink: MINI_CARD_INK, captionWidth: CAPTION_WIDTH });
	}
}
