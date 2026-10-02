import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Card as GameCard, CardData } from '../../mechanics/Card';
import cardsFile from '../../data/cards.json';
import { Card as UICard } from '../../ui/Card';
import { CardInspectView } from '../../ui/CardDetailView';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { FlowWrap } from '../../ui/FlowWrap';

const cards = (cardsFile as unknown as { cards: CardData[] }).cards;

/** A card from `cards.json` by type, upgraded if asked. */
export function sampleCard(type: string, upgraded = false): GameCard {
	const data = cards.find((entry) => entry.type === type);
	if (!data) throw new Error(`no card ${type}`);
	return new GameCard({ ...data, upgraded });
}

/**
 * The mock's worst case for the detail view: Tag Team Takedown, a synergy
 * card from the Card System spec, its full text written long, then run on
 * to about the view's measured capacity (some 355 characters, past the 330
 * the card data check allows), which takes the view to its 440 px cap and
 * shrinks the art.
 */
export function capacityCase(): GameCard {
	return new GameCard({
		type: 'tag_team_takedown',
		name: 'Tag Team Takedown',
		summary: 'Deal 8. Your [Partner] deals 8 more. [Exhaust].',
		description: 'Deal 8 damage to target raider. If your partner\'s vehicle is within Range 1 of that raider, they immediately deal 8 more to it without spending adrenaline, and both hits ignore Evade. Only playable while The Road Warrior and The Interceptor are both driving. Exhaust: removed from your deck for the rest of this fight. Upgraded, both hits deal 10 instead.',
		rarity: 'legendary',
		cost: 3,
		targetType: 'enemy_single',
		effects: [{ type: 'damage', value: 8, target: 'enemy_single', range: 1 }],
		tags: ['attack', 'synergy'],
	});
}

/** A caption over `content`, for placing captioned pieces side by side. */
function captioned(caption: string, content: Component): Stack {
	const stack = new Stack({ gap: 6 });
	stack.addChild(new Text({ text: caption, style: { fontSize: tokens.fontSize.fs_base, color: 'text_dim' } }));
	stack.addChild(content);
	return stack;
}

/**
 * The card face and the detail view of Battle Screen Design section 5, for
 * a golden: faces in each owner's colours, one its driver can't pay for,
 * names shrunk to 14 and cut with an ellipsis, then the detail view open
 * with its keyword boxes to the right beside one pinned with them flipped
 * to the left.
 */
export class CardDetailSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_card_detail', title: 'Card Face and Detail View', ...options });

		const unaffordable = new UICard({ id: 'dev_card_face_unaffordable', x: 0, y: 0, data: sampleCard('far_shoot'), driverNumber: 2 });
		unaffordable.enabled = false;
		unaffordable.unaffordable = true;
		const faces = new FlowWrap({ id: 'dev_card_faces', gap: 16 });
		for (const face of [
			new UICard({ id: 'dev_card_face_d1', x: 0, y: 0, data: sampleCard('point_blank'), driverNumber: 1 }),
			new UICard({ id: 'dev_card_face_d2', x: 0, y: 0, data: sampleCard('headshot'), driverNumber: 2 }),
			new UICard({ id: 'dev_card_face_none', x: 0, y: 0, data: sampleCard('rally_the_convoy') }),
			unaffordable,
			new UICard({ id: 'dev_card_face_shrunk', x: 0, y: 0, data: renamed('ram', 'Coordinated Rammings'), driverNumber: 1 }),
			new UICard({ id: 'dev_card_face_cut', x: 0, y: 0, data: renamed('ram', 'Coordinated Convoy Ramming Assault'), driverNumber: 1 }),
		]) faces.addChild(face);
		this.addRow('faces: driver 1, driver 2, unowned, unaffordable, a long name shrunk to 14, a longer one cut', faces);

		const views = new FlowWrap({ id: 'dev_card_details', gap: 32 });
		views.addChild(captioned('detail view, keyword boxes right (hover, focus, or a touch hold)', new CardInspectView({
			id: 'dev_card_detail_right', card: sampleCard('flag_down'), driver: 1, keywordSide: 'right',
		})));
		views.addChild(captioned('pinned (secondary click or I), keyword boxes flipped left', new CardInspectView({
			id: 'dev_card_detail_left', card: sampleCard('headshot'), driver: 2, keywordSide: 'left', pinned: true,
		})));
		this.addRow('the detail view rests on its bottom edge and grows upward', views);
	}
}

/**
 * The detail view at its 440 px cap, the art shrunk, on its own so a
 * 1440x882 capture holds it whole.
 */
export class CardDetailCapSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_card_detail_cap', title: 'Card Detail View at its Cap', ...options });
		this.addRow('about 355 characters reach the 440 px cap: the art gives way first', new CardInspectView({
			id: 'dev_card_detail_cap', card: capacityCase(), driver: 1, keywordSide: 'right',
		}));
	}
}

/** A real card under a made-up name, for the name's fitting. */
function renamed(type: string, name: string): GameCard {
	const data = cards.find((entry) => entry.type === type);
	if (!data) throw new Error(`no card ${type}`);
	return new GameCard({ ...data, name });
}
