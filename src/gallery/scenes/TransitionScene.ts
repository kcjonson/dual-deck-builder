import { Rectangle } from '../../renderer/engine/components/Rectangle';
import { Text } from '../../renderer/engine/components/Text';
import type { RGBA } from '../../renderer/engine/draw/geometry';
import { tokens } from '../../renderer/engine/theme/tokens';
import { Button } from '../../renderer/engine/ui/Button';
import { ScreenTransition } from '../../renderer/engine/ui/ScreenTransition';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import type { SceneFactoryOptions } from '../registry';

const CONTENT_HEIGHT = 260;
const STAGE_Y = 96;
const STAGE = { width: 480, height: 150 };

interface StageLook {
	title: string;
	fill: RGBA;
}

const STAGES: readonly StageLook[] = [
	{ title: 'Main menu', fill: tokens.color.bg_panel },
	{ title: 'Driver selection', fill: tokens.color.data_dim },
];

/**
 * R12.38's screen transition, as the scene manager will run it (DDB-90):
 * fade out, swap the stage, one layout, fade in, with every press blocked
 * in between. The scene runs one transition from its first layout; the
 * harness settles it, swap included, so the golden is the stage it lands on
 * with no quad left over. The button runs it again on a live page.
 *
 * Gallery only: the transition is an overlay root over whatever hosts it.
 */
export class TransitionScene extends DeveloperSectionPanel {
	private readonly transition = new ScreenTransition({ id: 'gallery_transition' });
	private stage: Rectangle;
	private stageIndex = 0;
	private started = false;

	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_transition', x, y, width });

		this.addChild(new Text('Screen transition', { style: { fontSize: 28, color: '#ffffff', fontWeight: 'bold' } }));
		this.addChild(new Text('Fade out, swap, lay out once, fade in; input is blocked until it has finished.', {
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));
		const replay = new Button('Run it again', { id: 'transition_replay', x: STAGE.width + tokens.space.space_6, y: STAGE_Y, width: 160 });
		replay.onClick = () => this.runTransition();
		this.addChild(replay);

		this.stage = this.buildStage(0);
		this.addChild(this.stage);

		this.onLayout = () => {
			if (this.started) return;
			this.started = true;
			this.runTransition();
		};

		this.fitContentHeight(CONTENT_HEIGHT);
	}

	protected onUnmount(): void {
		// Persistent through a scene change by design, so the gallery closes it itself.
		this.transition.overlay?.close();
	}

	private runTransition(): void {
		const context = this.context;
		if (!context) return;
		void this.transition.run(context, () => {
			this.stageIndex = (this.stageIndex + 1) % STAGES.length;
			const next = this.buildStage(this.stageIndex);
			this.removeChild(this.stage);
			this.stage = next;
			this.addChild(next);
		});
	}

	private buildStage(index: number): Rectangle {
		const look = STAGES[index];
		const stage = new Rectangle({
			id: 'transition_stage',
			y: STAGE_Y,
			width: STAGE.width,
			height: STAGE.height,
			style: { backgroundColor: rgba(look.fill), borderColor: rgba(tokens.color.line_edge), borderWidth: 1 },
		});
		stage.addChild(new Text(look.title, {
			id: 'transition_stage_title',
			x: tokens.space.space_4,
			y: tokens.space.space_4,
			style: { fontFamily: 'display', fontSize: tokens.fontSize.fs_xl, color: rgba(tokens.color.text_bright), textTransform: 'uppercase' },
		}));
		return stage;
	}
}
