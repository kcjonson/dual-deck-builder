import { Layer } from '../../../engine/components/Layer';
import type { DrawApi, RGBA, Rect, TextAlign } from '../../../engine/draw';

export interface DrawFixtureOptions {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Draws in the fixture's own space: (0, 0) is its top-left corner. */
	paint: (draw: DrawApi) => void;
	/** Releases whatever `paint` holds (textures), once, when the fixture unmounts. */
	release?: () => void;
}

/**
 * A gallery fixture that talks to the draw API directly, for the spec's
 * rendering fixtures (chapters 3, 4 and 5): what they test is the draw core,
 * and several of the things they need (layer promotion, blend modes, per-corner
 * radii, border positions) have no component that exposes them yet. The tree
 * snapshot sees one node with its bounds, so the scene stays inside the lint
 * gate without the fixture's deliberately overlapping shapes reading as
 * sibling overlaps.
 */
export class DrawFixture extends Layer {
	private readonly paint: (draw: DrawApi) => void;
	private release: (() => void) | null;

	constructor({ id, x, y, width, height, paint, release }: DrawFixtureOptions) {
		super({ id, x, y, width, height });
		this.componentType = 'DrawFixture';
		this.paint = paint;
		this.release = release ?? null;
	}

	/** The walk has already translated to the fixture's origin. */
	public render(draw: DrawApi): void {
		this.paint(draw);
	}

	public unmount(): void {
		super.unmount();
		const release = this.release;
		this.release = null;
		release?.();
	}
}

export interface FixtureLabelOptions {
	text: string;
	box: Rect;
	color?: RGBA;
	size?: number;
	align?: TextAlign;
}

/** A body-role caption centred in `box`, the fixtures' "text over every one of them". */
export function fixtureLabel(draw: DrawApi, { text, box, color = [1, 1, 1, 1], size = 13, align = 'center' }: FixtureLabelOptions): void {
	draw.drawText({ text, box, font: 'body', size, color, align, verticalAlign: 'middle' });
}

/** A heading above a group of fixtures. */
export function fixtureHeading(draw: DrawApi, text: string, x: number, y: number): void {
	draw.drawText({ text, box: { x, y, width: 600, height: 20 }, font: 'body', size: 15, color: [0.75, 0.78, 0.82, 1], align: 'left', verticalAlign: 'top' });
}
