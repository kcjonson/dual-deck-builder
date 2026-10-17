import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Text } from '../../../engine/components/Text';
import type { BoxShadow, DrawRectOptions } from '../../../engine/draw/commands';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { uiArtSize } from '../../art/uiArt';
import { DrawAtlasArtOptions, drawAtlasArt } from '../../ui/atlas/atlasArt';
import { ATLAS, AtlasInks, atlasInks } from '../../ui/atlas/atlasStyle';

const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * The closed atlas's geometry, from FinalSplash: the cover sheet, the page
 * edges stepping out 10 px right and down (baked into `atlas_cover`), the
 * neatline the piece also carries, the logo, and the two cover lines
 * centred on the neatline.
 */
export const COVER = {
	sheet: { width: 820, height: 560 },
	pageEdges: 10,
	neatline: { outer: { x: 44, y: 18, right: 18, bottom: 18 }, gap: 8 },
	logo: { x: 73, y: 94 },
	kicker: { y: 52, height: 18, size: 12, tracking: 1 / 3 },
	edition: { y: 490, height: 24, size: 16 },
	shadow: { blur: 44, offsetY: 22 },
} as const;

const NEATLINE_LEFT = COVER.neatline.outer.x;
const NEATLINE_RIGHT = COVER.sheet.width - COVER.neatline.outer.right;

/**
 * The closed atlas lying on the splash's table (UI Art Direction, Screens):
 * the `atlas_cover` piece (the W2 cover with its spine shadow, neatline, and
 * page edges), the logo between "A road atlas of the Halcyon region" and
 * "fourth edition, revised after", and the sheet's drop shadow. Its box is
 * the cover at the mock's size; the splash scales it with `transform`. With
 * the art page not resident the cover is flat sheet with the neatline drawn
 * in ink, and the logo is left out.
 */
export class ClosedAtlas extends Component {
	private inks: AtlasInks;
	private readonly shadow: BoxShadow;
	private readonly sheet: Rect = { x: 0, y: 0, width: COVER.sheet.width, height: COVER.sheet.height };
	private readonly cover: Rect = { x: 0, y: 0, width: COVER.sheet.width + COVER.pageEdges, height: COVER.sheet.height + COVER.pageEdges };
	private readonly logo: Rect = { x: COVER.logo.x, y: COVER.logo.y, ...uiArtSize('logo') };
	private readonly outerRule: Rect;
	private readonly innerRule: Rect;
	private readonly kicker: Text;
	private readonly edition: Text;
	/** Draw options built once, so a frame allocates nothing. */
	private readonly shadowDraw: DrawRectOptions;
	private readonly coverDraw: DrawAtlasArtOptions = { name: 'atlas_cover', rect: this.cover };
	private readonly logoDraw: DrawAtlasArtOptions = { name: 'logo', rect: this.logo };
	private outerRuleDraw: DrawRectOptions;
	private innerRuleDraw: DrawRectOptions;

	constructor(options: Omit<ComponentOptions, 'width' | 'height'> = {}) {
		super({ ...options, width: COVER.sheet.width + COVER.pageEdges, height: COVER.sheet.height + COVER.pageEdges });
		this.componentType = 'ClosedAtlas';
		this.inks = atlasInks(this.themeTokens);
		this.shadow = { color: this.inks.shadow, blur: COVER.shadow.blur, offset: { x: 0, y: COVER.shadow.offsetY } };
		const { outer, gap } = COVER.neatline;
		this.outerRule = { x: outer.x, y: outer.y, width: COVER.sheet.width - outer.x - outer.right, height: COVER.sheet.height - outer.y - outer.bottom };
		this.innerRule = { x: outer.x + gap, y: outer.y + gap, width: this.outerRule.width - gap * 2, height: this.outerRule.height - gap * 2 };
		this.shadowDraw = { rect: this.sheet, fill: CLEAR, shadow: this.shadow };
		[this.outerRuleDraw, this.innerRuleDraw] = this.ruleDraws();
		this.kicker = new Text({
			id: 'splash_cover_kicker',
			text: 'A road atlas of the Halcyon region',
			style: { fontRole: 'mono', fontSize: COVER.kicker.size, letterSpacing: COVER.kicker.tracking, textTransform: 'uppercase', textAlign: 'center', color: 'text_dim' },
			wrap: 'none',
			verticalAlign: 'middle',
		});
		// The spec's subtitle is the serif italic role, which is phase two; until then subtitles set in body.
		this.edition = new Text({
			id: 'splash_cover_edition',
			text: 'fourth edition, revised after',
			style: { fontSize: COVER.edition.size, textAlign: 'center', color: 'text_dim' },
			wrap: 'none',
			verticalAlign: 'middle',
		});
		this.addPart(this.kicker);
		this.addPart(this.edition);
	}

	public get kickerText(): string {
		return this.kicker.text;
	}

	public get editionText(): string {
		return this.edition.text;
	}

	/** The sheet's drop shadow. */
	public get inkExtent(): number {
		return COVER.shadow.blur + COVER.shadow.offsetY;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.shadow.color = this.inks.shadow;
		[this.outerRuleDraw, this.innerRuleDraw] = this.ruleDraws();
	}

	protected layoutChildren(): void {
		const width = NEATLINE_RIGHT - NEATLINE_LEFT;
		this.kicker.setPosition(NEATLINE_LEFT, COVER.kicker.y);
		this.kicker.setSize(width, COVER.kicker.height);
		this.edition.setPosition(NEATLINE_LEFT, COVER.edition.y);
		this.edition.setSize(width, COVER.edition.height);
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.shadowDraw);
		this.coverDraw.id = this.id ?? undefined;
		if (!drawAtlasArt(draw, this.coverDraw)) {
			draw.drawRect(this.outerRuleDraw);
			draw.drawRect(this.innerRuleDraw);
		}
		drawAtlasArt(draw, this.logoDraw);
	}

	/** The neatline's flat stand-ins, in the theme's ink. */
	private ruleDraws(): [DrawRectOptions, DrawRectOptions] {
		const color = this.inks.ink;
		return [
			{ rect: this.outerRule, fill: CLEAR, border: { color, width: ATLAS.neatlineOuter, position: 'center' } },
			{ rect: this.innerRule, fill: CLEAR, border: { color, width: ATLAS.neatlineInner, position: 'center' } },
		];
	}
}
