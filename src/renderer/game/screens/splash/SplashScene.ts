import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
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

interface Range {
	min: number;
	max: number;
}

interface GrainLayer {
	/** Streak heights in design pixels, and how far down the next row starts, as a share of the height. */
	height: Range;
	step: number;
	/** A streak's share of the width. */
	length: Range;
	/** How often a run is drawn rather than left as bare table. */
	density: number;
	light: Range;
	dark: Range;
}

/**
 * The table's grain, FinalSplash's stretched turbulence done as faint,
 * overlapping horizontal streaks: broad bands of tone, then fine lines over
 * them. Seeded, laid out once per size, and never animated.
 */
const GRAIN_SEED = 506;
const GRAIN: readonly GrainLayer[] = [
	{ height: { min: 8, max: 26 }, step: 0.7, length: { min: 0.3, max: 1.1 }, density: 0.7, light: { min: 0.015, max: 0.045 }, dark: { min: 0.06, max: 0.18 } },
	{ height: { min: 1, max: 3 }, step: 3, length: { min: 0.08, max: 0.5 }, density: 0.5, light: { min: 0.03, max: 0.07 }, dark: { min: 0.1, max: 0.25 } },
];

interface Streak {
	/** Shares of the width, and design pixels down the 900 px table. */
	x: number;
	y: number;
	width: number;
	height: number;
	light: boolean;
	alpha: number;
}

function grainStreaks(): Streak[] {
	const rng = new Rng({ seed: GRAIN_SEED });
	const between = ({ min, max }: Range): number => min + rng.float() * (max - min);
	const streaks: Streak[] = [];
	for (const layer of GRAIN) {
		for (let y = 0; y < DESIGN.height;) {
			const height = between(layer.height);
			for (let x = -rng.float() * layer.length.max; x < 1;) {
				const width = between(layer.length);
				if (rng.float() < layer.density) {
					const light = rng.float() < 0.5;
					streaks.push({ x, y, width, height, light, alpha: between(light ? layer.light : layer.dark) });
				}
				x += width;
			}
			y += height * layer.step;
		}
	}
	return streaks;
}

const STREAKS: readonly Streak[] = grainStreaks();

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
	private readonly table: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly streaks: Rect[] = STREAKS.map(() => ({ x: 0, y: 0, width: 0, height: 0 }));
	private streakColors: RGBA[] = [];

	constructor({ buildLine, ...options }: SplashSceneOptions) {
		super({ ...options, widthMode: 'fill', heightMode: 'fill' });
		this.componentType = 'SplashScene';
		this.inks = atlasInks(this.themeTokens);
		this.streakColors = streakColors(this.inks);

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
		this.streakColors = streakColors(this.inks);
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

		setRect(this.table, 0, 0, width, height);
		const rows = height / DESIGN.height;
		STREAKS.forEach((streak, index) => {
			const left = Math.max(0, streak.x);
			const right = Math.min(1, streak.x + streak.width);
			setRect(this.streaks[index], left * width, streak.y * rows, (right - left) * width, streak.height * rows);
		});
	}

	public render(draw: DrawApi): void {
		draw.drawRect({ id: this.id ?? undefined, rect: this.table, fill: this.inks.table });
		for (let index = 0; index < this.streaks.length; index++) {
			draw.drawRect({ rect: this.streaks[index], fill: this.streakColors[index] });
		}
	}
}

/** Each streak's colour: the sheet's tone or the shadow's, faint, over the table. */
function streakColors(inks: AtlasInks): RGBA[] {
	return STREAKS.map(({ light, alpha }) => {
		const [r, g, b] = light ? inks.sheet : inks.shadow;
		return [r, g, b, alpha];
	});
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
