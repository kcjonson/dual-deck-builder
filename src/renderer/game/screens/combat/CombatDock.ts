import type { TweenHandle } from '../../../engine/animation/Animator';
import { Rectangle } from '../../../engine/components/Rectangle';
import type { StackOptions } from '../../../engine/components/Stack';
import { tokens } from '../../../engine/theme/tokens';
import { ChromeStack } from './ChromeStack';
import { DOCK_HEIGHT } from './CombatLayout';
import { DOCK_GRADIENT, DOCK_SCRIM, rgba } from './combatStyle';
import { EndTurnColumn } from './EndTurnColumn';
import { PlayerHandLayer } from './PlayerHandLayer';

/** Between the hands and the End Turn column. */
const DOCK_GAP = 16;
/**
 * From the mock: tabs 8 below the dock's edge and cards 38 below it, ending
 * 10 above the bottom. The fan runs to the dock's foot, since its edge
 * cards lean and drop up to 9 into those 10.
 */
const DOCK_PADDING = { top: 8, bottom: 0, left: 16, right: 16 };
/** How far the hands drop while the raiders act (section 6). */
export const DOCK_DROP = 60;

/**
 * The battle screen's dock (Battle Screen Design, section 4): each driver's
 * tab and fanned hand side by side, then the 148 px End Turn column at the
 * stage's right end. While the raiders act the hands drop and grey (section
 * 6); as in the mock, the dock's ground and End Turn stay put, End Turn
 * reading WAIT.
 */
export class CombatDock extends ChromeStack {
	public readonly hand: PlayerHandLayer;
	public readonly endTurnColumn: EndTurnColumn;
	/** Greys the hands while they're dropped, over them and dropping with them; End Turn greys by its own disabled look. */
	public readonly scrim: Rectangle;
	/** 0 with the hands in place, 1 dropped and greyed; tweened between. */
	private dropProgress = 0;
	private dropTween: TweenHandle<number> | null = null;
	private dropTarget = 0;
	private readonly park = { x: 0, y: 0 };
	private readonly scrimCorner = { x: 0, y: 0 };

	constructor({ onEndTurn, ...options }: StackOptions & { onEndTurn: () => void }) {
		super({
			direction: 'horizontal',
			gap: DOCK_GAP,
			padding: DOCK_PADDING,
			crossAlign: 'stretch',
			widthMode: 'fill',
			height: DOCK_HEIGHT,
			chrome: { fill: DOCK_GRADIENT, edge: { color: rgba('line_edge'), edges: { top: true } } },
			...options,
		});

		this.hand = new PlayerHandLayer({
			id: 'combat_player_hand',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		this.addChild(this.hand);

		this.endTurnColumn = new EndTurnColumn({
			id: 'combat_end_turn',
			onEndTurn,
		});
		this.addChild(this.endTurnColumn);

		this.scrim = new Rectangle({
			id: 'combat_dock_scrim',
			positioned: 'absolute',
			zIndex: 1,
			pointerEvents: 'none',
			style: { backgroundColor: DOCK_SCRIM },
		});
		this.scrim.visible = false;
		this.addChild(this.scrim);
		this.onLayout = () => this.placeScrim();
		this.hand.onLayout = () => this.placeScrim();
	}

	/** How far the hands have dropped: 0 in place, 1 all the way. */
	public get dropped(): number {
		return this.dropProgress;
	}

	/**
	 * Drops the hands, tabs and cards, and greys them while the raiders act,
	 * and brings them back for the player's turn, on the animator; at once
	 * under reduced motion or while unmounted. The drop is a declared park
	 * (R8.30), set only while the hands are off their place and cleared on
	 * the tick they land back, so the layout lint checks them where they rest.
	 */
	public dropHands(dropped: boolean): void {
		const target = dropped ? 1 : 0;
		const animator = this.context?.animator;
		if (this.dropTween?.running && this.dropTarget === target) return;
		this.dropTween?.cancel();
		this.dropTween = null;
		this.dropTarget = target;
		if (this.dropProgress === target || !animator || animator.reducedMotion) {
			this.applyDrop(target);
			return;
		}
		this.dropTween = animator.tween({
			from: this.dropProgress,
			to: target,
			duration: tokens.motion.dur,
			ease: tokens.motion.ease_standard,
			owner: this,
			onUpdate: (progress) => this.applyDrop(progress),
			onComplete: () => this.applyDrop(target),
		});
	}

	private applyDrop(progress: number): void {
		this.dropProgress = progress;
		// The setter copies it, so one scratch point serves every frame
		const park = progress > 0 ? this.park : null;
		this.park.y = DOCK_DROP * progress;
		this.hand.parkOffset = park;
		this.scrim.parkOffset = park;
		this.scrim.visible = progress > 0;
		this.scrim.opacity = progress;
	}

	/** The scrim over the hands' rest place, in the dock's space; on layout and resize. */
	private placeScrim(): void {
		const at = this.scrimCorner;
		at.x = 0;
		at.y = 0;
		if (!this.hand.localToAncestorInto(at, this, at)) return;
		// An absolute child is placed from the padding's inner edge
		const parked = this.hand.parkOffset?.y ?? 0;
		this.scrim.setPosition(at.x - this.padding.left, at.y - this.padding.top - parked);
		this.scrim.setSize(this.hand.width, this.hand.height);
	}
}
