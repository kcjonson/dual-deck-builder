import type { Component } from '../../renderer/engine/components/Component';
import { Container } from '../../renderer/engine/components/Container';
import { Stack } from '../../renderer/engine/components/Stack';
import { Text } from '../../renderer/engine/components/Text';
import { tokens } from '../../renderer/engine/theme/tokens';
import { ScrollContainer } from '../../renderer/engine/ui/ScrollContainer';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import type { SceneFactoryOptions } from '../registry';

const CAPTION_Y = 84;
const VIEW_Y = 110;
const CELL_WIDTH = 160;
const CELL_GAP = tokens.space.space_4;
const COLUMN_HEIGHT = 240;
const BAND_HEIGHT = 32;
const ROW_PITCH = 28;
/** The bound the two scrollers outside a stack are held to. */
const LIMIT = 140;
const CONTENT_HEIGHT = VIEW_Y + COLUMN_HEIGHT;

const SCROLL_STYLE = { borderWidth: 1, borderColor: 'line_edge' } as const;

function row(index: number): Component {
	const made = new Stack({
		height: ROW_PITCH,
		widthMode: 'fill',
		direction: 'horizontal',
		crossAlign: 'center',
		padding: { left: 8 },
		style: { backgroundColor: index % 2 === 0 ? 'bg_panel' : 'bg_panel_raised' },
	});
	made.addChild(new Text({ text: `Salvage lot ${index + 1}`, style: { fontSize: tokens.fontSize.fs_base, color: rgba(tokens.color.text) } }));
	return made;
}

function list(id: string, count: number): Stack {
	const stack = new Stack({ id });
	for (let index = 0; index < count; index++) stack.addChild(row(index));
	return stack;
}

/** A header or footer band in a column, so the scroller's share of it reads. */
function band(label: string): Component {
	const made = new Stack({
		height: BAND_HEIGHT,
		widthMode: 'fill',
		direction: 'horizontal',
		crossAlign: 'center',
		padding: { left: 8 },
		style: { backgroundColor: 'bg_void' },
	});
	made.addChild(new Text({ text: label, style: { fontSize: tokens.fontSize.fs_sm, color: rgba(tokens.color.text_dim) } }));
	return made;
}

/**
 * R12.20's hug height, R10.17's scroller that is only as tall as its
 * content needs. In a column with room it takes its rows and does not
 * scroll; in a short column it gives way to the room left between the
 * header and the footer and scrolls the rest. Outside a stack it sizes
 * itself, within `maxSize` (where it scrolls) and `minSize` (where it
 * leaves room below its rows).
 *
 * Gallery only: no developer section shows a hugging scroller.
 */
export class ScrollHugScene extends DeveloperSectionPanel {
	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_scroll_hug', title: 'Hug-height scrolling', contentHeight: CONTENT_HEIGHT, x, y, width });

		this.addChild(new Text({
			text: 'heightMode hug: as tall as the content, shrinking to the room a column has and scrolling past it.',
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));

		this.addCell(0, 'a column with room', this.column('scroll_hug_roomy', 3));
		this.addCell(1, 'a short column: it scrolls', this.column('scroll_hug_short', 12));

		// A plain container sizes nothing, so these two size themselves.
		const loose = new Container({ id: 'scroll_hug_loose', x: (CELL_WIDTH + CELL_GAP) * 2, y: VIEW_Y, width: CELL_WIDTH * 2 + CELL_GAP, height: COLUMN_HEIGHT });
		const capped = new ScrollContainer({ id: 'scroll_hug_capped', width: CELL_WIDTH, heightMode: 'hug', maxSize: { height: LIMIT }, style: SCROLL_STYLE });
		capped.addChild(list('scroll_hug_capped_rows', 12));
		const floored = new ScrollContainer({ id: 'scroll_hug_floored', x: CELL_WIDTH + CELL_GAP, width: CELL_WIDTH, heightMode: 'hug', minSize: { height: LIMIT }, style: SCROLL_STYLE });
		floored.addChild(list('scroll_hug_floored_rows', 2));
		loose.addChild(capped);
		loose.addChild(floored);
		this.addChild(loose);
		this.addCaption(2, `outside a stack, max ${LIMIT}`);
		this.addCaption(3, `outside a stack, min ${LIMIT}`);
	}

	/** A fixed column: a header, the hugging scroller over `rows` rows, a footer. */
	private column(id: string, rows: number): Stack {
		const column = new Stack({ id, width: CELL_WIDTH, height: COLUMN_HEIGHT, crossAlign: 'stretch', style: { backgroundColor: 'bg_inset' } });
		column.addChild(band('Header'));
		const scroll = new ScrollContainer({ id: `${id}_scroll`, widthMode: 'fill', heightMode: 'hug', minSize: { height: ROW_PITCH * 2 }, style: SCROLL_STYLE });
		scroll.addChild(list(`${id}_rows`, rows));
		column.addChild(scroll);
		column.addChild(band('Footer'));
		return column;
	}

	private addCell(index: number, caption: string, view: Component): void {
		this.addCaption(index, caption);
		view.setPosition((CELL_WIDTH + CELL_GAP) * index, VIEW_Y);
		this.addChild(view);
	}

	private addCaption(index: number, caption: string): void {
		this.addChild(new Text({ text: caption, x: (CELL_WIDTH + CELL_GAP) * index, y: CAPTION_Y, style: { fontSize: 13, color: rgba(tokens.color.text_dim) } }));
	}
}
