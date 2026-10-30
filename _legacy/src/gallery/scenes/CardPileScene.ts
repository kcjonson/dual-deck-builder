import { CardPileView } from '../../renderer/game/ui/CardPileView';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import { sampleCard } from '../../renderer/game/screens/developer/CardDetailSection';
import type { SceneFactoryOptions } from '../registry';

export type CardPileSceneMode = 'draw' | 'discard' | 'reward';

const MODES: Readonly<Record<CardPileSceneMode, {
	title: string;
	note?: string;
	types: readonly string[];
	driver: 1 | 2 | null;
	/** The card whose detail view is pinned open. */
	pinned: number;
}>> = {
	draw: {
		title: 'Draw pile (6)',
		note: 'Shown in name order; the draw order stays hidden.',
		types: ['armor_plating', 'covering_fire', 'flank', 'point_blank', 'ram', 'repair_kit'],
		driver: 1,
		pinned: 1,
	},
	discard: {
		title: 'Discard pile (4)',
		types: ['headshot', 'far_shoot', 'nitro_boost', 'oil_slick'],
		driver: 2,
		pinned: 3,
	},
	reward: {
		title: 'Choose a card',
		note: 'One joins a driver\'s deck.',
		types: ['precision_shot', 'emp_blast', 'medical_kit'],
		driver: null,
		pinned: 1,
	},
};

/**
 * The detail view where section 5 says it is also used: a driver's draw
 * pile, their discard pile, and a reward's choice of cards, each with one
 * card's detail view pinned open through the tooltip service, as a
 * secondary click would leave it.
 *
 * Gallery only: the detail view is an overlay root over whatever hosts it.
 * It is pinned from every `onLayout`, so it is placed against the card
 * where layout finally puts it.
 */
export class CardPileScene extends DeveloperSectionPanel {
	constructor({ mode, x, y, width }: SceneFactoryOptions & { mode: CardPileSceneMode }) {
		const config = MODES[mode];
		super({ id: `gallery_scene_card_pile_${mode}`, title: 'Card piles and rewards', x, y, width });
		const pile = new CardPileView({
			id: `pile_${mode}`,
			title: config.title,
			note: config.note,
			cards: config.types.map((type) => sampleCard(type)),
			driver: config.driver,
			onPick: mode === 'reward' ? () => undefined : undefined,
		});
		this.addChild(pile);
		this.onLayout = () => {
			const card = pile.cards[config.pinned];
			if (card?.isMounted) this.context?.tooltips.pin(card, { fade: false });
		};
	}

	protected onUnmount(): void {
		this.context?.tooltips.hide();
	}
}
