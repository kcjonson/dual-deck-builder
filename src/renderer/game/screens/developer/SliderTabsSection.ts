import { CatalogSection } from './CatalogSection';
import { Stack } from '../../../engine/components/Stack';
import { tokens } from '../../../engine/theme/tokens';
import { SegmentedControl } from '../../../engine/ui/SegmentedControl';
import { Slider } from '../../../engine/ui/Slider';
import { TabBar } from '../../../engine/ui/TabBar';

const { control, space } = tokens;

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * R12.15 to R12.17: sliders continuous, stepped with a label and value,
 * logarithmic with a detent, and disabled; tab bars uncontrolled (a disabled
 * tab among them) and controlled; segmented controls in the accent and data
 * tones, at a fixed segment width, and disabled.
 */
export class SliderTabsSection extends CatalogSection {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_slider_tabs', title: 'Sliders, Tabs, and Segments', x, y, width });

		const sliders = new Stack({ gap: space.space_2 });
		sliders.addChild(new Slider({ id: 'dev_slider_plain', value: 0.35, width: 320 }));
		sliders.addChild(new Slider({ id: 'dev_slider_volume', label: 'Volume', value: 0.7, step: 0.05, valueFormatter: percent, width: 420 }));
		sliders.addChild(new Slider({
			id: 'dev_slider_log',
			label: 'Speed',
			min: 0.25,
			max: 16,
			logScale: true,
			value: 1,
			detent: 1 / 3,
			valueFormatter: (value) => `${value.toFixed(2)}x`,
			width: 420,
		}));
		sliders.addChild(new Slider({ id: 'dev_slider_disabled', label: 'Locked', value: 0.5, valueFormatter: percent, disabled: true, width: 420 }));
		this.addRow('slider: continuous; stepped with label and value; log scale with a detent at 1x; disabled', sliders, control.control_h_md * 4 + space.space_2 * 3);

		const bars = new Stack({ gap: space.space_4 });
		bars.addChild(new TabBar({
			id: 'dev_tabs',
			tabs: [
				{ id: 'garage', label: 'Garage' },
				{ id: 'deck', label: 'Deck' },
				{ id: 'map', label: 'Map', disabled: true },
				{ id: 'crew', label: 'Crew' },
			],
		}));
		bars.addChild(new TabBar({
			id: 'dev_tabs_controlled',
			size: 'sm',
			selectedId: 'log',
			tabs: [
				{ id: 'stats', label: 'Stats' },
				{ id: 'log', label: 'Log' },
				{ id: 'loot', label: 'Loot' },
			],
		}));
		this.addRow('tab bar: first enabled tab selected, a disabled tab; controlled, small', bars, control.control_h_md + control.control_h_sm + space.space_4);

		this.addRow('segmented: accent; data tone; fixed segment width; disabled', this.line([
			new SegmentedControl({
				id: 'dev_segments',
				options: [
					{ label: 'Easy', value: 'easy' },
					{ label: 'Normal', value: 'normal' },
					{ label: 'Hard', value: 'hard' },
				],
				selected: 'normal',
			}),
			new SegmentedControl({
				id: 'dev_segments_data',
				tone: 'data',
				options: [
					{ label: 'Day', value: 'day' },
					{ label: 'Night', value: 'night' },
				],
				selected: 'night',
			}),
			new SegmentedControl({
				id: 'dev_segments_fixed',
				segmentWidth: 64,
				size: 'sm',
				options: [
					{ label: '1x', value: 1 },
					{ label: '2x', value: 2 },
					{ label: '4x', value: 4, disabled: true },
				],
				selected: 2,
			}),
			new SegmentedControl({
				id: 'dev_segments_disabled',
				disabled: true,
				options: [
					{ label: 'On', value: 'on' },
					{ label: 'Off', value: 'off' },
				],
				selected: 'on',
			}),
		]), control.control_h_md + space.space_0_5 * 2);
	}
}
