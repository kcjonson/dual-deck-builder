import { Text } from '../../renderer/engine/components/Text';
import { tokens } from '../../renderer/engine/theme/tokens';
import { Button } from '../../renderer/engine/ui/Button';
import { Dialog } from '../../renderer/engine/ui/Dialog';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import type { SceneFactoryOptions } from '../registry';

const CONTENT_HEIGHT = 140;

/**
 * R12.21's modal dialog, open over the scene: the scrim, the popped panel
 * with its kicker, title, and X, a wrapped body, and a footer of actions,
 * the destructive one last. The dialog opens from the scene's first
 * `onLayout`; the harness settles its entrance, so the golden is the fully
 * open frame. The trigger reopens it on a live page.
 *
 * Gallery only: it opens an overlay root over whatever hosts it.
 */
export class DialogScene extends DeveloperSectionPanel {
	private readonly dialog: Dialog;
	private opened = false;

	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_dialog', title: 'Dialog', contentHeight: CONTENT_HEIGHT, x, y, width });

		this.addChild(new Text('Modal: a scrim that takes every press, a focus scope, Escape and the X close it, a stray click does not.', {
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));
		const trigger = new Button('Abandon run', { id: 'dialog_trigger', y: 84, width: 160, tone: 'crit' });
		this.addChild(trigger);

		const cancel = new Button('Keep driving', { id: 'dialog_cancel', width: 140 });
		const abandon = new Button('Abandon run', { id: 'dialog_abandon', width: 140, tone: 'crit' });
		this.dialog = new Dialog({
			id: 'dialog_abandon_run',
			kicker: 'Run in progress',
			title: 'Abandon run?',
			size: 'sm',
			content: new Text('Both drivers leave the road and the run ends here. Scrap and fuel carried are lost; unlocks already earned are kept.', {
				id: 'dialog_message',
				style: { fontSize: tokens.fontSize.fs_base, color: rgba(tokens.color.text) },
			}),
			footer: [cancel, abandon],
			initialFocus: cancel,
		});
		cancel.onClick = () => this.dialog.close();
		abandon.onClick = () => this.dialog.close();
		trigger.onClick = () => this.openDialog();

		this.onLayout = () => {
			if (this.opened) return;
			this.opened = true;
			this.openDialog();
		};
	}

	protected onUnmount(): void {
		this.dialog.overlay?.close();
	}

	private openDialog(): void {
		if (this.context) this.dialog.show(this.context);
	}
}
