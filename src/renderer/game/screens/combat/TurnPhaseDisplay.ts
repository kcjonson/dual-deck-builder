import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

export enum CombatPhase {
	PLAYER_TURN = 'PLAYER_TURN',
	ENEMY_TURN = 'ENEMY_TURN',
	COMBAT_START = 'COMBAT_START',
	COMBAT_END = 'COMBAT_END'
}

const PHASE_TEXT: Readonly<Record<CombatPhase, string>> = {
	[CombatPhase.PLAYER_TURN]: 'PLAYER TURN',
	[CombatPhase.ENEMY_TURN]: 'ENEMY TURN',
	[CombatPhase.COMBAT_START]: 'COMBAT START',
	[CombatPhase.COMBAT_END]: 'COMBAT END',
};

const PHASE_COLOR: Readonly<Record<CombatPhase, string>> = {
	[CombatPhase.PLAYER_TURN]: '#88ff88',
	[CombatPhase.ENEMY_TURN]: '#ff8888',
	[CombatPhase.COMBAT_START]: '#ffff88',
	[CombatPhase.COMBAT_END]: '#8888ff',
};

const PHASE_BACKGROUND: Readonly<Record<CombatPhase, string>> = {
	[CombatPhase.PLAYER_TURN]: '#2a3a2a',
	[CombatPhase.ENEMY_TURN]: '#3a2a2a',
	[CombatPhase.COMBAT_START]: '#2a2a3a',
	[CombatPhase.COMBAT_END]: '#2a2a3a',
};

export const TURN_BANNER_WIDTH = 200;
export const TURN_BANNER_HEIGHT = 40;

/**
 * The turn banner over the road: which phase the fight is in. The turn
 * number is on the top bar and above END TURN.
 */
export class TurnPhaseDisplay extends Layer {
	private readonly background: Rectangle;
	private readonly phaseText: Text;
	private currentPhase = CombatPhase.COMBAT_START;

	constructor(options: LayerOptions = {}) {
		super({ width: TURN_BANNER_WIDTH, height: TURN_BANNER_HEIGHT, pointerEvents: 'none', ...options });

		this.background = new Rectangle({
			width: TURN_BANNER_WIDTH,
			height: TURN_BANNER_HEIGHT,
			style: {
				backgroundColor: PHASE_BACKGROUND[this.currentPhase],
				borderColor: '#4a4a5a',
				borderWidth: 2,
				borderRadius: 8,
			},
		});
		this.addChild(this.background);

		// The box is the banner's, so the phase centres in it
		this.phaseText = new Text(PHASE_TEXT[this.currentPhase], {
			id: 'turn_phase',
			width: TURN_BANNER_WIDTH,
			height: TURN_BANNER_HEIGHT,
			style: {
				fontSize: 20,
				color: PHASE_COLOR[this.currentPhase],
				textAlign: 'center',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
			},
		});
		this.addChild(this.phaseText);
	}

	get phase(): CombatPhase {
		return this.currentPhase;
	}

	set phase(value: CombatPhase) {
		this.currentPhase = value;
		this.phaseText.setText(PHASE_TEXT[value]);
		this.phaseText.setColor(PHASE_COLOR[value]);
		this.background.setFillColor(PHASE_BACKGROUND[value]);
	}
}
