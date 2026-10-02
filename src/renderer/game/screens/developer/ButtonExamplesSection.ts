import { DeveloperSectionPanel, DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';

const WIDTH = 120;
const HEIGHT = 40;

/**
 * The focus-ring demo, focused as it mounts, so the first frame a scene or a
 * capture sees already has the ring (DDB-222). Focused as a press would, then
 * shown as a keyboard activation shows it (R9.23): keyboard focus reveals its
 * target (R12.20), which would scroll the developer screen to this section.
 * A press elsewhere takes the ring away.
 */
class FocusRingDemoButton extends Button {
	protected onMount(): void {
		const focus = this.context?.focus;
		if (focus?.focus(this, 'pointer')) focus.showFocusVisible();
		// After the focus, so the look snaps to the ring instead of fading in.
		super.onMount();
	}
}

/**
 * Buttons by tone, with style overrides, by size, and with R11.11's state
 * flags held on, each counting its clicks into the line above them.
 */
export class ButtonExamplesSection extends DeveloperSectionPanel {
	private clickCounter = 0;
	private readonly clickCountText: Text;

	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_buttons', title: 'Button Examples', ...options });

		this.clickCountText = new Text('Button clicks: 0', { style: { fontSize: 16, color: '#ffcc00' } });

		// Tones (R11.10): accent, the neutral default, ok, crit
		const tones = [
			new Button('Primary', { tone: 'accent', width: WIDTH, height: HEIGHT }),
			new Button('Secondary', { width: WIDTH, height: HEIGHT }),
			new Button('Success', { tone: 'ok', width: WIDTH, height: HEIGHT }),
			new Button('Danger', { tone: 'crit', width: WIDTH, height: HEIGHT }),
		];

		const overrides = [
			// Style overrides on top of a tone (R11.15): the radius from a token
			new Button('Rounded', { tone: 'data', width: WIDTH, height: HEIGHT, style: { borderRadius: 'r_pill' } }),
			// A transparent fill still takes the hover wash and pressed nudge
			new Button('Outlined', { width: WIDTH, height: HEIGHT, style: { backgroundColor: 'transparent', borderColor: 'data', color: 'data' } }),
			// Sizes set height, label, and icon together (R11.10)
			new Button('Small', { size: 'sm', width: 80 }),
			new Button('Large Button', { tone: 'accent', size: 'lg', width: 150 }),
		];

		// R11.11's flags held on, so the gallery shows the state layers
		const disabled = new Button('Disabled', { tone: 'accent', width: WIDTH, height: HEIGHT });
		disabled.enabled = false;
		const selected = new Button('Selected', { width: WIDTH, height: HEIGHT });
		selected.selected = true;
		const active = new Button('Active', { width: WIDTH, height: HEIGHT });
		active.active = true;
		// Keyboard focus: the ring sits outside the box, independent of the
		// rest. Focused through the real focus path on mount, not by hand.
		const focused = new FocusRingDemoButton('Focus ring', { tone: 'accent', width: WIDTH, height: HEIGHT });

		const column = new Stack({ gap: 20, padding: { left: 20 } });
		column.addChild(this.clickCountText);
		for (const buttons of [tones, overrides, [disabled, selected, active, focused]]) {
			const row = new Stack({ direction: 'horizontal', gap: 10, crossAlign: 'center' });
			for (const button of buttons) {
				button.onClick = () => this.incrementCounter();
				row.addChild(button);
			}
			column.addChild(row);
		}
		this.addChild(column);
	}

	private incrementCounter(): void {
		this.clickCounter++;
		this.clickCountText.text = `Button clicks: ${this.clickCounter}`;
	}
}
