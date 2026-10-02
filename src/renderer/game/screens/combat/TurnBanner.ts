import { Component, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import type { MountContext } from '../../../engine/components/MountContext';
import { Text } from '../../../engine/components/Text';
import type { TweenHandle } from '../../../engine/animation/Animator';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../../engine/draw/commands';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import { resolveColor } from '../../../engine/style/styleObject';
import { tokens } from '../../../engine/theme/tokens';
import { hexRgba } from './combatStyle';

/** The mock's `.banner`: 56 tall across the road, 32 px display type spaced 0.28 em. */
export const TURN_BANNER_HEIGHT = 56;
const BANNER_FONT_SIZE = 32;
const BANNER_LETTER_SPACING = 0.28;
/**
 * How long a banner is up, entrance and exit included. Reading time, so it
 * runs on the frame clock; only the slide and fade are tweens.
 */
export const TURN_BANNER_LIFETIME = 1100;
/** How far it slides in from, and out to, as a share of the road's width. */
const SLIDE = 0.12;
/** The band is solid between these shares of the width, fading to clear at the ends. */
const SOLID_FROM = 0.25;
const SOLID_TO = 0.75;

export type TurnBannerKind = 'enemy' | 'player';

interface BannerLook {
	text: string;
	band: RGBA;
	color: string;
}

/**
 * Enemy turn is the mock's (`rgba(90, 31, 24, 0.9)`, `#ffd8d0`). The mock
 * has no banner for the player's turn; it gets the same band in the dock's
 * ground with bone type, so the two read as a pair and only raiders are red.
 */
const LOOKS: Readonly<Record<TurnBannerKind, BannerLook>> = {
	enemy: { text: 'ENEMY TURN', band: resolveColor('rgba(90, 31, 24, 0.9)'), color: '#ffd8d0' },
	player: { text: 'YOUR TURN', band: hexRgba('#202326', 0.92), color: '#e9e4d6' },
};
const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * The turn banner (Battle Screen Design section 6): a band across the road,
 * never the dock, naming whose turn it is. It shows each turn change for
 * `TURN_BANNER_LIFETIME` on the frame clock, sliding in from the left and
 * out to the right on the animator; a second change while one is up waits
 * its turn. Under reduced motion (R11.13) it doesn't slide or fade, it is
 * just there for its time. Between banners nothing is drawn: the top bar's
 * turn and END TURN's caption say whose move it is.
 */
export class TurnBanner extends Component {
	private readonly label: Text;
	private readonly queue: TurnBannerKind[] = [];
	private showing: TurnBannerKind | null = null;
	private remainingMs = 0;
	private leaving = false;
	private tween: TweenHandle<number> | null = null;
	/** 0 off to the left, 1 in place, 2 off to the right. */
	private travel = 1;
	private readonly left: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number }; gradient: [RGBA, RGBA, RGBA, RGBA] };
	private readonly middle: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number }; fill: RGBA };
	private readonly right: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number }; gradient: [RGBA, RGBA, RGBA, RGBA] };

	constructor(options: ComponentOptions = {}) {
		super({ height: TURN_BANNER_HEIGHT, pointerEvents: 'none', ...options });
		this.componentType = 'TurnBanner';
		this.label = new Text('', {
			id: options.id ? `${options.id}_text` : undefined,
			height: TURN_BANNER_HEIGHT,
			wrap: 'none',
			verticalAlign: 'middle',
			pointerEvents: 'none',
			style: { fontRole: 'display', fontSize: BANNER_FONT_SIZE, letterSpacing: BANNER_LETTER_SPACING, textAlign: 'center' },
		});
		this.addChild(this.label);
		const band = LOOKS.enemy.band;
		this.left = { rect: { x: 0, y: 0, width: 0, height: TURN_BANNER_HEIGHT }, gradient: [CLEAR, band, band, CLEAR] };
		this.middle = { rect: { x: 0, y: 0, width: 0, height: TURN_BANNER_HEIGHT }, fill: band };
		this.right = { rect: { x: 0, y: 0, width: 0, height: TURN_BANNER_HEIGHT }, gradient: [band, CLEAR, CLEAR, band] };
		this.setVisible(false);
	}

	/** What's up now, or null. */
	public get current(): TurnBannerKind | null {
		return this.showing;
	}

	/** The banner's text now, or null when none is up. */
	public get text(): string | null {
		return this.showing ? LOOKS[this.showing].text : null;
	}

	/** Shows `kind` now, or after the banners already waiting. */
	public announce(kind: TurnBannerKind): void {
		if (this.showing === null) this.begin(kind);
		else this.queue.push(kind);
	}

	protected onResized(): void {
		this.label.setWidth(this.getWidth());
		this.placeBand();
	}

	protected onMount(context: MountContext): void {
		super.onMount(context);
		if (this.showing !== null) {
			this.requestUpdate();
			this.slide(this.travel, 1);
		}
	}

	protected onUnmount(): void {
		this.tween = null;
		super.onUnmount();
	}

	private begin(kind: TurnBannerKind): void {
		this.showing = kind;
		this.remainingMs = TURN_BANNER_LIFETIME;
		this.leaving = false;
		const look = LOOKS[kind];
		this.label.setText(look.text);
		this.label.setColor(look.color);
		const band = look.band;
		this.left.gradient[1] = band;
		this.left.gradient[2] = band;
		this.middle.fill = band;
		this.right.gradient[0] = band;
		this.right.gradient[3] = band;
		this.setVisible(true);
		this.requestUpdate();
		this.travel = this.moving ? 0 : 1;
		this.applyTravel();
		this.slide(0, 1);
	}

	/** The countdown; the exit starts when there's a slide's worth left. */
	public update(dt: number): void {
		if (this.showing === null) return;
		this.remainingMs -= dt * 1000;
		if (this.remainingMs <= 0) {
			this.finish();
			return;
		}
		if (!this.leaving && this.remainingMs <= tokens.motion.dur) {
			this.leaving = true;
			this.slide(1, 2, this.remainingMs);
		}
		this.requestUpdate();
	}

	private finish(): void {
		this.tween?.cancel();
		this.tween = null;
		this.showing = null;
		const next = this.queue.shift();
		if (next) {
			this.begin(next);
			return;
		}
		this.setVisible(false);
		this.travel = 1;
		this.applyTravel();
	}

	private get moving(): boolean {
		const animator = this.context?.animator;
		return animator !== undefined && !animator.reducedMotion;
	}

	private slide(from: number, to: number, duration: number = tokens.motion.dur): void {
		const animator = this.context?.animator;
		this.tween?.cancel();
		this.tween = null;
		if (!animator || !this.moving) {
			this.travel = to === 2 ? 1 : to;
			this.applyTravel();
			return;
		}
		this.tween = animator.tween({
			from,
			to,
			duration,
			ease: tokens.motion.ease_emphasized,
			owner: this,
			onUpdate: (travel) => {
				this.travel = travel;
				this.applyTravel();
			},
		});
	}

	/** Slides by moving the label and the band's draw rects, and fades at the ends. */
	private applyTravel(): void {
		const offset = (this.travel - 1) * SLIDE * this.getWidth();
		this.opacity = this.travel <= 1 ? this.travel : 2 - this.travel;
		this.label.setPosition(offset, 0);
		this.placeBand(offset);
	}

	private placeBand(offset = (this.travel - 1) * SLIDE * this.getWidth()): void {
		const width = this.getWidth();
		this.left.rect.x = offset;
		this.left.rect.width = width * SOLID_FROM;
		this.middle.rect.x = offset + width * SOLID_FROM;
		this.middle.rect.width = width * (SOLID_TO - SOLID_FROM);
		this.right.rect.x = offset + width * SOLID_TO;
		this.right.rect.width = width * (1 - SOLID_TO);
	}

	/** The band's slide reaches past the box on both sides. */
	protected get cullInk(): Rect {
		const width = this.getWidth();
		return { x: -SLIDE * width, y: 0, width: width * (1 + 2 * SLIDE), height: this.getHeight() };
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.showing ? { fill: this.middle.fill } : null;
	}

	public render(draw: DrawApi): void {
		if (this.showing === null) return;
		draw.drawRect(this.left);
		draw.drawRect(this.middle);
		draw.drawRect(this.right);
	}
}
