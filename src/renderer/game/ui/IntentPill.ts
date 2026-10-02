import { Component, ComponentOptions } from '../../engine/components/Component';
import { drawIcon, DrawIconOptions } from '../../engine/components/Icon';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { MountContext } from '../../engine/components/MountContext';
import { Stack, StackOptions } from '../../engine/components/Stack';
import type { IconName } from '../../engine/text/icons';
import type { RGBA } from '../../engine/draw/geometry';
import { tokens } from '../../engine/theme/tokens';
import { resolveColor } from '../../engine/style/styleObject';
import type { DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import { TargetMark, TargetMarkDraw } from './targetMarks';

/**
 * What a pill shows: the battle's intent types (`mechanics/Intent.ts`),
 * with `special` for one the raider keeps to itself, and `overflow` for
 * the "+N" after the first two.
 */
export type IntentType = 'attack' | 'defend' | 'repair' | 'buff' | 'debuff' | 'special' | 'overflow';

export interface EnemyIntent {
	type: IntentType;
	/** Damage per hit, or armor gained, or for `overflow` how many more. Absent when the raider's tier hides it. */
	value?: number;
	/** How many times an attack hits; "6x3" is value 6, hits 3. */
	hits?: number;
	/** The value as printed when it isn't a plain number ("6x3", or "?" for a hidden one). */
	valueText?: string;
	/** The card's name, or "???" when the raider's tier hides it. */
	description: string;
	/** What it will do and to whom, for the tooltip ("8 damage on Apocalypse Rig"). */
	detail?: string;
	/** Whose vehicle it lands on: a driver's mark, both for an area hit, or an escort's square. */
	target?: TargetMark;
	/** The vehicles it will land on, by id, for the end-turn preview's lines and totals. */
	targetIds?: readonly string[];
}

/** An attack this big or bigger, all hits together, takes the heavy tier's colour (section 3). */
export const HEAVY_ATTACK = 12;

/**
 * What an intent will deal, every hit together: 0 for anything but an
 * attack, null for an attack whose value the raider's tier hides.
 */
export function intentDamage(intent: EnemyIntent): number | null {
	if (intent.type !== 'attack') return 0;
	if (intent.value === undefined) return null;
	return intent.value * (intent.hits ?? 1);
}

/** The pill's height, and the intents row's (Battle Screen Design, section 3). */
export const INTENT_PILL_HEIGHT = 24;
const BORDER = 1;
const PAD_LEFT = 5;
const PAD_RIGHT = 7;
const MORE_PAD = 6;
const ITEM_GAP = 4;
const ICON_SIZE = 16;
const MARK_SIZE = 12;
const VALUE_SIZE = 15;
const MORE_SIZE = 12;
/**
 * Barlow Condensed's widest digit is 0.456 em and JetBrains Mono's advance
 * 0.6; a value's width is sized from them rather than measured, so it never
 * comes out narrower than what it prints.
 */
const VALUE_ADVANCE = 0.46;
const MORE_ADVANCE = 0.6;

interface PillLook {
	border: RGBA;
	fill: RGBA;
	ink: RGBA;
	icon: IconName | null;
}

const GROUND = resolveColor('#0d0e0f');
/** The mock's `.intent` colours: attacks red, the heavy tier deeper, defence steel, debuffs purple, buffs structure green. */
const LOOKS: Readonly<Record<IntentType, PillLook>> = {
	attack: { border: resolveColor('rgba(212, 81, 63, 0.7)'), fill: GROUND, ink: resolveColor('#ff9d8f'), icon: 'gps_fixed' },
	defend: { border: resolveColor('rgba(169, 188, 205, 0.6)'), fill: GROUND, ink: resolveColor('#a9bccd'), icon: 'shield' },
	repair: { border: resolveColor('rgba(169, 188, 205, 0.6)'), fill: GROUND, ink: resolveColor('#a9bccd'), icon: 'build' },
	debuff: { border: resolveColor('rgba(190, 120, 230, 0.6)'), fill: GROUND, ink: resolveColor('#d3a6f0'), icon: 'expand_more' },
	buff: { border: resolveColor('rgba(143, 191, 92, 0.6)'), fill: GROUND, ink: resolveColor('#8fbf5c'), icon: 'expand_less' },
	special: { border: tokens.color.line_edge, fill: GROUND, ink: tokens.color.text_dim, icon: null },
	overflow: { border: tokens.color.line_edge, fill: GROUND, ink: tokens.color.text_dim, icon: null },
};
const HEAVY: PillLook = { border: resolveColor('#ff5a44'), fill: resolveColor('#3a120d'), ink: resolveColor('#ff9d8f'), icon: 'gps_fixed' };

/** A pill grows in from this scale when a raider's plan changes. */
const POP_FROM = 0.4;
const POP_ORIGIN: readonly [number, number] = [0.5, 0.5];

/**
 * The short names a debuff or buff pill prints (the mock's "Slow", "Jam"),
 * kept to five letters so two pills and "+N" fit the token. A status with
 * none here prints no label; its tooltip still names it.
 */
const STATUS_LABELS: Readonly<Record<string, string>> = {
	speed_reduction: 'Slow',
	slow: 'Slow',
	oil_slick: 'Oil',
	caltrops: 'Spike',
	permanent_speed_loss: 'Slow',
	vulnerable: 'Vuln',
	stunned: 'Stun',
	burn: 'Burn',
	death_mark: 'Mark',
	speed_boost: 'Fast',
	speed_plus: 'Fast',
	nitro_boost: 'Nitro',
	damage_bonus: 'Dmg+',
	triple_damage: 'Dmgx3',
	flank: 'Flank',
	draw: 'Draw',
	adrenaline: 'Adr+',
};

/** A debuff's or buff's status as its pill prints it, or undefined for one with no short name. */
export function statusLabel(status: string | null): string | undefined {
	return status === null ? undefined : STATUS_LABELS[status];
}

/** What a pill prints after its icon: a value, "?" when hidden, a debuff's or buff's short name. */
function labelOf(intent: EnemyIntent): string | null {
	switch (intent.type) {
		case 'attack':
		case 'defend':
		case 'repair':
			return intent.valueText ?? (intent.value !== undefined ? `${intent.value}` : '?');
		case 'special':
			return '?';
		case 'overflow':
			return `+${intent.value ?? 0}`;
		default:
			return intent.valueText ?? null;
	}
}

function lookOf(intent: EnemyIntent): PillLook {
	const damage = intentDamage(intent);
	return intent.type === 'attack' && damage !== null && damage >= HEAVY_ATTACK ? HEAVY : LOOKS[intent.type];
}

/**
 * One raider intent as a pill over the token (Battle Screen Design,
 * sections 3 and 8): its type's icon, the value ("6x3" for a multi-hit),
 * and the mark of whom it lands on, in the type's colour, an attack of 12
 * or more in the heavy tier's. An elite's or a boss's hidden value prints
 * "?". The "+N" for the rest of a long plan is a pill too. The width
 * follows the content; the tooltip says what it does to whom.
 */
export class IntentPill extends Component {
	private current: EnemyIntent | null = null;
	private printed: string | null = null;
	private look: PillLook = LOOKS.special;
	private standsFor: readonly EnemyIntent[] = [];
	/** `[intent]` for a pill that shows one, kept so reading it allocates nothing. */
	private own: EnemyIntent[] = [];
	private readonly bodyDraw: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number } } = {
		rect: { x: 0, y: 0, width: 0, height: INTENT_PILL_HEIGHT },
		fill: GROUND,
		radius: INTENT_PILL_HEIGHT / 2,
		border: { color: LOOKS.special.border, width: BORDER },
	};
	private readonly iconDraw: DrawIconOptions = { glyph: 'gps_fixed', size: ICON_SIZE, tint: LOOKS.attack.ink, box: { x: 0, y: 0, width: ICON_SIZE, height: INTENT_PILL_HEIGHT } };
	private readonly valueDraw: DrawTextOptions & { box: { x: number; y: number; width: number; height: number } } = {
		text: '',
		box: { x: 0, y: 0, width: 0, height: INTENT_PILL_HEIGHT },
		font: 'display',
		size: VALUE_SIZE,
		color: LOOKS.attack.ink,
		align: 'center',
		verticalAlign: 'middle',
		wrap: 'none',
	};
	private readonly targetMark = new TargetMarkDraw();
	/** Grows in on the animator when it mounts, unless reduced motion is on. */
	public popIn = false;
	private readonly popInput: { scale: number; origin: readonly [number, number] } = { scale: 1, origin: POP_ORIGIN };

	constructor(options: ComponentOptions = {}) {
		super({ ...options, height: INTENT_PILL_HEIGHT });
		this.componentType = 'IntentPill';
		this.visible = false;
	}

	/** The width a pill showing `intent` takes. */
	static widthOf(intent: EnemyIntent): number {
		const label = labelOf(intent);
		if (intent.type === 'overflow') return BORDER * 2 + MORE_PAD * 2 + Math.ceil((label ?? '').length * MORE_SIZE * MORE_ADVANCE);
		const items: number[] = [];
		if (LOOKS[intent.type].icon) items.push(ICON_SIZE);
		if (label !== null) items.push(Math.ceil(label.length * VALUE_SIZE * VALUE_ADVANCE));
		if (intent.target) items.push(TargetMarkDraw.widthOf(intent.target, MARK_SIZE));
		const content = items.reduce((sum, width) => sum + width, 0) + ITEM_GAP * Math.max(0, items.length - 1);
		return BORDER * 2 + PAD_LEFT + PAD_RIGHT + content;
	}

	get intent(): EnemyIntent | null {
		return this.current;
	}

	set intent(intent: EnemyIntent | null) {
		this.current = intent;
		this.visible = intent !== null;
		if (!intent) {
			this.printed = null;
			this.tooltip = null;
			return;
		}
		if (intent.type !== 'overflow') this.own = [intent];
		const width = IntentPill.widthOf(intent);
		if (width !== this.width) this.setSize(width, INTENT_PILL_HEIGHT);
		this.look = lookOf(intent);
		this.printed = labelOf(intent);
		this.layoutParts(intent, width);
		if (intent.type === 'overflow') {
			const more = this.standsFor;
			this.tooltip = { title: `${more.length} more`, description: more.map((hidden) => (hidden.detail ? `${hidden.description}: ${hidden.detail}` : hidden.description)).join('. ') };
		} else {
			this.tooltip = { title: intent.description, description: intent.detail };
		}
	}

	/** The intents this pill stands for: its own, or for "+N" the ones it collapses. */
	get represents(): readonly EnemyIntent[] {
		if (this.current && this.current.type !== 'overflow') return this.own;
		return this.standsFor;
	}


	set represents(intents: readonly EnemyIntent[]) {
		this.standsFor = intents;
		if (this.current?.type === 'overflow') this.intent = this.current;
	}

	/** Shrinking out of a changed plan, no longer part of it. */
	get leaving(): boolean {
		return this['exiting'];
	}

	/** The text the pill prints, or null when it prints none. */
	get label(): string | null {
		return this.printed;
	}

	/** Whether it wears the heavy tier's colour. */
	get heavy(): boolean {
		return this.look === HEAVY;
	}

	public get drawnText(): readonly string[] | null {
		return this.printed === null ? null : [this.printed];
	}

	private layoutParts(intent: EnemyIntent, width: number): void {
		const look = this.look;
		this.bodyDraw.rect.width = width;
		this.bodyDraw.fill = look.fill;
		if (this.bodyDraw.border) this.bodyDraw.border.color = look.border;
		const overflow = intent.type === 'overflow';
		let x = BORDER + (overflow ? MORE_PAD : PAD_LEFT);
		if (look.icon && !overflow) {
			this.iconDraw.glyph = look.icon;
			this.iconDraw.tint = look.ink;
			this.iconDraw.box = { x, y: 0, width: ICON_SIZE, height: INTENT_PILL_HEIGHT };
			x += ICON_SIZE + ITEM_GAP;
		}
		const label = this.printed;
		if (label !== null) {
			const size = overflow ? MORE_SIZE : VALUE_SIZE;
			const labelWidth = Math.ceil(label.length * size * (overflow ? MORE_ADVANCE : VALUE_ADVANCE));
			this.valueDraw.text = label;
			this.valueDraw.font = overflow ? 'mono' : 'display';
			this.valueDraw.size = size;
			this.valueDraw.color = look.ink;
			this.valueDraw.box.x = x;
			this.valueDraw.box.width = labelWidth;
			x += labelWidth + ITEM_GAP;
		}
		const mark = overflow ? null : intent.target ?? null;
		this.targetMark.place(mark, x, (INTENT_PILL_HEIGHT - MARK_SIZE) / 2, MARK_SIZE);
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

	public render(draw: DrawApi): void {
		if (!this.current) return;
		this.bodyDraw.id = this.id ?? undefined;
		draw.drawRect(this.bodyDraw);
		if (this.look.icon && this.current.type !== 'overflow') drawIcon(draw, this.iconDraw);
		if (this.printed !== null) draw.drawText(this.valueDraw);
		this.targetMark.draw(draw);
	}
}

/** Pills shown before the rest collapse into "+N" (section 3). */
export const INTENTS_SHOWN = 2;
const ROW_GAP = 4;

/**
 * A raider's whole plan over its plate: the first two intents as pills,
 * then "+N" for the rest, right-aligned in the token's width. When two
 * wide pills and the "+N" would run past that width, one shows and "+N"
 * takes the rest, so every pill stays inside the token's box. Pills are
 * keyed by place, type, and value, so a plan that changes at the start of
 * a turn grows its new pills in and shrinks the old ones out (R8.27), on
 * the animator, while one that holds still is left alone.
 */
export class IntentRow extends Stack {
	private shown: EnemyIntent[] = [];
	private plan: readonly EnemyIntent[] = [];

	constructor(options: StackOptions = {}) {
		super({ direction: 'horizontal', gap: ROW_GAP, pointerEvents: 'passthrough', ...options });
		this.componentType = 'IntentRow';
	}

	/** The pills showing, in order, "+N" last when there is one. */
	public get intents(): readonly EnemyIntent[] {
		return this.shown;
	}

	public set intents(intents: readonly EnemyIntent[]) {
		this.plan = intents;
		const count = this.fittingCount(intents);
		const shown: EnemyIntent[] = intents.slice(0, count);
		const collapsed = intents.slice(count);
		if (collapsed.length > 0) shown.push({ type: 'overflow', value: collapsed.length, description: 'more' });
		this.shown = shown;
		const key = (intent: EnemyIntent, index: number): string => `${index}:${intent.type}:${intent.valueText ?? intent.value ?? ''}`;
		const keyed = shown.map((intent, index) => ({ intent, key: key(intent, index) }));
		const place = (pill: IntentPill, intent: EnemyIntent): void => {
			if (intent.type === 'overflow') pill.represents = collapsed;
			pill.intent = intent;
		};
		this.reconcileChildren(keyed, {
			key: (item) => item.key,
			create: ({ intent, key: itemKey }) => {
				const pill = new IntentPill({ id: this.id ? `${this.id}_${itemKey.replace(/[^A-Za-z0-9]+/g, '_')}` : undefined });
				place(pill, intent);
				pill.popIn = true;
				return pill;
			},
			update: (pill, { intent }) => place(pill, intent),
			// Out of the row's flow where it stood, so a plan that changes
			// whole doesn't widen the row while the old pills shrink
			remove: (pill) => {
				const { x, y } = pill.bounds;
				pill.positioned = 'absolute';
				pill.setPosition(x, y);
				return pill.popOut();
			},
		});
	}

	/** The whole plan, every intent, as it was set. */
	public get planned(): readonly EnemyIntent[] {
		return this.plan;
	}

	/** The pills on the row now, leaving ones excluded. Allocates; a paint walks `children` instead. */
	public get pills(): IntentPill[] {
		return this.children.filter((child): child is IntentPill => child instanceof IntentPill && !child.leaving);
	}

	/** Two, unless two and the "+N" would run past the row's width; then one. */
	private fittingCount(intents: readonly EnemyIntent[]): number {
		const room = this.width;
		if (intents.length <= 1 || room <= 0) return Math.min(intents.length, INTENTS_SHOWN);
		const count = Math.min(intents.length, INTENTS_SHOWN);
		const rest = intents.length - count;
		const widths = intents.slice(0, count).map((intent) => IntentPill.widthOf(intent));
		if (rest > 0) widths.push(IntentPill.widthOf({ type: 'overflow', value: rest, description: 'more' }));
		const total = widths.reduce((sum, width) => sum + width, 0) + ROW_GAP * (widths.length - 1);
		return total <= room ? count : 1;
	}
}
