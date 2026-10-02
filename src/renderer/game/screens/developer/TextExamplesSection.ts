import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';

const LABEL_COLOR = '#888888';

/**
 * Text styling: sizes, colours, alignment in a box, word wrap against a
 * single line with an ellipsis, a wrapped ellipsis, and line heights.
 */
export class TextExamplesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_text', title: 'Text Examples', ...options });

		const column = new Stack({ gap: 10, padding: { left: 20, right: 20 }, widthMode: 'fill' });

		const sizes = new Stack({ gap: 10 });
		for (const size of [12, 16, 20, 24, 32]) {
			sizes.addChild(new Text(`Size ${size}px: The quick brown fox`, { style: { fontSize: size, color: 'text_bright' } }));
		}
		column.addChild(sizes);

		// Hex colours on purpose: the samples show the parser's forms
		const colours = new Stack({ gap: 6 });
		for (const [text, color] of [
			['Colored text examples', '#ff6600'],
			['Success message style', '#00cc66'],
			['Warning message style', '#ffcc00'],
			['Error message style', '#ff3333'],
		]) {
			colours.addChild(new Text(text, { style: { fontSize: 18, color } }));
		}
		column.addChild(colours);

		// Alignment resolves against the text's own box, so each sample is a
		// third of the row, and the row is the column's width
		const alignment = new Stack({ direction: 'horizontal', widthMode: 'fill' });
		for (const [text, textAlign] of [
			['Left aligned (default)', 'left'],
			['Center aligned', 'center'],
			['Right aligned', 'right'],
		] as const) {
			alignment.addChild(new Text(text, { widthMode: 'fill', style: { fontSize: 16, color: 'text_bright', textAlign } }));
		}
		column.addChild(labelled('Text Alignment:', alignment));

		column.addChild(labelled('Text Wrapping:', row(40, [
			new Text('This is a long text that should wrap automatically when it exceeds the specified width. It demonstrates the normal text wrapping behavior.', {
				width: 300,
				height: 80,
				style: { fontSize: 14, color: 'text_bright' },
				lineHeight: 1.4,
				wrap: 'word',
			}),
			new Text('This text should not wrap even if it is very long and exceeds the container width because whiteSpace is set to nowrap.', {
				width: 300,
				height: 80,
				style: { fontSize: 14, color: '#ffcc00' },
				wrap: 'none',
				textOverflow: 'ellipsis',
			}),
		])));

		column.addChild(row(30, [
			new Text('This is a demonstration of text overflow with ellipsis. When the text is too long to fit in the specified height, it will be truncated with ellipsis (...) to indicate there is more content.', {
				width: 250,
				height: 40,
				style: { fontSize: 14, color: '#00cc66' },
				lineHeight: 1.2,
				textOverflow: 'ellipsis',
			}),
			new Text('Line height 1.0: This text has tight line spacing which makes it more compact but potentially harder to read.', {
				width: 200,
				height: 60,
				style: { fontSize: 12, color: '#ff6600' },
				lineHeight: 1.0,
			}),
			new Text('Line height 1.8: This text has generous line spacing which makes it easier to read but takes more space.', {
				width: 200,
				height: 80,
				style: { fontSize: 12, color: '#0088ff' },
				lineHeight: 1.8,
			}),
		]));

		this.addChild(column);
	}
}

/** A dim label over `content`, which takes the column's width. */
function labelled(label: string, content: Component): Stack {
	const group = new Stack({ gap: 8, widthMode: 'fill' });
	group.addChild(new Text(label, { style: { fontSize: 16, color: LABEL_COLOR } }));
	group.addChild(content);
	return group;
}

function row(gap: number, children: Component[]): Stack {
	const line = new Stack({ direction: 'horizontal', gap });
	for (const child of children) line.addChild(child);
	return line;
}
