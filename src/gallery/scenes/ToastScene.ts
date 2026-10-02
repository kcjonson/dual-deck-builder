import { Text } from '../../renderer/engine/components/Text';
import { tokens } from '../../renderer/engine/theme/tokens';
import { Button } from '../../renderer/engine/ui/Button';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { ToastOptions, ToastStack } from '../../renderer/engine/ui/Toast';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import type { SceneFactoryOptions } from '../registry';

const CONTENT_HEIGHT = 140;

/** Persistent, so a live page keeps the picture the golden holds. */
const SAMPLES: readonly ToastOptions[] = [
	{ id: 'toast_info', title: 'Scavenged parts', message: 'Two wrenches and a fuel can added to the trunk.', severity: 'info', autoDismiss: 0 },
	{ id: 'toast_warning', title: 'Fuel low', message: 'The lead vehicle has two turns of fuel left.', severity: 'warning', autoDismiss: 0 },
	{ id: 'toast_critical', title: 'Hull breached', message: 'The Rammer takes double damage until it is repaired.', severity: 'critical', autoDismiss: 0 },
];

/**
 * R12.23's toasts: one of each severity in a stack anchored to the
 * viewport's top-right corner, the newest (critical) nearest it. The button
 * pushes another, which past the stack's capacity dismisses the oldest.
 *
 * Gallery only: the stack is an overlay root over whatever hosts it.
 */
export class ToastScene extends DeveloperSectionPanel {
	private readonly stack = new ToastStack({ id: 'toast_stack', corner: 'topRight', capacity: 4 });
	private pushed = 0;

	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_toasts', title: 'Toasts', contentHeight: CONTENT_HEIGHT, x, y, width });

		this.addChild(new Text({
			text: 'Info, warning, and critical in a corner stack; hover pauses the countdown, the X or a click dismisses.',
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));
		const more = new Button({ label: 'Push a toast', id: 'toasts_push', y: 84, width: 160 });
		more.onClick = () => {
			this.pushed += 1;
			this.stack.push({ title: `Toast ${this.pushed}`, message: 'Dismisses itself after five seconds.', severity: 'info' });
		};
		this.addChild(more);

		for (const sample of SAMPLES) this.stack.push(sample);
		// Attached once the scene is mounted and laid out, as the other
		// overlay scenes open theirs (R8.21).
		this.onLayout = () => {
			if (this.context) this.stack.attach(this.context);
		};
	}

	protected onUnmount(): void {
		this.stack.detach();
	}
}
