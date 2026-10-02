import type { Component } from '../../renderer/engine/components/Component';
import { Rectangle } from '../../renderer/engine/components/Rectangle';
import { Stack } from '../../renderer/engine/components/Stack';
import { Text } from '../../renderer/engine/components/Text';
import type { DrawApi, RGBA } from '../../renderer/engine/draw';
import { tokens } from '../../renderer/engine/theme/tokens';
import { Panel } from '../../renderer/engine/ui/Panel';
import { ScrollContainer } from '../../renderer/engine/ui/ScrollContainer';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import { DrawFixture, fixtureLabel } from '../../renderer/game/screens/developer/DrawFixture';
import type { SceneFactoryOptions } from '../registry';

const CAPTION_Y = 84;
const VIEW_Y = 110;
const CELL_WIDTH = 200;
const CELL_HEIGHT = 160;
const CELL_GAP = tokens.space.space_6;
const ROW_PITCH = 24;
const CONTENT_HEIGHT = VIEW_Y + CELL_HEIGHT;

const RADIUS = tokens.radius.r_xl;
const BORDER = tokens.borderWidth.bw_thick;
const FILL: RGBA = [0.85, 0.3, 0.35, 1];
const SECOND: RGBA = [0.3, 0.6, 0.9, 1];
const WHITE: RGBA = [1, 1, 1, 1];

function row(index: number): Component {
	const made = new Stack({
		height: ROW_PITCH,
		widthMode: 'fill',
		direction: 'horizontal',
		crossAlign: 'center',
		padding: { left: 8 },
		style: { backgroundColor: index % 2 === 0 ? 'accent_dim' : 'bg_panel_raised' },
	});
	made.addChild(new Text(`Salvage lot ${index + 1}`, { style: { fontSize: tokens.fontSize.fs_sm, color: rgba(tokens.color.text) } }));
	return made;
}

function rows(id: string, count: number): Stack {
	const stack = new Stack({ id });
	for (let index = 0; index < count; index++) stack.addChild(row(index));
	return stack;
}

/**
 * R4.14's rounded clip through the component contract (DDB-231): a
 * clipping panel whose flush child fills all four corners, so the content
 * meets the border's inner arc; a bordered, rounded scroller scrolled so
 * rows pass under its corners; a rounded scroller inside a rounded clipping
 * panel but clear of its corners, which nests exactly and must not warn;
 * and two sort domains split by `flush()` that each bring a new rounded
 * clip, so the second draws from a fresh uniform slot holding the whole
 * table (R5.27, R15.15).
 *
 * Gallery only: the flush is a barrier no developer section needs.
 */
export class RoundedClipScene extends DeveloperSectionPanel {
	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_rounded_clip', x, y, width });

		this.addChild(new Text('Rounded clips on components', { style: { fontSize: 28, color: '#ffffff', fontWeight: 'bold' } }));
		this.addChild(new Text('clipRadius: the clip at the border\'s inner edge, its corner concentric with the background\'s.', {
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));

		const filled = new Panel({
			id: 'rounded_clip_panel',
			width: CELL_WIDTH,
			height: CELL_HEIGHT,
			layout: 'free',
			flush: true,
			overflow: 'hidden',
			style: { borderRadius: RADIUS, borderWidth: BORDER, borderColor: 'accent' },
		});
		filled.addChild(new Rectangle({
			id: 'rounded_clip_panel_fill',
			width: CELL_WIDTH - BORDER * 2,
			height: CELL_HEIGHT - BORDER * 2,
			style: { backgroundColor: FILL },
		}));
		this.addCell(0, 'clipping panel, flush fill', filled);

		const scroller = new ScrollContainer({
			id: 'rounded_clip_scroll',
			width: CELL_WIDTH,
			height: CELL_HEIGHT,
			contentHeight: ROW_PITCH * 16,
			style: { borderRadius: RADIUS, borderWidth: BORDER, borderColor: 'accent', backgroundColor: 'bg_inset' },
		});
		scroller.addChild(rows('rounded_clip_scroll_rows', 16));
		this.addCell(1, 'rounded scroller, scrolled', scroller);
		// A fraction of a row, so rows straddle both top corners.
		scroller.scrollTo(ROW_PITCH * 3 + 9);

		const outer = new Panel({
			id: 'rounded_clip_outer',
			width: CELL_WIDTH,
			height: CELL_HEIGHT,
			layout: 'free',
			overflow: 'hidden',
			style: { borderRadius: RADIUS, borderWidth: BORDER, borderColor: 'line_edge', padding: RADIUS + BORDER },
		});
		const inner = new ScrollContainer({
			id: 'rounded_clip_inner',
			width: CELL_WIDTH - (RADIUS + BORDER) * 2,
			height: CELL_HEIGHT - (RADIUS + BORDER) * 2,
			style: { borderRadius: tokens.radius.r_lg, borderWidth: BORDER, borderColor: 'accent' },
		});
		inner.addChild(rows('rounded_clip_inner_rows', 8));
		outer.addChild(inner);
		this.addCell(2, 'nested, clear of the corners', outer);

		this.addCell(3, 'two domains, two tables', new DrawFixture({
			id: 'rounded_clip_domains',
			x: 0,
			y: 0,
			width: CELL_WIDTH,
			height: CELL_HEIGHT,
			paint: paintDomains,
		}));

		this.fitContentHeight(CONTENT_HEIGHT);
	}

	private addCell(index: number, caption: string, view: Component): void {
		const left = (CELL_WIDTH + CELL_GAP) * index;
		this.addChild(new Text(caption, { x: left, y: CAPTION_Y, style: { fontSize: 13, color: rgba(tokens.color.text_dim) } }));
		view.setPosition(left, VIEW_Y);
		this.addChild(view);
	}
}

/**
 * The first rounded clip is drawn and submitted, then a second, so the
 * backend has already issued a draw against the first table when the second
 * entry arrives and must move to a fresh slot rather than write the bound one.
 */
function paintDomains(draw: DrawApi): void {
	const half = CELL_HEIGHT / 2 - 4;
	const first = { x: 0, y: 0, width: CELL_WIDTH, height: half };
	draw.pushClipRounded(first, RADIUS);
	draw.drawRect({ rect: first, fill: FILL });
	fixtureLabel(draw, { text: 'first domain', box: first, color: WHITE });
	draw.popClip();
	draw.flush();
	const second = { x: 0, y: CELL_HEIGHT - half, width: CELL_WIDTH, height: half };
	draw.pushClipRounded(second, RADIUS * 2);
	draw.drawRect({ rect: second, fill: SECOND });
	fixtureLabel(draw, { text: 'second domain', box: second, color: WHITE });
	draw.popClip();
}
