import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ColorToken, tokens } from '../../../engine/theme/tokens';
import { POI_GLYPHS } from '../../ui/areaMap/areaMapStyle';
import { MapGlyph } from '../../ui/atlas/mapGlyphs';

/**
 * The parts the area map and run route screens share on the atlas sheet
 * (UI Art Direction, Screens: area map and run route; DDB-509): the
 * screen's title, the column of legend boxes beside the map, and the POI
 * head the selected box and the run route's destination box lead with.
 */

/** The column of legend boxes beside the map. */
export const SIDE_WIDTH = 360;
/** Between the map's plate and the column, and between the boxes down it. */
export const SHEET_GAP = 20;
export const COLUMN_GAP = 14;
/** The highway primary: its label sits at 24 px in the column, over the 18.66 px floor. */
export const PRIMARY_LABEL = 24;
export const PRIMARY_HEIGHT = 56;

const LINE_HEIGHT = tokens.fontSize.fs_sm * tokens.lineHeight.lh;
const HEAD_GLYPH = 24;
const HEAD_NAME = 22;
const HEAD_HEIGHT = 30;

/** The screen's title in display 700 spaced capitals (UI Art Direction, Type). */
export function screenTitle({ id, text }: { id: string; text: string }): Text {
	return new Text({
		id,
		text,
		style: { fontRole: 'display', fontWeight: 700, fontSize: 30, letterSpacing: 0.16, textTransform: 'uppercase', color: 'text' },
		wrap: 'none',
	});
}

/** The mono line beside a title: the day, the fuel, the light. */
export function titleNote({ id, text = '' }: { id: string; text?: string }): Text {
	return new Text({ id, text, style: { fontRole: 'mono', fontSize: 'fs_sm', color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' });
}

/** A body line that wraps to its column. */
export function caption({ id, text, color = 'text_dim' }: { id: string; text: string; color?: ColorToken }): Text {
	return new Text({ text, id, widthMode: 'fill', style: { fontSize: 'fs_sm', color } });
}

/** A line held at `lines` lines of caption, a longer one ending in an ellipsis, so the boxes above it never move. */
export function detailLine({ id, color = 'text_dim', lines = 1 }: { id: string; color?: ColorToken; lines?: number }): Text {
	return new Text({
		text: '',
		id,
		widthMode: 'fill',
		height: LINE_HEIGHT * lines,
		lineHeight: tokens.lineHeight.lh,
		wrap: lines === 1 ? 'none' : undefined,
		textOverflow: 'ellipsis',
		style: { fontSize: 'fs_sm', color },
	});
}

/** A POI's lead glyph: its type's letter in a circle, as the map marks it, or the stronghold diamond. */
export function poiLead({ type, stronghold }: { type: string; stronghold: boolean }): { glyph: string; diamond?: boolean } {
	return stronghold ? { glyph: '', diamond: true } : { glyph: POI_GLYPHS[type] ?? '' };
}

/**
 * A POI's name in display 700, led by its glyph as the map draws it: the
 * type's letter circled, or a stronghold's diamond. With no POI it shows
 * `empty` alone.
 */
export class PoiHead extends Stack {
	private readonly circled: MapGlyph;
	private readonly diamond: MapGlyph;
	private readonly name: Text;

	constructor({ id, empty = '' }: { id: string; empty?: string }) {
		super({ id: `${id}_head`, direction: 'horizontal', widthMode: 'fill', height: HEAD_HEIGHT, crossAlign: 'center', gap: 10 });
		this.circled = new MapGlyph({ id: `${id}_glyph`, kind: 'circled', size: HEAD_GLYPH, visible: false });
		this.diamond = new MapGlyph({ id: `${id}_diamond`, kind: 'diamond', size: HEAD_GLYPH, visible: false });
		this.name = new Text({
			id,
			text: empty,
			widthMode: 'fill',
			style: { fontRole: 'display', fontWeight: 700, fontSize: HEAD_NAME, color: 'text' },
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.circled);
		this.addChild(this.diamond);
		this.addChild(this.name);
	}

	public show(poi: { name: string; type: string; stronghold: boolean } | null, empty = ''): void {
		this.name.text = poi?.name ?? empty;
		this.circled.visible = poi !== null && !poi.stronghold;
		this.diamond.visible = poi !== null && poi.stronghold;
		if (poi && !poi.stronghold) this.circled.label = POI_GLYPHS[poi.type] ?? '';
	}
}
