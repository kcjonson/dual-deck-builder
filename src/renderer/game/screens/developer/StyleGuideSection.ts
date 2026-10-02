import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';

const SWATCH = 60;
const PER_ROW = 4;

/** Hex colours on purpose: a palette of named swatches, not the theme's tokens. */
const COLORS: readonly { name: string; value: string }[] = [
	{ name: 'Primary', value: '#3366ff' },
	{ name: 'Secondary', value: '#ff6600' },
	{ name: 'Success', value: '#00cc66' },
	{ name: 'Warning', value: '#ffcc00' },
	{ name: 'Danger', value: '#ff3333' },
	{ name: 'Info', value: '#33ccff' },
	{ name: 'Dark', value: '#333333' },
	{ name: 'Light', value: '#f0f0f0' },
];

/** A colour palette: swatches four to a row, each named underneath. */
export class StyleGuideSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_style_guide', title: 'Style Guide', ...options });

		const column = new Stack({ gap: 10, padding: { left: 20 } });
		column.addChild(new Text('Color Palette:', { style: { fontSize: 20, color: 'text_bright' } }));
		const palette = new Stack({ gap: 10 });
		for (let start = 0; start < COLORS.length; start += PER_ROW) {
			const row = new Stack({ direction: 'horizontal', gap: 10 });
			for (const { name, value } of COLORS.slice(start, start + PER_ROW)) row.addChild(swatch(name, value));
			palette.addChild(row);
		}
		column.addChild(palette);
		this.addChild(column);
	}
}

function swatch(name: string, value: string): Stack {
	const cell = new Stack({ gap: 5 });
	cell.addChild(new Rectangle({
		width: SWATCH,
		height: SWATCH,
		style: { backgroundColor: value, borderRadius: 8, borderWidth: 2, borderColor: '#ffffff' },
	}));
	cell.addChild(new Text(name, { width: SWATCH, style: { fontSize: 12, color: 'text_bright', textAlign: 'center' }, wrap: 'none' }));
	return cell;
}
