import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { Card } from '../../ui/Card';
import { FlowWrap } from '../../ui/FlowWrap';
import { CardLoader } from '../../core/CardLoader';
import { CARD_RARITIES, CardRarity, Card as GameCard } from '../../mechanics/Card';

const CARD_GAP = 20;
const BACK_WIDTH = 200;

const RARITY_COLORS: Record<CardRarity, string> = {
	starter: '#666666',
	common: '#ffffff',
	uncommon: '#00aa00',
	rare: '#0088ff',
	legendary: '#ff8800',
	signature: '#cc66ff',
};

/**
 * Every card in the game: a root stack with the title, a scroll container
 * holding all the cards and then the same cards by rarity, each group a
 * heading over a wrapping row, and Back. The rows wrap at whatever width the
 * window gives them, so nothing is placed by hand. Focus starts on Back;
 * Page Up and Page Down scroll the list and Escape returns to the menu.
 */
export class CardShowcaseScreen extends Screen {
	private readonly stack: Stack;
	private readonly cardLoader = CardLoader.getInstance();
	private list: Stack | null = null;
	private scroller: ScrollContainer | null = null;
	/** Bumped on every mount and unmount, so a load that finishes after the screen left is dropped. */
	private generation = 0;

	constructor() {
		const root = new Stack({
			id: 'cardShowcaseScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			gap: tokens.space.space_4,
			padding: tokens.space.space_8,
			style: { backgroundColor: 'bg_base' },
		});
		super('cardShowcaseScreen', { root });
		this.stack = root;
	}

	protected onMount(): void {
		this.stack.addChild(new Text('Card Showcase', {
			id: 'showcase_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_4xl',
				color: 'text_bright',
			},
			wrap: 'none',
		}));

		this.list = new Stack({ id: 'showcase_cards', crossAlign: 'stretch', gap: tokens.space.space_4 });
		this.scroller = new ScrollContainer({
			id: 'showcase_scroll',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		this.scroller.addChild(this.list);
		this.stack.addChild(this.scroller);

		const back = new Button('Back to Main Menu', {
			id: 'showcase_back_button',
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(back);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		hotkeys.register('PageDown', () => this.scroller?.scrollBy(this.scroller.height));
		hotkeys.register('PageUp', () => this.scroller?.scrollBy(-(this.scroller?.height ?? 0)));
		this.context.focus.focus(back);

		void this.loadCards(++this.generation);
	}

	protected onUnmount(): void {
		this.generation++;
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp']) hotkeys.unregister(key);
		this.stack.clearChildren();
		this.list = null;
		this.scroller = null;
	}

	private async loadCards(generation: number): Promise<void> {
		try {
			if (!this.cardLoader.isLoaded()) await this.cardLoader.loadCards();
			if (generation !== this.generation) return;
			this.showCards(this.cardLoader.getAllCards());
		} catch (error) {
			console.error('Failed to load cards:', error);
			if (generation !== this.generation) return;
			this.list?.addChild(new Text('Failed to load cards. Check console for details.', {
				style: { fontSize: 'fs_lg', color: 'status_crit' },
			}));
		}
	}

	/**
	 * All the cards, then each rarity's. The by-rarity cards take the rarity
	 * in their ids so ids stay unique within the root; CardLoader keys its
	 * map by card type, so a type appears once per group.
	 */
	private showCards(cards: GameCard[]): void {
		const list = this.list;
		if (!list) return;
		list.addChild(this.group({
			id: 'showcase_all',
			heading: `All Cards (${cards.length} total)`,
			color: 'text_bright',
			cards: cards.map((card) => new Card({ id: `showcase_card_${card.type}`, x: 0, y: 0, data: card })),
		}));
		for (const rarity of CARD_RARITIES) {
			const rarityCards = cards.filter((card) => card.rarity === rarity);
			if (rarityCards.length === 0) continue;
			list.addChild(this.group({
				id: `showcase_${rarity}`,
				heading: `${rarity.toUpperCase()} (${rarityCards.length})`,
				color: RARITY_COLORS[rarity],
				cards: rarityCards.map((card) => new Card({ id: `showcase_${rarity}_card_${card.type}`, x: 0, y: 0, data: card })),
			}));
		}
	}

	/** A heading over its cards, wrapped across the list's width. */
	private group({ id, heading, color, cards }: { id: string; heading: string; color: string; cards: Card[] }): Stack {
		const group = new Stack({ id, crossAlign: 'stretch', gap: tokens.space.space_3 });
		group.addChild(new Text(heading, {
			style: { fontRole: 'display', fontSize: 'fs_xl', color },
			wrap: 'none',
		}));
		const row = new FlowWrap({ id: `${id}_cards`, gap: CARD_GAP });
		for (const card of cards) row.addChild(card);
		group.addChild(row);
		return group;
	}

	private back(): void {
		ScreenManager.navigate('mainMenuScreen');
	}
}
