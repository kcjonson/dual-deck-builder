import { Layer } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';

export enum CombatPhase {
	PLAYER_TURN = 'PLAYER_TURN',
	ENEMY_TURN = 'ENEMY_TURN',
	COMBAT_START = 'COMBAT_START',
	COMBAT_END = 'COMBAT_END'
}

/**
 * Display for current turn and phase information
 */
export class TurnPhaseDisplay extends Layer {
	private turnText: Text | null = null;
	private phaseText: Text | null = null;
	private activeDriverText: Text | null = null;
	private background: Rectangle | null = null;
	
	// Current state
	private _turn = 1;
	private _phase = CombatPhase.COMBAT_START;
	private _activeDriver: string | null = null;
	
	constructor(options: { x: number; y: number; width: number; height: number }) {
		super(options);
		this.createElements();
	}
	
	/**
	 * Get current turn number
	 */
	get turn(): number {
		return this._turn;
	}
	
	/**
	 * Set turn number
	 */
	set turn(value: number) {
		this._turn = value;
		if (this.turnText) {
			this.turnText.setText(`Turn ${value}`);
		}
	}
	
	/**
	 * Get current phase
	 */
	get phase(): CombatPhase {
		return this._phase;
	}
	
	/**
	 * Set current phase
	 */
	set phase(value: CombatPhase) {
		this._phase = value;
		if (this.phaseText) {
			this.phaseText.setText(this.getPhaseText());
			this.phaseText.setColor(this.getPhaseColor());
		}
		
		// Update background color based on phase
		if (this.background) {
			const bgColor = value === CombatPhase.PLAYER_TURN ? '#2a3a2a' : 
			               value === CombatPhase.ENEMY_TURN ? '#3a2a2a' : '#2a2a3a';
			this.background.setFillColor(bgColor);
		}
		
		// Hide active driver text if not player turn
		if (this.activeDriverText) {
			this.activeDriverText.setVisible(value === CombatPhase.PLAYER_TURN);
		}
	}
	
	/**
	 * Get active driver name
	 */
	get activeDriver(): string | null {
		return this._activeDriver;
	}
	
	/**
	 * Set active driver (shown during player turn)
	 */
	set activeDriver(value: string | null) {
		this._activeDriver = value;
		if (this.activeDriverText && value) {
			this.activeDriverText.setText(`Active: ${value}`);
		}
	}
	
	/**
	 * Create display elements
	 */
	private createElements(): void {
		const width = this.getWidth();
		const height = this.getHeight();
		
		// Background panel
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: width,
			height: height,
			style: {
				backgroundColor: '#2a2a3a',
				borderColor: '#4a4a5a',
				borderWidth: 2,
				borderRadius: 8,
			},
		});
		this.addChild(this.background);
		
		// Turn counter
		this.turnText = new Text(`Turn ${this._turn}`, {
			x: 0,
			y: 0,
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center'
			},
		});
		this.turnText.setPosition(width / 2, height * 0.25);
		this.addChild(this.turnText);
		
		// Phase indicator
		this.phaseText = new Text(this.getPhaseText(), {
			x: 0,
			y: 0,
			style: {
				fontSize: 20,
				color: this.getPhaseColor(),
				textAlign: 'center'
			},
		});
		this.phaseText.setPosition(width / 2, height * 0.5);
		this.addChild(this.phaseText);
		
		// Active driver indicator (only shown during player turn)
		this.activeDriverText = new Text('', {
			x: 0,
			y: 0,
			style: {
				fontSize: 14,
				color: '#cccccc',
				textAlign: 'center'
			},
		});
		this.activeDriverText.setPosition(width / 2, height * 0.75);
		this.addChild(this.activeDriverText);
	}
	
	/**
	 * Get display text for phase
	 */
	private getPhaseText(): string {
		switch (this._phase) {
			case CombatPhase.PLAYER_TURN:
				return 'PLAYER TURN';
			case CombatPhase.ENEMY_TURN:
				return 'ENEMY TURN';
			case CombatPhase.COMBAT_START:
				return 'COMBAT START';
			case CombatPhase.COMBAT_END:
				return 'COMBAT END';
			default:
				return '';
		}
	}
	
	/**
	 * Get color for phase text
	 */
	private getPhaseColor(): string {
		switch (this._phase) {
			case CombatPhase.PLAYER_TURN:
				return '#88ff88';
			case CombatPhase.ENEMY_TURN:
				return '#ff8888';
			case CombatPhase.COMBAT_START:
				return '#ffff88';
			case CombatPhase.COMBAT_END:
				return '#8888ff';
			default:
				return '#ffffff';
		}
	}
	
	/**
	 * Update all display elements at once
	 */
	public updateDisplay(turn: number, phase: CombatPhase, activeDriver?: string | null): void {
		this.turn = turn;
		this.phase = phase;
		if (activeDriver !== undefined) {
			this.activeDriver = activeDriver;
		}
	}
}