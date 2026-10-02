import { Panel } from '../../../engine/ui/Panel';
import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';

/**
 * A panel inside the section's panel, with its own styled frame and its
 * own column of content: a heading over a shape and a button. It takes the
 * section's width up to 600.
 */
export class NestedPanelsSection extends DeveloperSectionPanel {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_nested_panels', title: 'Panel Examples', ...options });

		const nested = new Panel({
			id: 'dev_nested_panel',
			widthMode: 'fill',
			maxSize: { width: 600 },
			gap: 12,
			style: {
				backgroundColor: '#333333e6',
				borderRadius: 8,
				borderWidth: 2,
				borderColor: '#555555',
				padding: 12,
			},
		});
		nested.addChild(new Text('Nested Panel Content', { style: { fontSize: 20, color: 'text_bright' } }));
		const row = new Stack({ direction: 'horizontal', gap: 20, crossAlign: 'center' });
		row.addChild(new Rectangle({ width: 60, height: 60, style: { backgroundColor: '#ff4080', borderRadius: 30 } }));
		row.addChild(new Button('Nested Button', { width: 120, height: 35 }));
		nested.addChild(row);

		const column = new Stack({ padding: { left: 20, right: 20 }, widthMode: 'fill' });
		column.addChild(nested);
		this.addChild(column);
	}
}
