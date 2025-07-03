import { Screen } from '../../core/Screen';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { BattleState } from '../../mechanics/Battle';
import { Style } from '../../../engine/types/Style';

/**
 * Data passed to the battle result screen
 */
export interface BattleResultData {
	victory: boolean;
	battleState: BattleState;
	// TODO: Add more stats like salvage earned, drivers leveled up, etc.
}

/**
 * Screen displayed after battle ends
 */
export class BattleResultScreen extends Screen {
	private resultData: BattleResultData | null = null;
	private continueButton!: Button;
	private titleText!: Text;
	private subtitleText!: Text;
	private background!: Rectangle;
	private panel!: Rectangle;
	private onContinue: (() => void) | null = null;
	
	// UI constants
	private readonly PANEL_WIDTH = 600;
	private readonly PANEL_HEIGHT = 400;
	
	constructor(renderer: Renderer) {
		super('battleResultScreen', renderer);
		this.createUI();
		this.layoutUI();
	}
	
	/**
	 * Create the UI elements (without positioning)
	 */
	private createUI(): void {
		// Background
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: 100, // Will be set by layoutUI
			height: 100,
			style: {
				backgroundColor: '#1a1a1a',
			},
		});
		this.rootLayer.addChild(this.background);
		
		// Center panel
		this.panel = new Rectangle({
			x: 0,
			y: 0,
			width: this.PANEL_WIDTH,
			height: this.PANEL_HEIGHT,
			style: {
				backgroundColor: '#2a2a3a',
				borderColor: '#4a4a5a',
				borderWidth: 3,
			},
		});
		this.rootLayer.addChild(this.panel);
		
		// Title (will be updated based on victory/defeat)
		const titleStyle: Style = {
			fontSize: 48,
			color: '#ffffff',
			textAlign: 'center',
			fontWeight: 'bold',
		};
		
		this.titleText = new Text('', {
			style: titleStyle,
		});
		this.rootLayer.addChild(this.titleText);
		
		// Subtitle
		const subtitleStyle: Style = {
			fontSize: 20,
			color: '#aaaaaa',
			textAlign: 'center',
		};
		
		this.subtitleText = new Text('', {
			style: subtitleStyle,
		});
		this.rootLayer.addChild(this.subtitleText);
		
		// TODO: Add battle statistics display
		// - Turns taken
		// - Damage dealt/received
		// - Cards played
		// - Salvage earned (for victory)
		
		// Continue button
		this.continueButton = new Button('Continue', {
			x: 0,
			y: 0,
			width: 200,
			height: 50,
			style: {
				backgroundColor: '#4a4a5a',
				borderColor: '#6a6a7a',
				borderWidth: 2,
			},
		});
		
		this.continueButton.onClick(() => {
			if (this.onContinue) {
				this.onContinue();
			}
		});
		
		this.rootLayer.addChild(this.continueButton);
	}
	
	/**
	 * Layout all UI elements based on current screen size
	 */
	private layoutUI(): void {
		const screenWidth = this.rootLayer.getWidth();
		const screenHeight = this.rootLayer.getHeight();
		
		// Update background size
		this.background.setSize(screenWidth, screenHeight);
		
		// Center panel
		const panelX = Math.floor((screenWidth - this.PANEL_WIDTH) / 2);
		const panelY = Math.floor((screenHeight - this.PANEL_HEIGHT) / 2);
		this.panel.setPosition(panelX, panelY);
		
		// Title position (relative to panel)
		this.titleText.setPosition(panelX + this.PANEL_WIDTH / 2, panelY + 80);
		
		// Subtitle position (relative to panel)
		this.subtitleText.setPosition(panelX + this.PANEL_WIDTH / 2, panelY + 140);
		
		// Continue button position (centered horizontally, near bottom of panel)
		this.continueButton.setPosition(
			panelX + (this.PANEL_WIDTH - 200) / 2,
			panelY + this.PANEL_HEIGHT - 100
		);
	}
	
	/**
	 * Set the continue callback
	 */
	public setOnContinue(callback: () => void): void {
		this.onContinue = callback;
	}
	
	/**
	 * Handle screen mount with data
	 */
	protected onMount(data?: unknown): void {
		if (data && typeof data === 'object' && 'victory' in data) {
			this.resultData = data as BattleResultData;
			this.updateUI();
		} else {
			console.error('BattleResultScreen: Invalid or missing data');
		}
	}
	
	/**
	 * Update UI based on result data
	 */
	private updateUI(): void {
		if (!this.resultData) return;
		
		// Update title
		this.titleText.setText(this.resultData.victory ? 'VICTORY!' : 'DEFEAT!');
		this.titleText.setColor(this.resultData.victory ? '#6aca6a' : '#ca6a6a');
		
		// Update subtitle
		this.subtitleText.setText(
			this.resultData.victory 
				? 'All enemies have been defeated!' 
				: 'Your vehicles have been destroyed!'
		);
		
		// Update panel border color
		this.panel.setBorderColor(this.resultData.victory ? '#4a8a4a' : '#8a4a4a');
		
		// TODO: Display battle statistics from battleState
		// const { turn, playerTeam, enemyTeam } = this.resultData.battleState;
	}
	
	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		this.layoutUI();
	}
}