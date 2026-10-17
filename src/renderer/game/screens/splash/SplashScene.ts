import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { DrawRectOptions } from '../../../engine/draw/commands';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { Rng } from '../../core/Rng';
import { AtlasInks, atlasInks } from '../../ui/atlas/atlasStyle';
import { DeckFan, DeckStack } from '../../ui/atlas/deck';
import { ScaleBar } from '../../ui/atlas/gauges';
import { ClosedAtlas } from './ClosedAtlas';

/**
 * FinalSplash's composition at 1440 by 900: where the book, the two decks,
 * and the loader sit. The book and decks scale down together to fit a
 * smaller window; the loader and the build line keep their size, so they
 * stay legible.
 */
const DESIGN = {
	width: 1440,
	height: 900,
	book: { x: 310, y: 120 },
	/** Deck A's unturned card corner, the fan's turn, and its card width (the mock's 100 at 1.25). */
	deckA: { x: 120, y: 470, turn: -24, card: 125 },
	deckB: { x: 1150, y: 150, turn: 16, card: 125 },
	loader: { y: 748, width: 420, bar: 12, frame: 2, gap: 8, segments: 10, size: 12, tracking: 0.14 },
	build: { bottom: 26, size: 10, tracking: 0.18, line: 14 },
} as const;

const DEG = Math.PI / 180;

interface GrainBand {
	/** Design pixels down the 900 px table; a band runs the full width. */
	y: number;
	height: number;
	/** Sheet tone lifts the table, shadow tone darkens it. */
	light: boolean;
	alpha: number;
}

/**
 * The table's grain: FinalSplash's stretched turbulence as a few dozen
 * full-width bands of faint tone tiling the height, seeded once at load.
 * Each band's draw options are built once and only re-placed on a resize,
 * so a frame allocates nothing.
 */
function grainBands(): GrainBand[] {
	const rng = new Rng({ seed: 506 });
	const between = (min: number, max: number): number => min + rng.float() * (max - min);
	const bands: GrainBand[] = [];
	for (let y = 0; y < DESIGN.height;) {
		const height = rng.float() < 0.3 ? between(2, 6) : between(12, 44);
		const light = rng.float() < 0.45;
		bands.push({ y, height, light, alpha: light ? between(0.01, 0.035) : between(0.05, 0.2) });
		y += height;
	}
	return bands;
}

const BANDS: readonly GrainBand[] = grainBands();

/**
 * Under the build line the table is always darkened, and no light band
 * reaches it, so faded print holds 4.5:1 there on the grain (UI Art
 * Direction, Wear: text holds 4.5:1 measured on the texture).
 */
const BUILD_GROUND = { alpha: 0.2, above: 12 } as const;


export interface SplashSceneOptions extends Omit<StackOptions, 'direction' | 'padding' | 'style'> {
	/** The line at the bottom naming the build. */
	buildLine: string;
}

/**
 * The launch splash's table (UI Art Direction, Screens, Launch splash): the
 * dark table with a baked grain, the closed atlas centred on it, deck A
 * fanned at its lower left and deck B stacked at its upper right, both
 * partly under the book, the scale-bar loader captioned "UNFOLDING THE MAP"
 * with the percentage, and the build line at the bottom. It fills its box
 * and places everything by hand from FinalSplash's geometry.
 */
export class SplashScene extends Stack {
	public readonly book: ClosedAtlas;
	public readonly deckA: DeckFan;
	public readonly deckB: DeckStack;
	public readonly loader: Stack;
	public readonly bar: ScaleBar;
	public readonly build: Text;
	private readonly caption: Text;
	private readonly percentText: Text;
	private shown = -1;
	private inks: AtlasInks;
	private readonly table: DrawRectOptions = { rect: { x: 0, y: 0, width: 0, height: 0 }, fill: [0, 0, 0, 1] };
	private readonly bands: DrawRectOptions[] = BANDS.map(() => ({ rect: { x: 0, y: 0, width: 0, height: 0 }, fill: [0, 0, 0, 0] }));
	private readonly buildGround: DrawRectOptions = { rect: { x: 0, y: 0, width: 0, height: 0 }, fill: [0, 0, 0, 0] };

	constructor({ buildLine, ...options }: SplashSceneOptions) {
		super({ ...options, widthMode: 'fill', heightMode: 'fill' });
		this.componentType = 'SplashScene';
		this.inks = atlasInks(this.themeTokens);
		this.paintTable();

		// Under the book, which the lint reads as declared overlap (R13.25.1).
		this.deckA = new DeckFan({ id: 'splash_deck_a', driver: 'a', width: DESIGN.deckA.card, zIndex: -1 });
		this.deckB = new DeckStack({ id: 'splash_deck_b', driver: 'b', width: DESIGN.deckB.card, edges: 4, zIndex: -1 });
		this.book = new ClosedAtlas({ id: 'splash_book' });

		const { loader } = DESIGN;
		this.bar = new ScaleBar({ id: 'splash_loader_bar', segments: loader.segments, value: 0, tone: 'highway', frame: loader.frame, width: loader.width, height: loader.bar });
		const captionStyle = { fontRole: 'mono', fontSize: loader.size, letterSpacing: loader.tracking, color: 'bg_inset' } as const;
		this.caption = new Text({ id: 'splash_loader_caption', text: 'UNFOLDING THE MAP', style: captionStyle, wrap: 'none' });
		this.percentText = new Text({ id: 'splash_loader_percent', text: '0%', style: { ...captionStyle, textAlign: 'right' }, wrap: 'none' });
		const captionRow = new Stack({ direction: 'horizontal', widthMode: 'fill', distribution: 'spaceBetween' });
		captionRow.addChild(this.caption);
		captionRow.addChild(this.percentText);
		this.loader = new Stack({ id: 'splash_loader', width: loader.width, gap: loader.gap });
		this.loader.addChild(this.bar);
		this.loader.addChild(captionRow);

		this.build = new Text({
			id: 'splash_build',
			text: buildLine,
			style: { fontRole: 'mono', fontSize: DESIGN.build.size, letterSpacing: DESIGN.build.tracking, textAlign: 'center', color: 'text_disabled' },
			wrap: 'none',
			verticalAlign: 'middle',
		});

		this.addChild(this.deckA);
		this.addChild(this.deckB);
		this.addChild(this.book);
		this.addChild(this.loader);
		this.addChild(this.build);
		this.progress = 0;
	}

	/** Loading progress, 0 to 1: the bar's filled segments and the whole percentage under it. */
	public get progress(): number {
		return this.shown / 100;
	}

	public set progress(value: number) {
		const percent = Math.floor(Math.min(1, Math.max(0, value)) * 100);
		if (percent === this.shown) return;
		this.shown = percent;
		this.bar.value = percent / 100;
		this.percentText.text = `${percent}%`;
	}

	public get percentLabel(): string {
		return this.percentText.text;
	}

	/** The book's and decks' scale at this size: the mock's at 1440 by 900 or larger, smaller to fit. */
	public get bookScale(): number {
		return Math.min(1, this.width / DESIGN.width, this.height / DESIGN.height);
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.paintTable();
	}

	/** The table's and each band's colour, written into the cached draw options. */
	private paintTable(): void {
		const { table, sheet, shadow } = this.inks;
		setColor(this.table.fill, table, table[3]);
		BANDS.forEach((band, index) => setColor(this.bands[index].fill, band.light ? sheet : shadow, band.alpha));
		setColor(this.buildGround.fill, shadow, BUILD_GROUND.alpha);
	}

	protected layoutChildren(): void {
		const { width, height } = this;
		const scale = this.bookScale;
		const originX = (width - DESIGN.width * scale) / 2;
		const originY = (height - DESIGN.height * scale) / 2;

		this.book.setPosition(originX + DESIGN.book.x * scale, originY + DESIGN.book.y * scale);
		this.book.transform = { scale, origin: [0, 0] };

		// The fan is placed by its unturned card, as the mock's transform places it.
		const fan = DESIGN.deckA;
		const turn = fan.turn * DEG;
		const corner = this.deckA.cardOrigin;
		const reachX = (Math.cos(turn) * corner.x - Math.sin(turn) * corner.y) * scale;
		const reachY = (Math.sin(turn) * corner.x + Math.cos(turn) * corner.y) * scale;
		this.deckA.setPosition(originX + fan.x * scale - reachX, originY + fan.y * scale - reachY);
		this.deckA.transform = { rotate: turn, scale, origin: [0, 0] };

		this.deckB.setPosition(originX + DESIGN.deckB.x * scale, originY + DESIGN.deckB.y * scale);
		this.deckB.transform = { rotate: DESIGN.deckB.turn * DEG, scale, origin: [0, 0] };

		const loaderSize = this.loader.measure(DESIGN.loader.width, height);
		this.loader.assignSize(DESIGN.loader.width, loaderSize.height);
		this.loader.setPosition(Math.round((width - DESIGN.loader.width) / 2), Math.round(originY + DESIGN.loader.y * scale));

		const { build } = DESIGN;
		this.build.setPosition(0, height - build.bottom - build.line);
		this.build.setSize(width, build.line);

		this.table.id = this.id ?? undefined;
		setRect(this.table.rect, 0, 0, width, height);
		const groundTop = this.build.y - BUILD_GROUND.above;
		setRect(this.buildGround.rect, 0, groundTop, width, height - groundTop);
		const rows = height / DESIGN.height;
		BANDS.forEach((band, index) => {
			const top = band.y * rows;
			const bottom = band.light ? Math.min(top + band.height * rows, groundTop) : top + band.height * rows;
			setRect(this.bands[index].rect, 0, top, width, bottom - top);
		});
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.table);
		for (let index = 0; index < this.bands.length; index++) draw.drawRect(this.bands[index]);
		draw.drawRect(this.buildGround);
	}
}

function setColor(target: RGBA | undefined, source: RGBA, alpha: number): void {
	if (!target) return;
	const color = target as [number, number, number, number];
	color[0] = source[0];
	color[1] = source[1];
	color[2] = source[2];
	color[3] = alpha;
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
