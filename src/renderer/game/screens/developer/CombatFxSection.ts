import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Container } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { AimReticle, FloatingNumber, TargetingArrow } from '../combat/CombatFxLayer';

const AIM_WIDTH = 560;
const AIM_HEIGHT = 240;
const CARD_WIDTH = 90;
const CARD_HEIGHT = 126;
const NUMBERS_HEIGHT = 60;

/**
 * The combat screen's overlay effects at rest, for a golden: the targeting
 * line from a card stand-in to the reticle (off target, since nothing is
 * dragged here, so in bone), and the floating numbers held where they start.
 * The live versions move every frame; these hold still so a capture pins
 * the dots, the head, the ring, and the numbers' type and shadow.
 */
export class CombatFxSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_fx', title: 'Combat Effects', ...options });

		// The arrow finds both ends through the tree, from its layer's parent
		// down, so it sits in a layer beside the card as it does in combat
		const aim = new Container({ id: 'dev_combat_aim', width: AIM_WIDTH, height: AIM_HEIGHT });
		const card = new Rectangle({
			id: 'dev_combat_aim_card',
			x: 40,
			y: AIM_HEIGHT - CARD_HEIGHT - 10,
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			style: { backgroundColor: '#1d1f22', borderColor: '#e9e4d6', borderWidth: 2, borderRadius: 6 },
		});
		const layer = new Container({ id: 'dev_combat_aim_layer', width: AIM_WIDTH, height: AIM_HEIGHT, pointerEvents: 'none', zIndex: 1 });
		const reticle = new AimReticle({ id: 'dev_combat_aim_reticle' });
		reticle.setPosition(440 - reticle.centre.x, 40 - reticle.centre.y);
		const arrow = new TargetingArrow({ id: 'dev_combat_aim_line', reticle, width: AIM_WIDTH, height: AIM_HEIGHT });
		arrow.source = card;
		layer.addChild(arrow);
		layer.addChild(reticle);
		aim.addChild(card);
		aim.addChild(layer);
		this.addRow('the targeting line, card to reticle, off target', aim);

		const numbers = new Container({ id: 'dev_combat_numbers', width: AIM_WIDTH, height: NUMBERS_HEIGHT });
		[
			{ text: '-6', kind: 'damage' as const },
			{ text: '-15', kind: 'damage' as const },
			{ text: 'MISS', kind: 'miss' as const },
		].forEach(({ text, kind }, index) => {
			numbers.addChild(new FloatingNumber({ id: `dev_combat_number_${index}`, text, kind, x: index * 140, y: 10, held: true }));
		});
		this.addRow('floating numbers: a hit, a bigger hit, a miss', numbers);
	}
}
