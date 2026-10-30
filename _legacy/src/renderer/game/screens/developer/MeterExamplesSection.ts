import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Stack } from '../../../engine/components/Stack';
import { tokens } from '../../../engine/theme/tokens';
import { Counter } from '../../../engine/ui/Counter';
import { ProgressBar } from '../../../engine/ui/ProgressBar';

const BAR_WIDTH = 220;

/**
 * R12.24's meters and R12.39's counter: `auto` banding at critical, warning,
 * and ok; the explicit tones; the three track sizes; a labelled meter with
 * its value line; inline labels over the fill; a segmented fuel gauge; and
 * counters in the display and mono roles.
 */
export class MeterExamplesSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_meters', title: 'Meters and Counters', ...options });

		this.addRow('tone auto: 0.15, 0.40, 0.85', this.line([
			new ProgressBar({ id: 'dev_meter_crit', value: 0.15, width: BAR_WIDTH }),
			new ProgressBar({ id: 'dev_meter_warn', value: 0.4, width: BAR_WIDTH }),
			new ProgressBar({ id: 'dev_meter_ok', value: 0.85, width: BAR_WIDTH }),
		]));

		this.addRow('tones accent, data, default; sizes sm, md, lg', this.line([
			new ProgressBar({ value: 0.6, width: BAR_WIDTH, tone: 'accent', size: 'sm' }),
			new ProgressBar({ value: 0.6, width: BAR_WIDTH, tone: 'data', size: 'md' }),
			new ProgressBar({ value: 0.6, width: BAR_WIDTH, tone: 'default', size: 'lg' }),
		]));

		this.addRow('labelled, with a value line', this.line([
			new ProgressBar({ id: 'dev_meter_hull', label: 'Hull', valueText: (value) => `${Math.round(value * 24)} / 24`, value: 0.75, width: BAR_WIDTH }),
			new ProgressBar({ id: 'dev_meter_heat', label: 'Heat', valueText: (value) => `${Math.round(value * 100)}%`, value: 0.3, tone: 'crit', width: BAR_WIDTH }),
		]));

		this.addRow('inline and segmented', this.line([
			new ProgressBar({ id: 'dev_meter_inline', label: 'Shield', valueText: '9 / 12', value: 0.75, tone: 'data', inline: true, size: 'lg', width: BAR_WIDTH }),
			new ProgressBar({ id: 'dev_meter_fuel', label: 'Fuel', valueText: '3 / 8', value: 3 / 8, tone: 'accent', segmented: 8, width: BAR_WIDTH }),
		]));

		const counters = new Stack({ direction: 'horizontal', gap: tokens.space.space_8, crossAlign: 'end' });
		counters.addChild(new Counter({
			id: 'dev_counter_scrap',
			value: 1240,
			format: (value) => Math.round(value).toLocaleString('en-US'),
			style: { fontRole: 'display', fontSize: tokens.fontSize.fs_2xl, color: [...tokens.color.text_bright] as [number, number, number, number] },
		}));
		counters.addChild(new Counter({
			id: 'dev_counter_hp',
			value: 17,
			format: (value) => `${Math.round(value)} HP`,
			style: { fontRole: 'mono', fontSize: tokens.fontSize.fs_md, color: [...tokens.color.status_ok] as [number, number, number, number] },
		}));
		this.addRow('counters: display and mono', counters);
	}
}
