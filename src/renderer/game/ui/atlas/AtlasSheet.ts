import type { Component, PointerEvents } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Mat2D, RGBA, Rect } from '../../../engine/draw/geometry';
import { tokens } from '../../../engine/theme/tokens';
import type { Theme } from '../../../engine/theme/tokens';
import { AtlasSurface, drawAtlasArt } from './atlasArt';
import { ATLAS, AtlasInks, atlasInks } from './atlasStyle';
import type { SectionTabs } from './SectionTabs';

export interface AtlasSheetOptions extends Omit<StackOptions, 'style' | 'padding'> {
	/** The thumb-index tabs, hung from the top edge, centred. Out of the flow. */
	tabs?: SectionTabs;
	/** Between the inner neatline and the content. Default 20, the mocks'. */
	contentInset?: number;
	/** Duct tape at two opposite corners. Default on. */
	tape?: boolean;
	/** The sheet's paper: W2, worn, by default (UI Art Direction, Wear). */
	surface?: AtlasSurface;
}

const CLEAR: RGBA = [0, 0, 0, 0];
/** The table round the sheet; a space token, so the same in every theme. */
const MARGIN = tokens.space.sheet_margin;
/** A tape strip, level, about its centre; the canvas's 96 by 30, turned 34 degrees off level. */
const TAPE_RECT: Rect = { x: -48, y: -15, width: 96, height: 30 };
const TAPE_TURN = (-34 * Math.PI) / 180;
/** How far a strip's centre sits in from its corner of the box, so the whole turned strip stays on screen. */
const TAPE_IN_X = 50;
const TAPE_IN_Y = 42;

/**
 * The screen sheet (UI Art Direction, Components): one W2 page on the table
 * with the `sheet_margin` of table showing round it, a double neatline, 0.6
 * px outer and 1.6 px inner, 8 px apart, and tape at two opposite corners.
 * It fills the box it is given, the margin included, so the tabs it hangs
 * from its top edge stay inside it.
 *
 * The content is a stack (R12.18), inset inside the inner neatline by
 * `contentInset`; the tabs are the caller's component, taken out of the flow
 * as a panel's actions are (R12.19). Colours resolve from `themeTokens` and
 * follow a theme change; the page itself goes through `drawAtlasArt`.
 */
export class AtlasSheet extends Stack {
	private readonly sheetTabs: SectionTabs | null;
	private readonly showTape: boolean;
	private readonly surface: AtlasSurface;
	private inks: AtlasInks;
	private readonly sheetRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly outerRule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly innerRule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly tableRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private tapeStart: Mat2D = [1, 0, 0, 1, 0, 0];
	private tapeEnd: Mat2D = [1, 0, 0, 1, 0, 0];

	constructor({ tabs, contentInset = ATLAS.sheetPadding, tape = true, surface = 'paper_w2_a', ...options }: AtlasSheetOptions = {}) {
		const inset = MARGIN + ATLAS.neatlineInset + ATLAS.neatlineGap + contentInset;
		super({ ...options, padding: inset });
		this.componentType = 'AtlasSheet';
		this.sheetTabs = tabs ?? null;
		this.showTape = tape;
		this.surface = surface;
		this.inks = atlasInks(this.themeTokens);
		if (tabs) this.addChild(tabs);
	}

	public get tabs(): SectionTabs | null {
		return this.sheetTabs;
	}

	/** The page inside the margin, in this box. */
	public get sheet(): Readonly<Rect> {
		return this.sheetRect;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public flows(child: Component): boolean {
		if (child === this.sheetTabs) return false;
		return super.flows(child);
	}

	protected anchorsChild(child: Component): boolean {
		return super.anchorsChild(child) && child !== this.sheetTabs;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		this.placeGeometry();
		const tabs = this.sheetTabs;
		if (tabs && tabs.visible) {
			const size = tabs.measure(this.width, this.height);
			tabs.assignSize(size.width, size.height);
			tabs.setPosition(Math.round((this.width - size.width) / 2), 0);
		}
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		draw.drawRect({ id: this.id ?? undefined, rect: this.tableRect, fill: inks.table });
		drawAtlasArt(draw, { name: this.surface, rect: this.sheetRect, tint: inks.sheet });
		draw.drawRect({ rect: this.outerRule, fill: CLEAR, border: { color: inks.ink, width: ATLAS.neatlineOuter, position: 'center' } });
		draw.drawRect({ rect: this.innerRule, fill: CLEAR, border: { color: inks.ink, width: ATLAS.neatlineInner, position: 'center' } });
		if (this.showTape) {
			this.drawTape(draw, this.tapeStart, 'tape_a');
			this.drawTape(draw, this.tapeEnd, 'tape_b');
		}
	}

	private drawTape(draw: DrawApi, matrix: Mat2D, name: 'tape_a' | 'tape_b'): void {
		draw.pushTransform(matrix);
		if (!drawAtlasArt(draw, { name, rect: TAPE_RECT, tint: this.inks.tape })) draw.drawRect({ rect: TAPE_RECT, fill: this.inks.tape });
		draw.popTransform();
	}

	private placeGeometry(): void {
		const { width, height } = this;
		const margin = MARGIN;
		setRect(this.tableRect, 0, 0, width, height);
		setRect(this.sheetRect, margin, margin, width - margin * 2, height - margin * 2);
		const outer = margin + ATLAS.neatlineInset;
		const inner = outer + ATLAS.neatlineGap;
		setRect(this.outerRule, outer, outer, width - outer * 2, height - outer * 2);
		setRect(this.innerRule, inner, inner, width - inner * 2, height - inner * 2);
		const cos = Math.cos(TAPE_TURN);
		const sin = Math.sin(TAPE_TURN);
		this.tapeStart = [cos, sin, -sin, cos, TAPE_IN_X, TAPE_IN_Y];
		this.tapeEnd = [cos, sin, -sin, cos, width - TAPE_IN_X, height - TAPE_IN_Y];
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
