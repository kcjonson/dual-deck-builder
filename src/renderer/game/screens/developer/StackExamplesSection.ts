import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { FlowWrap } from '../../ui/FlowWrap';
import { ComponentOptions } from '../../../engine/components/Component';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { AnchorName, Distribution } from '../../../engine/components/layoutTypes';
import { ColorToken, tokens } from '../../../engine/theme/tokens';

type Rgba = [number, number, number, number];

const CELL_WIDTH = 200;
const CELL_GAP = 24;
const ROW_GAP = 24;
const CAPTION_GAP = 6;
const PAD = 8;

const DISTRIBUTIONS: readonly Distribution[] = ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'];
const ANCHORS: readonly AnchorName[] = ['topLeft', 'top', 'topRight', 'left', 'right', 'bottomLeft', 'bottom', 'bottomRight'];

function rgba(token: ColorToken): Rgba {
	return [...tokens.color[token]] as Rgba;
}

function swatch(token: ColorToken, options: ComponentOptions): Rectangle {
	return new Rectangle({ ...options, style: { backgroundColor: rgba(token), borderRadius: 3 } });
}

/**
 * The layout fixture R13.31 asks for: every sizing mode, distribution, and
 * cross alignment of chapter 10's stack container, plus alignSelf, a
 * negative gap, the clamps, aspectRatio, a wrapping text, weighted bands, and
 * absolute children placed by anchor. The section itself is laid out by
 * stacks: rows of captioned cells that wrap at the section's width, each
 * cell a column of a caption and a demo box with its own stack inside.
 */
export class StackExamplesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_stack', title: 'Stacks', ...options });

		const content = new Stack({ id: 'dev_stack_rows', gap: ROW_GAP, widthMode: 'fill' });
		const rows: { name: string; cells: Stack[] }[] = [
			{
				name: 'distribution',
				cells: DISTRIBUTIONS.map((distribution) => this.cell(distribution, this.distributionBox(distribution))),
			},
			{
				name: 'align',
				cells: [
					...(['start', 'center', 'end', 'stretch'] as const).map((crossAlign) => this.cell(
						`crossAlign ${crossAlign}`,
						this.alignBox(crossAlign),
					)),
					this.cell('alignSelf center in stretch', this.alignSelfBox()),
					this.cell('gap -16', this.negativeGapBox()),
				],
			},
			{
				name: 'sizing',
				cells: [
					this.cell('fixed, hug, fill', this.modesBox()),
					this.cell('fill weights 25 / 40 / 35', this.weightsBox()),
					this.cell('maxSize 40 on a fill', this.maxSizeBox()),
					this.cell('aspectRatio 1 and 2', this.aspectBox()),
					this.cell('hug text wraps at the column', this.wrapBox()),
					this.cell('nested hug rows, stretched', this.nestedBox()),
				],
			},
			{
				name: 'absolute',
				cells: [
					this.cell('absolute: anchor and pivot', this.anchoredBox(), CELL_WIDTH * 2 + CELL_GAP),
					this.cell('bands 25 / 40 / 20 / 5', this.bandsBox()),
					this.cell('pinned corner badge', this.badgeBox()),
				],
			},
		];

		// Each row of cells wraps at the section's width, a line per row of
		// cells where they all fit
		for (const { name, cells } of rows) {
			const row = new FlowWrap({ id: `dev_stack_row_${name}`, widthMode: 'fill', gap: CELL_GAP, rowGap: ROW_GAP });
			cells.forEach((cell) => row.addChild(cell));
			content.addChild(row);
		}
		this.addChild(content);
	}

	/** A caption over a demo box, both hugging a column of the box's width. */
	private cell(caption: string, demo: Stack, width = CELL_WIDTH): Stack {
		const cell = new Stack({ gap: CAPTION_GAP });
		cell.addChild(new Text(caption, { style: { fontSize: 13, color: rgba('text_dim') } }));
		demo.setWidth(width);
		cell.addChild(demo);
		return cell;
	}

	/** A demo box: a fixed-size stack on the inset surface. */
	private demo(height: number, options: StackOptions): Stack {
		return new Stack({ width: CELL_WIDTH, height, padding: PAD, style: { backgroundColor: 'bg_inset' }, ...options });
	}

	private distributionBox(distribution: Distribution): Stack {
		const box = this.demo(56, { direction: 'horizontal', distribution, crossAlign: 'center', gap: 6 });
		for (const token of ['accent', 'data', 'status_ok'] as const) box.addChild(swatch(token, { width: 24, height: 24 }));
		return box;
	}

	private alignBox(crossAlign: 'start' | 'center' | 'end' | 'stretch'): Stack {
		const box = this.demo(72, { direction: 'horizontal', crossAlign, gap: 8 });
		// Hug heights, so stretch has something to stretch; the others keep their size.
		[16, 32, 48].forEach((height, index) => {
			box.addChild(swatch(index === 1 ? 'data' : 'accent', { width: 32, height, heightMode: 'hug' }));
		});
		return box;
	}

	private alignSelfBox(): Stack {
		const box = this.demo(72, { direction: 'horizontal', crossAlign: 'stretch', gap: 8 });
		box.addChild(swatch('accent', { width: 32, height: 16, heightMode: 'hug' }));
		box.addChild(swatch('data', { width: 32, height: 16, alignSelf: 'center' }));
		box.addChild(swatch('accent', { width: 32, height: 16, heightMode: 'hug' }));
		return box;
	}

	private negativeGapBox(): Stack {
		const box = this.demo(72, { direction: 'horizontal', gap: -16, distribution: 'center', crossAlign: 'center' });
		const tokensInOrder: ColorToken[] = ['accent', 'data', 'status_ok', 'status_crit', 'accent_bright'];
		tokensInOrder.forEach((token) => {
			const card = new Rectangle({
				width: 40,
				height: 52,
				style: { backgroundColor: rgba(token), borderColor: rgba('bg_void'), borderWidth: 2, borderRadius: 4 },
			});
			box.addChild(card);
		});
		return box;
	}

	private modesBox(): Stack {
		const box = this.demo(72, { direction: 'horizontal', crossAlign: 'center', gap: 8 });
		box.addChild(swatch('accent', { width: 32, height: 32 }));
		box.addChild(new Text('hug', { style: { fontSize: 13, color: rgba('text') } }));
		box.addChild(swatch('data', { height: 32, widthMode: 'fill' }));
		return box;
	}

	private weightsBox(): Stack {
		const box = this.demo(72, { direction: 'horizontal', crossAlign: 'stretch', gap: 4 });
		const bands: [ColorToken, number][] = [['accent', 25], ['data', 40], ['status_ok', 35]];
		for (const [token, fillWeight] of bands) box.addChild(swatch(token, { widthMode: 'fill', heightMode: 'hug', fillWeight }));
		return box;
	}

	private maxSizeBox(): Stack {
		const box = this.demo(72, { direction: 'horizontal', crossAlign: 'stretch', gap: 4 });
		box.addChild(swatch('accent', { widthMode: 'fill', heightMode: 'hug', maxSize: { width: 40 } }));
		box.addChild(swatch('data', { widthMode: 'fill', heightMode: 'hug' }));
		return box;
	}

	private aspectBox(): Stack {
		const box = this.demo(72, { direction: 'horizontal', crossAlign: 'stretch', gap: 8 });
		box.addChild(swatch('accent', { widthMode: 'hug', heightMode: 'hug', aspectRatio: 1 }));
		box.addChild(swatch('data', { widthMode: 'hug', heightMode: 'hug', aspectRatio: 2 }));
		return box;
	}

	private wrapBox(): Stack {
		const box = this.demo(72, {});
		box.addChild(new Text('A hug text shrinks to fit and wraps where the column ends.', {
			style: { fontSize: 13, color: rgba('text') },
		}));
		return box;
	}

	private nestedBox(): Stack {
		const box = this.demo(72, { crossAlign: 'stretch', gap: 6 });
		for (const tokensInRow of [['accent', 'data'], ['status_ok', 'accent', 'data']] as ColorToken[][]) {
			const row = new Stack({ direction: 'horizontal', gap: 6, padding: 3, style: { backgroundColor: 'bg_panel_raised' } });
			tokensInRow.forEach((token) => row.addChild(swatch(token, { width: 18, height: 18 })));
			box.addChild(row);
		}
		return box;
	}

	private anchoredBox(): Stack {
		const box = this.demo(96, {});
		for (const anchor of ANCHORS) {
			box.addChild(swatch('accent', { width: 14, height: 14, positioned: 'absolute', anchor }));
		}
		box.addChild(new Text('center', {
			positioned: 'absolute',
			anchor: 'center',
			style: { fontSize: 13, color: rgba('text') },
		}));
		return box;
	}

	private bandsBox(): Stack {
		const box = this.demo(96, { crossAlign: 'stretch', padding: 0 });
		const bands: [ColorToken, number][] = [['data_dim', 25], ['bg_panel_raised', 40], ['accent_dim', 20], ['accent', 5]];
		for (const [token, fillWeight] of bands) box.addChild(swatch(token, { heightMode: 'fill', widthMode: 'hug', fillWeight }));
		return box;
	}

	private badgeBox(): Stack {
		const box = this.demo(96, { gap: 6 });
		box.addChild(new Text('Scout', { style: { fontSize: 13, color: rgba('text') } }));
		box.addChild(swatch('data', { width: 64, height: 12 }));
		box.addChild(swatch('status_crit', { width: 18, height: 18, positioned: 'absolute', anchor: 'topRight' }));
		return box;
	}
}
