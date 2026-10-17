import { Component, ComponentOptions, PointerEvents } from '../../../engine/components/Component';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Rect } from '../../../engine/draw/geometry';
import { uiArtSize } from '../../art/uiArt';
import { UiArtName, drawAtlasArt } from './atlasArt';

/**
 * W3's hero marks that are their own art (UI Art Direction, Wear): the
 * rubber stamps struck once something has happened (a POI looted or
 * depleted, a fight or run lost, the compound fallen) and a tag's tear. The
 * burnt, holed, and ripped sheets are the W3 paper itself (`AtlasSheet.wear`).
 */
export type DamageMarkKind = 'looted' | 'depleted' | 'lost' | 'fallen' | 'tear';

const PIECES: Readonly<Record<DamageMarkKind, UiArtName>> = {
	looted: 'stamp_looted',
	depleted: 'stamp_depleted',
	lost: 'stamp_lost',
	fallen: 'stamp_fallen',
	tear: 'tear_a',
};

/** The piece a mark draws, for a component that draws one as its own part (`AtlasTag`). */
export function damagePiece(kind: DamageMarkKind): UiArtName {
	return PIECES[kind];
}

export interface DamageMarkOptions extends Omit<ComponentOptions, 'width' | 'height'> {
	kind: DamageMarkKind;
}

/**
 * One damage mark as a component, at its art's own size (the pieces have
 * no 2x rasters or mipmaps, so a scaled stamp would alias), for a screen
 * to strike on the sheet beside what it marks. It is the screen's one hero mark, so
 * it goes where the reading window isn't: beside a title or above a box,
 * never across text (Wear: damage sits off the reading window). The mark
 * repeats what the page already says in words, so with the art page not
 * resident it draws nothing and nothing is lost.
 */
export class DamageMark extends Component {
	private markKind: DamageMarkKind;
	private readonly box: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor({ kind, ...options }: DamageMarkOptions) {
		const size = uiArtSize(PIECES[kind]);
		super({ ...options, width: size.width, height: size.height });
		this.componentType = 'DamageMark';
		this.markKind = kind;
	}

	public get kind(): DamageMarkKind {
		return this.markKind;
	}

	/** Another mark of the same art size or not: the box follows the art. */
	public set kind(kind: DamageMarkKind) {
		if (kind === this.markKind) return;
		this.markKind = kind;
		const size = uiArtSize(PIECES[kind]);
		this.setSize(size.width, size.height);
		this.invalidateLayout();
	}

	public get piece(): UiArtName {
		return PIECES[this.markKind];
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'none';
	}

	public render(draw: DrawApi): void {
		this.box.width = this.width;
		this.box.height = this.height;
		drawAtlasArt(draw, { id: this.id ?? undefined, name: PIECES[this.markKind], rect: this.box });
	}
}
