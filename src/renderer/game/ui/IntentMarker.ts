import { Component, ComponentOptions } from '../../engine/components/Component';
import { Icon } from '../../engine/components/Icon';
import { grownRect } from '../../engine/components/componentGeometry';
import type { Rect } from '../../engine/draw/geometry';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { MountContext } from '../../engine/components/MountContext';
import { Stack, StackOptions } from '../../engine/components/Stack';
import type { IconName } from '../../engine/text/icons';
import { resolveFontRole } from '../../engine/text/fontRoles';
import { tokens } from '../../engine/theme/tokens';
import { resolveColor } from '../../engine/style/styleObject';

/**
 * What a marker shows: the battle's intent types (`mechanics/Intent.ts`),
 * with `special` for one the raider keeps to itself, and `overflow` for
 * the "+N" after the first two.
 */
export type IntentType = 'attack' | 'defend' | 'repair' | 'buff' | 'debuff' | 'special' | 'overflow';

export interface EnemyIntent {
	type: IntentType;
	/** Damage, armor gained, or for `overflow` how many more. */
	value?: number;
	/** The value as printed when it isn't a plain number ("6x3"). */
	valueText?: string;
	/** The card's name, or "???" when the raider's tier hides it. */
	description: string;
	/** What it will do and to whom, for the tooltip ("8 damage on Apocalypse Rig"). */
	detail?: string;
}

export interface IntentMarkerOptions extends ComponentOptions {
	/** The marker's diameter. */
	size: number;
}

const ICON_SCALE = 0.6;
const VALUE_SIZE = 16;
const VALUE_FONT = resolveFontRole({ weight: 'bold' });
const BORDER = resolveColor('#cc6a6a');

/** Raiders' attacks are red, a debuff the mock's purple, the rest as they were. */
const FILLS: Readonly<Record<IntentType, string>> = {
	attack: '#cc4444',
	defend: '#4444cc',
	repair: '#44cc44',
	buff: '#8a7434',
	debuff: '#7a4a9a',
	special: '#cc8844',
	overflow: '#2a2c2f',
};

/** Defend, repair, buff, and debuff show an icon; attack its value, special a "!", overflow "+N". */
const ICONS: Readonly<Partial<Record<IntentType, IconName>>> = {
	defend: 'shield',
	repair: 'build',
	buff: 'expand_less',
	debuff: 'expand_more',
};
/** A marker grows in from this scale when a raider's plan changes. */
const POP_FROM = 0.4;
const POP_ORIGIN: readonly [number, number] = [0.5, 0.5];

/**
 * An enemy's next action over its plate: a disc in the intent's colour
 * holding the intent's icon or value, centred. Draws its own parts; hidden
 * while there is no intent.
 */
export class IntentMarker extends Component {
	private readonly icon: Icon;
	private current: EnemyIntent | null = null;
	/** Grows in on the animator when it mounts, unless reduced motion is on. */
	public popIn = false;
	private readonly popInput: { scale: number; origin: readonly [number, number] } = { scale: 1, origin: POP_ORIGIN };

	constructor({ size, ...options }: IntentMarkerOptions) {
		super({ ...options, width: size, height: size });
		this.componentType = 'IntentMarker';
		const iconSize = Math.round(size * ICON_SCALE);
		this.icon = new Icon({
			glyph: 'shield',
			size: iconSize,
			tint: tokens.color.text_bright,
			x: (size - iconSize) / 2,
			y: (size - iconSize) / 2,
		});
		this.setVisible(false);
	}

	get intent(): EnemyIntent | null {
		return this.current;
	}

	set intent(intent: EnemyIntent | null) {
		this.current = intent;
		this.setVisible(intent !== null);
		const glyph = intent ? ICONS[intent.type] : undefined;
		if (glyph) this.icon.glyph = glyph;
		this.tooltip = intent && intent.type !== 'overflow' ? { title: intent.description, description: intent.detail } : null;
	}

	protected onMount(context: MountContext): void {
		super.onMount(context);
		if (!this.popIn || context.animator.reducedMotion) return;
		this.popIn = false;
		context.animator.tween({
			from: POP_FROM,
			to: 1,
			duration: tokens.motion.dur,
			ease: tokens.motion.ease_emphasized,
			owner: this,
			onUpdate: (scale) => this.scaleTo(scale),
		});
	}

	/**
	 * Shrinks out on the animator, settling when it's gone so a
	 * `reconcileChildren` exit can wait on it; at once under reduced motion
	 * or unmounted.
	 */
	public popOut(): Promise<void> | void {
		const animator = this.context?.animator;
		if (!animator || animator.reducedMotion) return;
		return animator.tween({
			from: 1,
			to: 0,
			duration: tokens.motion.dur_fast,
			owner: this,
			onUpdate: (scale) => this.scaleTo(scale),
		}).done;
	}

	private scaleTo(scale: number): void {
		this.popInput.scale = scale;
		this.transform = this.popInput;
	}

	/** The text shown in place of an icon, or null when the intent has an icon. */
	get label(): string | null {
		if (!this.current || ICONS[this.current.type]) return null;
		switch (this.current.type) {
			case 'attack':
				return this.current.valueText ?? (this.current.value ? this.current.value.toString() : '?');
			case 'special':
				return '!';
			case 'overflow':
				return `+${this.current.value ?? 0}`;
			default:
				return '?';
		}
	}

	/**
	 * The subtree cull's bound (DDB-184): the disc, grown by two ems of the
	 * value's size, since an unmeasured value centred in the disc can run
	 * past it on both sides.
	 */
	protected get cullInk(): Rect {
		return grownRect(this.inkRect, VALUE_SIZE * 2);
	}

	public render(draw: DrawApi): void {
		if (!this.current) return;

		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: resolveColor(FILLS[this.current.type] ?? '#666666'),
			radius: this.width / 2,
			border: { color: BORDER, width: 2 },
		});

		const label = this.label;
		if (label === null) {
			this.icon.drawGlyph(draw, this.icon.x, this.icon.y);
			return;
		}
		draw.drawText({
			text: label,
			box: { x: 0, y: 0, width: this.width, height: this.height },
			font: VALUE_FONT,
			size: VALUE_SIZE,
			color: tokens.color.text_bright,
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
		});
	}
}

/** Markers shown before the rest collapse into "+N" (section 8). */
export const INTENTS_SHOWN = 2;
const ROW_GAP = 4;

/**
 * A raider's whole plan over its plate: the first two intents, then "+N"
 * for the rest. Markers are keyed by place, type, and value, so a plan that
 * changes at the start of a turn grows its new markers in and shrinks the
 * old ones out (R8.27), on the animator, while one that holds still is left
 * alone.
 */
export class IntentRow extends Stack {
	private readonly markerSize: number;
	private shown: EnemyIntent[] = [];

	constructor({ markerSize, ...options }: StackOptions & { markerSize: number }) {
		super({ direction: 'horizontal', gap: ROW_GAP, pointerEvents: 'passthrough', ...options });
		this.componentType = 'IntentRow';
		this.markerSize = markerSize;
	}

	public get intents(): readonly EnemyIntent[] {
		return this.shown;
	}

	public set intents(intents: readonly EnemyIntent[]) {
		const shown: EnemyIntent[] = intents.slice(0, INTENTS_SHOWN);
		if (intents.length > INTENTS_SHOWN) {
			shown.push({ type: 'overflow', value: intents.length - INTENTS_SHOWN, description: 'more' });
		}
		this.shown = shown;
		const key = (intent: EnemyIntent, index: number): string => `${index}:${intent.type}:${intent.valueText ?? intent.value ?? ''}`;
		const keyed = shown.map((intent, index) => ({ intent, key: key(intent, index) }));
		this.reconcileChildren(keyed, {
			key: (item) => item.key,
			create: ({ intent, key: itemKey }) => {
				const marker = new IntentMarker({ id: this.id ? `${this.id}_${itemKey.replace(/[^A-Za-z0-9]+/g, '_')}` : undefined, size: this.markerSize });
				marker.intent = intent;
				marker.popIn = true;
				return marker;
			},
			update: (marker, { intent }) => {
				marker.intent = intent;
			},
			// Out of the row's flow where it stood, so a plan that changes
			// whole doesn't widen the row while the old discs shrink
			remove: (marker) => {
				const { x, y } = marker.bounds;
				marker.positioned = 'absolute';
				marker.setPosition(x, y);
				return marker.popOut();
			},
		});
	}
}
