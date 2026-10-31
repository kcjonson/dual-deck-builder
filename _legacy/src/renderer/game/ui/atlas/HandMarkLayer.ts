import { Component, ComponentOptions, PointerEvents } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Rect, Vec2 } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { UiArtName, drawAtlasArt } from './atlasArt';
import { AtlasInks, atlasInks } from './atlasStyle';

export type HandMarkKind = 'highlight' | 'loop';

/** Each mark is baked art in four variants, so two selections never match (UI Art Direction, Components). */
export type HandMarkVariant = 0 | 1 | 2 | 3;

export interface HandMark {
	readonly kind: HandMarkKind;
	/** What it marks, followed as it moves; null for a fixed rect. */
	readonly target: Component | null;
	readonly variant: HandMarkVariant;
}

/**
 * `under` paints beneath its siblings, for the highlighter, which goes down
 * before the ink it marks so the label stays at full strength; `over` paints
 * above them, for grease-pencil loops.
 */
export type HandMarkPlace = 'under' | 'over';

export interface HandMarkLayerOptions extends Omit<ComponentOptions, 'positioned' | 'pointerEvents' | 'zIndex'> {
	place?: HandMarkPlace;
}

const HIGHLIGHT_PIECES: readonly UiArtName[] = ['highlight_a', 'highlight_b', 'highlight_c', 'highlight_d'];
const LOOP_PIECES: readonly UiArtName[] = ['loop_a', 'loop_b', 'loop_c', 'loop_d'];
/** The swipe runs a little past the row's ends and covers the middle of it. */
const HIGHLIGHT_OVERRUN = 4;
const HIGHLIGHT_COVER = 1.1;
/** A loop rings its target this far out, in grease pencil this wide. */
const LOOP_REACH = 12;
const LOOP_ART_REACH = 20;
const LOOP_WIDTH = 2.4;
const LOOP_POINTS = 44;
/** Per variant: the loop's tilt, where the pencil starts, and how far past the start it runs. */
const LOOP_HANDS: readonly { tilt: number; start: number; overrun: number }[] = [
	{ tilt: -0.05, start: 3.6, overrun: 0.5 },
	{ tilt: 0.04, start: 2.2, overrun: 0.35 },
	{ tilt: -0.02, start: 4.4, overrun: 0.6 },
	{ tilt: 0.06, start: 0.8, overrun: 0.45 },
];

class Mark implements HandMark {
	public readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
	public readonly art: Rect = { x: 0, y: 0, width: 0, height: 0 };
	public readonly points: Vec2[];
	/** The rect the points were built for, so they are rebuilt only when the target moves. */
	private readonly built: Rect = { x: Number.NaN, y: 0, width: 0, height: 0 };

	constructor(
		public readonly kind: HandMarkKind,
		public readonly target: Component | null,
		public readonly variant: HandMarkVariant,
		fixed: Rect | null,
	) {
		this.points = kind === 'loop' ? Array.from({ length: LOOP_POINTS }, () => ({ x: 0, y: 0 })) : [];
		if (fixed) {
			this.rect.x = fixed.x;
			this.rect.y = fixed.y;
			this.rect.width = fixed.width;
			this.rect.height = fixed.height;
		}
	}

	/** The swipe or the loop's points, from the marked rect, when it has moved. */
	public shape(): void {
		const { rect, built } = this;
		if (rect.x === built.x && rect.y === built.y && rect.width === built.width && rect.height === built.height) return;
		built.x = rect.x;
		built.y = rect.y;
		built.width = rect.width;
		built.height = rect.height;
		if (this.kind === 'highlight') {
			const cover = rect.height * HIGHLIGHT_COVER;
			this.art.x = rect.x - HIGHLIGHT_OVERRUN;
			this.art.y = rect.y + (rect.height - cover) / 2;
			this.art.width = rect.width + HIGHLIGHT_OVERRUN * 2;
			this.art.height = cover;
			return;
		}
		// The baked loop's stroke sits inside its piece, so the piece reaches further than the drawn one.
		this.art.x = rect.x - LOOP_ART_REACH;
		this.art.y = rect.y - LOOP_ART_REACH;
		this.art.width = rect.width + LOOP_ART_REACH * 2;
		this.art.height = rect.height + LOOP_ART_REACH * 2;
		const hand = LOOP_HANDS[this.variant];
		const cx = rect.x + rect.width / 2;
		const cy = rect.y + rect.height / 2;
		const rx = rect.width / 2 + LOOP_REACH;
		const ry = rect.height / 2 + LOOP_REACH;
		const cos = Math.cos(hand.tilt);
		const sin = Math.sin(hand.tilt);
		const sweep = Math.PI * 2 + hand.overrun;
		for (let index = 0; index < LOOP_POINTS; index++) {
			const t = index / (LOOP_POINTS - 1);
			const angle = hand.start + t * sweep;
			// The pencil drifts out as it goes round, so the overrun clears the start.
			const drift = 1 + t * 0.06;
			const x = Math.cos(angle) * rx * drift;
			const y = Math.sin(angle) * ry * drift;
			this.points[index].x = cx + x * cos - y * sin;
			this.points[index].y = cy + x * sin + y * cos;
		}
	}
}

/**
 * The hand layer (UI Art Direction, The hand): the player's marks drawn on
 * top of the print at W0, always fresh. Put it in the stack whose rows it
 * marks; it fills that stack's content box out of the flow (R10.15), takes
 * no hits, and stacks under or over its siblings by `zIndex` (R3.28).
 *
 * `highlight(row)` lays a highlighter swipe under a row, `loop(target)`
 * rings a component or a rect in grease pencil. A marked component is
 * followed as it moves. A mark is never the only signal: what it marks also
 * shows in the panel it drives, or carries an outline.
 */
export class HandMarkLayer extends Component {
	public readonly place: HandMarkPlace;
	private readonly list: Mark[] = [];
	private inks: AtlasInks;
	private readonly corner: Vec2 = { x: 0, y: 0 };
	private readonly lifted: Vec2 = { x: 0, y: 0 };

	constructor({ place = 'over', ...options }: HandMarkLayerOptions = {}) {
		super({ widthMode: 'fill', heightMode: 'fill', ...options, positioned: 'absolute', pointerEvents: 'none', zIndex: place === 'under' ? -1 : 1 });
		this.componentType = 'HandMarkLayer';
		this.place = place;
		this.inks = atlasInks(this.themeTokens);
	}

	public get marks(): readonly HandMark[] {
		return this.list;
	}

	/** A highlighter swipe under `row`. */
	public highlight(row: Component, { variant }: { variant?: HandMarkVariant } = {}): HandMark {
		return this.add(new Mark('highlight', row, variant ?? this.nextVariant(), null));
	}

	/** A grease-pencil loop round `target`, a component or a rect in this layer's space. */
	public loop(target: Component | Rect, { variant }: { variant?: HandMarkVariant } = {}): HandMark {
		const component = target instanceof Component ? target : null;
		return this.add(new Mark('loop', component, variant ?? this.nextVariant(), component ? null : (target as Rect)));
	}

	public remove(mark: HandMark): void {
		const index = this.list.indexOf(mark as Mark);
		if (index >= 0) this.list.splice(index, 1);
	}

	public clear(): void {
		this.list.length = 0;
	}

	/** Where a mark sits in this layer's space now; null when its target is not beside or under this layer. */
	public markRect(mark: HandMark): Readonly<Rect> | null {
		const found = mark as Mark;
		return this.locate(found) ? found.rect : null;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'none';
	}

	/** A loop reaches past its target, which may sit at this layer's edge. */
	public get inkExtent(): number {
		return LOOP_ART_REACH * 2;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	public render(draw: DrawApi): void {
		for (const mark of this.list) {
			if (!this.locate(mark)) continue;
			mark.shape();
			if (mark.kind === 'highlight') {
				if (!drawAtlasArt(draw, { name: HIGHLIGHT_PIECES[mark.variant], rect: mark.art })) draw.drawRect({ rect: mark.art, fill: this.inks.highlighterTone });
			} else if (!drawAtlasArt(draw, { name: LOOP_PIECES[mark.variant], rect: mark.art })) {
				draw.drawPolyline({ points: mark.points, color: this.inks.grease, width: LOOP_WIDTH, cap: 'round' });
			}
		}
	}

	private add(mark: Mark): Mark {
		this.list.push(mark);
		return mark;
	}

	private nextVariant(): HandMarkVariant {
		return (this.list.length % 4) as HandMarkVariant;
	}

	/** Carries a target's box into this layer's space through the parent they share; a fixed rect is already there. */
	private locate(mark: Mark): boolean {
		const target = mark.target;
		if (!target) return true;
		const parent = this.parent;
		if (!parent || !target.visible) return false;
		const corner = this.corner;
		corner.x = 0;
		corner.y = 0;
		if (!target.localToAncestorInto(corner, parent, this.lifted)) return false;
		const x = this.lifted.x;
		const y = this.lifted.y;
		corner.x = target.width;
		corner.y = target.height;
		target.localToAncestorInto(corner, parent, this.lifted);
		mark.rect.x = Math.min(x, this.lifted.x) - this.originX;
		mark.rect.y = Math.min(y, this.lifted.y) - this.originY;
		mark.rect.width = Math.abs(this.lifted.x - x);
		mark.rect.height = Math.abs(this.lifted.y - y);
		return true;
	}
}
