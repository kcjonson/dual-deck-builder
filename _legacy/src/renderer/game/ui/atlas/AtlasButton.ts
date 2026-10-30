import type { ClickCallback, ComponentOptions } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import type { LookLayers } from '../../../engine/style/look';
import { tokens } from '../../../engine/theme/tokens';
import type { Theme } from '../../../engine/theme/tokens';
import { LabelledPressable } from '../../../engine/ui/LabelledPressable';
import { dashedOutlineTriangles } from '../stripes';
import { ATLAS, AtlasInks, DISPLAY_BOLD, atlasInks } from './atlasStyle';
import { GlyphPaint, MapGlyphGeometry, glyphPaint, glyphWidth } from './mapGlyphs';

/** `highway` is the screen's one primary action; `backRoad` is everything secondary (UI Art Direction, Components). */
export type AtlasButtonVariant = 'highway' | 'backRoad';

/** `start` sets the label at the left, the shield at the right (the compound's primary); `center` centres it. */
export type AtlasLabelAlign = 'start' | 'center';

export interface AtlasButtonOptions extends Omit<ComponentOptions, 'style'> {
	label: string;
	variant?: AtlasButtonVariant;
	/** The highway's shield glyph at the right, with an arrow in it, for an action that goes somewhere. */
	shield?: boolean;
	/** The label's size: highway 28 by default and never under 18.66, back road 19. */
	labelSize?: number;
	/** Default `start` on the highway, `center` on the back road. */
	labelAlign?: AtlasLabelAlign;
	/** Fills the parent stack's width. */
	block?: boolean;
	disabled?: boolean;
	onClick?: ClickCallback;
}

const CLEAR: RGBA = [0, 0, 0, 0];
const DEFAULT_HEIGHT: Readonly<Record<AtlasButtonVariant, number>> = { highway: 60, backRoad: ATLAS.minHit + 2 };
const LABEL_INSET: Readonly<Record<AtlasButtonVariant, number>> = { highway: 20, backRoad: 16 };
/** The shield is this share of the highway's face, as the canvas's 38 in 68. */
const SHIELD_SHARE = 0.56;

function buttonLayers(variant: AtlasButtonVariant, inks: AtlasInks): LookLayers {
	const disabled = { fill: inks.freshPaper, border: inks.fadedPrint, text: inks.fadedPrint };
	if (variant === 'highway') {
		const normal = { fill: inks.highway, border: inks.casing, borderWidth: ATLAS.highwayBorder, radius: 0, text: inks.highwayLabel, shadow: null };
		return {
			normal,
			selected: normal,
			hover: { border: inks.ink, offsetY: -ATLAS.hoverLift },
			pressed: { offsetY: ATLAS.highwayOffset },
			active: {},
			disabled,
			focusRing: inks.focusRing,
		};
	}
	const normal = { fill: inks.freshPaper, border: inks.backRoad, borderWidth: ATLAS.backRoadBorder, radius: 0, text: inks.ink, shadow: null };
	return {
		normal,
		selected: normal,
		hover: { border: inks.ink, offsetY: -ATLAS.hoverLift },
		pressed: { wash: inks.hover, border: inks.ink, offsetY: ATLAS.hoverLift },
		active: {},
		disabled,
		focusRing: inks.focusRing,
	};
}

/**
 * The atlas's buttons (UI Art Direction, Components).
 *
 * The highway: Highway fill, a 4 px Casing border, a 3 px Casing offset
 * beneath, the label in display 700 at 28 px (never under 18.66 px, the
 * floor for paper-coloured text on the orange), and an optional shield.
 * The back road: fresh paper, a 1.6 px back-road border, and a 1 px inner
 * rule 3 px in, its label in display 700 at 19 px in ink.
 *
 * Both lift 1 px with an ink border on hover; a press collapses the
 * highway's offset (it sits 3 px lower) and nudges the back road down a
 * pixel; focus visible is a 2 px ink ring 3 px out; disabled is faded print
 * with a dashed border. At least 44 px tall. States resolve through R11.12's
 * layers and move by R11.13's transitions; every colour comes from the
 * component's theme tokens.
 */
export class AtlasButton extends LabelledPressable {
	public readonly variant: AtlasButtonVariant;
	private readonly hasShield: boolean;
	private inks: AtlasInks;
	private readonly shield: MapGlyphGeometry | null;
	private shieldPaint: GlyphPaint;
	private fadedShieldPaint: GlyphPaint;
	private readonly faceRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly offset: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly labelBox: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly ring: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly dashes: Vec2[] = [];
	private readonly labelSize: number;
	private readonly labelAlign: AtlasLabelAlign;

	constructor({ label, variant = 'backRoad', shield = false, labelSize, labelAlign, block = false, disabled = false, onClick, height, ...options }: AtlasButtonOptions) {
		const size = variant === 'highway'
			? Math.max(ATLAS.highwayLabelMin, labelSize ?? ATLAS.highwayLabel)
			: labelSize ?? ATLAS.backRoadLabel;
		super({
			label,
			face: { font: DISPLAY_BOLD, size, letterSpacing: 0, textTransform: 'none' },
			layers: buttonLayers(variant, atlasInks(tokens)),
			inset: LABEL_INSET[variant],
			height: Math.max(ATLAS.minHit, height ?? DEFAULT_HEIGHT[variant]),
			...(block ? { widthMode: 'fill' } : {}),
			...(disabled ? { enabled: false } : {}),
			...options,
		});
		this.componentType = 'AtlasButton';
		this.variant = variant;
		this.hasShield = shield && variant === 'highway';
		this.labelSize = size;
		this.labelAlign = labelAlign ?? (variant === 'highway' ? 'start' : 'center');
		this.inks = atlasInks(this.themeTokens);
		this.layers = buttonLayers(variant, this.inks);
		this.transition.moveTo(this.targetLook, null);
		this.shield = this.hasShield ? new MapGlyphGeometry('shield') : null;
		this.shieldPaint = glyphPaint('shield', this.inks, { tone: 'paper' });
		this.fadedShieldPaint = glyphPaint('shield', this.inks, { faded: true });
		if (onClick) this.onClick = onClick;
	}

	/** The ring is the look's layer 6, drawn round the face wherever a press or hover moved it. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** The ring 3 px out, and a hover's 1 px lift. */
	public get inkExtent(): number {
		return ATLAS.focusRingGap + ATLAS.focusRingWidth + ATLAS.hoverLift;
	}

	public get hugWidth(): number {
		const label = super.hugWidth;
		if (label === 0 || !this.hasShield) return label;
		return label + glyphWidth('shield', this.shieldSize) + LABEL_INSET.highway / 2;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.layers = buttonLayers(this.variant, this.inks);
		this.shieldPaint = glyphPaint('shield', this.inks, { tone: 'paper' });
		this.fadedShieldPaint = glyphPaint('shield', this.inks, { faded: true });
		this.transition.moveTo(this.targetLook, null);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		this.placeGeometry();
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const enabled = this.effectivelyEnabled;
		const inks = this.inks;
		const highway = this.variant === 'highway';
		if (highway && enabled && look.offsetY < ATLAS.highwayOffset) draw.drawRect({ rect: this.offset, fill: inks.casing });
		// The face and all on it move with the look's offset; the geometry stays as laid out.
		const moved = look.offsetY !== 0;
		if (moved) draw.pushTranslate(0, look.offsetY);
		if (enabled) {
			draw.drawRect({ id: this.id ?? undefined, rect: this.faceRect, fill: look.fill, border: { color: look.border, width: look.borderWidth } });
		} else {
			draw.drawRect({ id: this.id ?? undefined, rect: this.faceRect, fill: look.fill });
			draw.drawPolygon({ points: this.dashes, fill: look.border });
		}
		if (!highway && enabled) draw.drawRect({ rect: this.rule, fill: CLEAR, border: { color: inks.hairline, width: ATLAS.backRoadRule } });
		if (this.shield) this.shield.draw(draw, enabled ? this.shieldPaint : this.fadedShieldPaint, null, true);
		draw.drawText({
			text: this.label,
			box: this.labelBox,
			font: DISPLAY_BOLD,
			size: this.labelSize,
			color: look.text,
			align: this.labelAlign === 'start' ? 'left' : 'center',
			verticalAlign: 'middle',
			wrap: 'none',
			overflow: 'ellipsis',
		});
		if (look.focusRing) draw.drawRect({ rect: this.ring, fill: CLEAR, border: { color: look.focusRing, width: ATLAS.focusRingWidth, position: 'outside' } });
		if (moved) draw.popTransform();
	}

	private get shieldSize(): number {
		return Math.round((this.height - ATLAS.highwayOffset) * SHIELD_SHARE);
	}

	/** Everything at rest, once per size; a hover or press translates it in `render`. */
	private placeGeometry(): void {
		const { width, height } = this;
		const highway = this.variant === 'highway';
		const faceHeight = highway ? height - ATLAS.highwayOffset : height - ATLAS.hoverLift;
		setRect(this.faceRect, 0, 0, width, faceHeight);
		setRect(this.offset, 0, ATLAS.highwayOffset, width, faceHeight);
		const ruleInset = ATLAS.backRoadBorder + ATLAS.backRoadRuleInset;
		setRect(this.rule, ruleInset, ruleInset, width - ruleInset * 2, faceHeight - ruleInset * 2);
		const gap = ATLAS.focusRingGap;
		setRect(this.ring, -gap, -gap, width + gap * 2, faceHeight + gap * 2);
		const inset = LABEL_INSET[this.variant];
		let labelRight = width - inset;
		if (this.shield) {
			const size = this.shieldSize;
			const x = width - inset - glyphWidth('shield', size);
			this.shield.place(x, (faceHeight - size) / 2, size);
			labelRight = x - inset / 2;
		}
		setRect(this.labelBox, inset, 0, labelRight - inset, faceHeight);
		// Disabled has no hover or press, so its dashed border is only ever drawn at rest.
		dashedOutlineTriangles(this.faceRect, { width: ATLAS.backRoadBorder, dash: ATLAS.dash, gap: ATLAS.dashGap }, this.dashes);
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
