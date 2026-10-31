import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { BoxStyleObject, Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';

const SIZE = 80;

/** Hex colours on purpose: the section shows the style parser's forms. */
const LOOKS: readonly BoxStyleObject[] = [
	{ backgroundColor: '#3366ff' },
	{ backgroundColor: '#ff6600', borderRadius: 15 },
	{ backgroundColor: '#00cc66', borderWidth: 4, borderColor: '#ffffff', borderRadius: 8 },
	{ backgroundColor: '#ff333380', borderRadius: 20, borderWidth: 2, borderColor: '#ff3333' },
	// A circle, from a radius of half the size
	{ backgroundColor: '#33ccff', borderRadius: 40, borderWidth: 3, borderColor: '#0099ff' },
];

/**
 * Rectangle styling: plain, rounded, bordered, translucent, and a circle
 * from its radius, in a row.
 */
export class RectangleExamplesSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_rectangles', title: 'Rectangle Examples', ...options });

		const row = new Stack({ direction: 'horizontal', gap: 10, padding: { left: 20 } });
		for (const style of LOOKS) row.addChild(new Rectangle({ width: SIZE, height: SIZE, style }));
		this.addChild(row);
	}
}
