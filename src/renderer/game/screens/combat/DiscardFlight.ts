import { Container } from '../../../engine/components/Container';
import type { MountContext } from '../../../engine/components/MountContext';
import type { Vec2 } from '../../../engine/draw/geometry';
import { tokens } from '../../../engine/theme/tokens';
import { Card as UICard, CardSize } from '../../ui/Card';
import type { Card } from '../../mechanics/Card';

const CARD = UICard.getDimensions(CardSize.NORMAL);
/** Where it lands, as a share of the size it left the hand at. */
const LANDING_SCALE = 0.18;
/** The share of the flight it stays opaque before fading into the pile. */
const OPAQUE_UNTIL = 0.55;
const CENTRE: readonly [number, number] = [0.5, 0.5];

/** Where a flight starts: the hand card's centre, turn, and scale in the fx layer's space. */
export interface FlightStart {
	centre: Vec2;
	rotate: number;
	scale: number;
}

/**
 * A played or discarded card on its way from the hand to its driver's
 * discard pile (DDB-37): a copy of the card, since the hand has already
 * dealt again without it, that leaves from where the card was, straightens,
 * shrinks into the pile's count, and fades as it arrives. Pure motion, on
 * the animator; it isn't created at all under reduced motion, where the
 * pile's count going up is the whole story.
 */
export class DiscardFlight extends Container {
	private readonly start: FlightStart;
	private readonly to: Vec2;
	private readonly onLanded: (flight: DiscardFlight) => void;
	private readonly pose: { rotate: number; scale: number; origin: readonly [number, number] } = { rotate: 0, scale: 1, origin: CENTRE };

	constructor({ id, card, driverNumber, start, to, onLanded }: {
		id: string;
		card: Card;
		driverNumber: 1 | 2 | null;
		start: FlightStart;
		to: Vec2;
		onLanded: (flight: DiscardFlight) => void;
	}) {
		super({ id, width: CARD.width, height: CARD.height, pointerEvents: 'none', zIndex: 3 });
		this.componentType = 'DiscardFlight';
		this.start = start;
		this.to = to;
		this.onLanded = onLanded;
		this.addChild(new UICard({ id: `${id}_card`, x: 0, y: 0, data: card, size: CardSize.NORMAL, driverNumber }));
		this.place(0);
	}

	protected onMount(context: MountContext): void {
		super.onMount(context);
		context.animator.tween({
			from: 0,
			to: 1,
			duration: tokens.motion.dur_slow,
			ease: tokens.motion.ease_standard,
			owner: this,
			onUpdate: (progress) => this.place(progress),
			onComplete: () => this.onLanded(this),
		});
	}

	private place(progress: number): void {
		const { centre, rotate, scale } = this.start;
		const x = centre.x + (this.to.x - centre.x) * progress;
		const y = centre.y + (this.to.y - centre.y) * progress;
		this.setPosition(x - CARD.width / 2, y - CARD.height / 2);
		this.pose.rotate = rotate * (1 - progress);
		this.pose.scale = scale * (1 - (1 - LANDING_SCALE) * progress);
		this.transform = this.pose;
		this.opacity = progress <= OPAQUE_UNTIL ? 1 : 1 - (progress - OPAQUE_UNTIL) / (1 - OPAQUE_UNTIL);
	}
}
