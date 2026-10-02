import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { Scrollbar } from '../../../engine/ui/Scrollbar';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';

type Rgba = [number, number, number, number];

const CAPTION_GAP = 6;
const VIEW_HEIGHT = 200;
const ROW_PITCH = 28;
/** The range the standalone scrollbar is bound to: a hand four times the width it is shown at. */
const STRIP_VIEW = 260;
const STRIP_EXTENT = STRIP_VIEW * 4;

function rgba(token: keyof typeof tokens.color): Rgba {
	return [...tokens.color[token]] as Rgba;
}

/** A row of a list: a label on a band, alternating wells so the scroll reads. */
function listRow(index: number): Component {
	const row = new Stack({
		height: ROW_PITCH,
		widthMode: 'fill',
		direction: 'horizontal',
		crossAlign: 'center',
		padding: { left: 8 },
		style: { backgroundColor: index % 2 === 0 ? 'bg_panel' : 'bg_inset' },
	});
	row.addChild(new Text(`Salvage lot ${index + 1}`, { style: { fontSize: tokens.fontSize.fs_base, color: rgba('text') } }));
	return row;
}

function list(count: number): Stack {
	const stack = new Stack({ id: 'dev_scroll_rows' });
	for (let index = 0; index < count; index++) stack.addChild(listRow(index));
	return stack;
}

/**
 * R12.20 and R12.37: a list that overflows, with its scrollbar; the same
 * list scrolled part way by code, which the thumb shows; nested scrollers,
 * whose wheel latching keeps a gesture in the inner one at its end; and a
 * standalone horizontal scrollbar bound to a range it does not own, as a
 * hand or a map would bind it, with the offset it asks for read out.
 */
export class ScrollExamplesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_scrolling', title: 'Scrolling', ...options });

		// The four views wrap at the section's width
		const gap = tokens.space.space_8;
		const line = new FlowWrap({ id: 'dev_scroll_line', widthMode: 'fill', gap, rowGap: gap });

		const plain = new ScrollContainer({ id: 'dev_scroll_list', width: 220, height: VIEW_HEIGHT, style: { borderWidth: 1, borderColor: 'line_edge' } });
		plain.addChild(list(20));
		line.addChild(this.cell('a list that overflows', plain));

		// Given its height, the scroll position holds before the first layout.
		const scrolled = new ScrollContainer({ id: 'dev_scroll_middle', width: 220, height: VIEW_HEIGHT, contentHeight: ROW_PITCH * 20, style: { borderWidth: 1, borderColor: 'line_edge' } });
		scrolled.addChild(list(20));
		scrolled.scrollTo(ROW_PITCH * 3);
		line.addChild(this.cell('scrolled to lot 4 by code', scrolled));

		const outer = new ScrollContainer({ id: 'dev_scroll_outer', width: 240, height: VIEW_HEIGHT, style: { borderWidth: 1, borderColor: 'line_edge', padding: 8 } });
		const outerColumn = new Stack({ gap: 8 });
		outerColumn.addChild(new Text('Outer: wheel here scrolls the page of lots.', { widthMode: 'fill', style: { fontSize: tokens.fontSize.fs_sm, color: rgba('text_dim') } }));
		const inner = new ScrollContainer({ id: 'dev_scroll_inner', width: 200, height: 120, style: { borderWidth: 1, borderColor: 'accent_dim' } });
		inner.addChild(list(8));
		outerColumn.addChild(inner);
		for (let index = 0; index < 6; index++) outerColumn.addChild(listRow(20 + index));
		outer.addChild(outerColumn);
		line.addChild(this.cell('nested: the inner one latches (R9.32)', outer));

		line.addChild(this.cell('a standalone horizontal scrollbar (R12.37)', this.strip()));
		this.addChild(line);
	}

	private cell(text: string, view: Component): Stack {
		const cell = new Stack({ gap: CAPTION_GAP });
		cell.addChild(new Text(text, { style: { fontSize: 13, color: rgba('text_dim') } }));
		cell.addChild(view);
		return cell;
	}

	/**
	 * The scrollbar holds no scroll state: its owner applies the offset it
	 * asks for and hands the range back, here into a readout.
	 */
	private strip(): Stack {
		const column = new Stack({ gap: tokens.space.space_2 });
		const readout = new Text('offset 390 of 780', { id: 'dev_strip_offset', style: { fontSize: tokens.fontSize.fs_sm, fontRole: 'mono', color: rgba('text') } });
		const bar = new Scrollbar({ id: 'dev_strip_bar', orientation: 'horizontal', width: STRIP_VIEW, range: { offset: 390, extent: STRIP_EXTENT, viewport: STRIP_VIEW } });
		bar.onScroll = (offset) => {
			bar.range = { offset, extent: STRIP_EXTENT, viewport: STRIP_VIEW };
			readout.text = `offset ${Math.round(offset)} of ${STRIP_EXTENT - STRIP_VIEW}`;
		};
		column.addChild(bar);
		column.addChild(readout);
		return column;
	}
}
