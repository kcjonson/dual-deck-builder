import { Component, ComponentOptions, ResolvedColors } from './Component';
import { grownRect } from './componentGeometry';
import type { Rect } from '../draw/geometry';
import type { RGBA } from '../draw';
import type { DrawApi } from '../draw/DrawApi';
import { ICON_ATLAS_ROLE } from '../text/fontFaces';
import { ICON_CODE_POINTS, IconName } from '../text/icons';
import { tokens } from '../theme/tokens';

export interface IconOptions extends ComponentOptions {
	/** A name from the generated icon set (`icons.ts`). */
	glyph: IconName;
	/** The icon's em square, logical pixels. The box defaults to it. */
	size: number;
	/** The glyph colour; a token colour, `tokens.color.text` unless given. */
	tint?: RGBA;
}

/**
 * R12.6's icon: one glyph from the icon atlas, drawn in `text` mode with the
 * icon's size and tint and centred in its box. The atlas's em square is the
 * icon's design grid, so a 16 px icon occupies a 16 px square whatever the
 * glyph's own ink.
 */
export class Icon extends Component {
	private glyphName: IconName;
	private glyphSize: number;
	private glyphTint: RGBA;
	private text: string;

	constructor({ glyph, size, tint = tokens.color.text, ...options }: IconOptions) {
		super({ width: size, height: size, ...options });
		this.componentType = 'Icon';
		this.glyphName = glyph;
		this.glyphSize = size;
		this.glyphTint = tint;
		this.text = String.fromCodePoint(ICON_CODE_POINTS[glyph]);
	}

	get glyph(): IconName {
		return this.glyphName;
	}

	set glyph(glyph: IconName) {
		this.glyphName = glyph;
		this.text = String.fromCodePoint(ICON_CODE_POINTS[glyph]);
	}

	get size(): number {
		return this.glyphSize;
	}

	/** Resizes the glyph and makes the box the same square. */
	set size(size: number) {
		this.glyphSize = size;
		this.setSize(size, size);
	}

	get tint(): RGBA {
		return this.glyphTint;
	}

	set tint(tint: RGBA) {
		this.glyphTint = tint;
	}

	public get resolvedColors(): ResolvedColors {
		return { text: this.glyphTint };
	}

	/** The box grown by an em: a glyph's quad, padding included, may reach past its design square (DDB-184). */
	protected get cullInk(): Rect {
		return grownRect(this.inkRect, this.glyphSize);
	}

	public render(draw: DrawApi): void {
		this.drawGlyph(draw, 0, 0);
	}

	/**
	 * The glyph with its box at (x, y) in the caller's space. A composite that
	 * draws its own parts (R8.8) calls this from its `render` with the icon's
	 * position, so the glyph is one of its own draws, in its own order.
	 */
	public drawGlyph(draw: DrawApi, x: number, y: number): void {
		// The icon atlas's em box is the glyph's whole line (ascender 1,
		// descender 0), so `middle` centres the design square in the box.
		draw.drawText({
			id: this.id ?? undefined,
			text: this.text,
			box: { x, y, width: this.width, height: this.height },
			font: ICON_ATLAS_ROLE,
			size: this.glyphSize,
			color: this.glyphTint,
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
		});
	}
}
