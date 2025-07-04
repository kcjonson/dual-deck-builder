import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Renderer } from '../../../engine/rendering/Renderer';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Driver } from '../../mechanics/Driver';
import { DriverLoader } from '../../core/DriverLoader';
import { DriverPanel } from './DriverPanel';
import { SynergyPreviewPanel } from './SynergyPreviewPanel';

/**
 * Driver Selection Screen implementing Game Flow Spec section 1.2
 * Sequential driver selection with synergy preview
 */
export class DriverSelectionScreen extends Screen {
	private selectedDriver1: Driver | null = null;
	private selectedDriver2: Driver | null = null;
	private availableDrivers: Driver[] = [];
	
	// UI components
	private leftDriverPanel!: DriverPanel;
	private rightDriverPanel!: DriverPanel;
	private synergyPanel!: SynergyPreviewPanel;
	
	// Control elements
	private titleText!: Text;
	private confirmationText: Text | null = null;
	private startRunButton!: Button;
	private backButton!: Button;
	

	/**
	 * Create a new driver selection screen
	 */
	constructor(renderer: Renderer) {
		super('driverSelectionScreen', renderer);
		
		this.createBackground();
		this.createTitle();
		this.createDriverPanels();
		this.createSynergyPanel();
		this.createControls();
		this.createConfirmationArea();
		this.loadDrivers();
	}

	/**
	 * Create the background
	 */
	private createBackground(): void {
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
			style: {
				backgroundColor: '#2a2a4a', // Darker than main menu
			},
		});
		this.rootLayer.addChild(background);
	}

	/**
	 * Create the title
	 */
	private createTitle(): void {
		this.titleText = new Text('Choose Your Drivers', {
			style: {
				fontSize: 48,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		this.titleText.setPosition(
			window.innerWidth / 2,
			window.innerHeight * 0.08
		);
		this.rootLayer.addChild(this.titleText);
	}

	/**
	 * Create the driver selection panels
	 */
	private createDriverPanels(): void {
		const screenWidth = window.innerWidth;
		const screenHeight = window.innerHeight;
		const panelWidth = Math.floor(screenWidth * 0.35); // 35% each as per spec
		const panelHeight = Math.floor(screenHeight * 0.6); // 60% of screen height
		const panelY = Math.floor(screenHeight * 0.2); // Start below title
		
		// Left panel - First driver selection
		this.leftDriverPanel = new DriverPanel('left', {
			x: Math.floor(screenWidth * 0.05), // 5% margin
			y: panelY,
			width: panelWidth,
			height: panelHeight,
		});
		this.leftDriverPanel.setOnDriverChanged((driver) => {
			this.selectedDriver1 = driver;
			this.onDriver1Changed();
		});
		this.rootLayer.addChild(this.leftDriverPanel);
		
		// Right panel - Second driver selection (initially empty)
		this.rightDriverPanel = new DriverPanel('right', {
			x: Math.floor(screenWidth * 0.6), // Position on right side
			y: panelY,
			width: panelWidth,
			height: panelHeight,
		});
		this.rightDriverPanel.setOnDriverChanged((driver) => {
			this.selectedDriver2 = driver;
			this.onDriver2Changed();
		});
		this.rootLayer.addChild(this.rightDriverPanel);
	}

	/**
	 * Create the synergy preview panel
	 */
	private createSynergyPanel(): void {
		const screenWidth = window.innerWidth;
		const screenHeight = window.innerHeight;
		const synergyPanelWidth = Math.floor(screenWidth * 0.25); // 25% for synergy panel
		const synergyPanelHeight = Math.floor(screenHeight * 0.2); // 20% of screen height
		const panelY = Math.floor(screenHeight * 0.55); // Below driver panels
		
		this.synergyPanel = new SynergyPreviewPanel({
			x: Math.floor(screenWidth * 0.375), // Center between panels
			y: panelY,
			width: synergyPanelWidth,
			height: synergyPanelHeight,
		});
		this.rootLayer.addChild(this.synergyPanel);
	}

	/**
	 * Create control buttons
	 */
	private createControls(): void {
		const screenWidth = window.innerWidth;
		const screenHeight = window.innerHeight;
		
		// Back button
		this.backButton = new Button('← Back to Menu', {
			width: 200,
			height: 50,
			style: {
				fontSize: 18,
			},
		});
		this.backButton.setPosition(30, 30);
		this.backButton.onClick(() => {
			ScreenManager.navigate('mainMenuScreen');
		});
		this.rootLayer.addChild(this.backButton);
		
		// Start Run button (disabled initially)
		this.startRunButton = new Button('START RUN', {
			width: 300,
			height: 60,
			style: {
				fontSize: 24,
			},
		});
		this.startRunButton.setPosition(
			Math.floor(screenWidth / 2 - 150), 
			Math.floor(screenHeight * 0.85)
		);
		this.startRunButton.setEnabled(false);
		this.startRunButton.setFillColor('#666666'); // Grayed out initially
		this.startRunButton.onClick(() => {
			if (this.selectedDriver1 && this.selectedDriver2) {
				// Navigate to combat with driver data
				const combatData = {
					drivers: [this.selectedDriver1, this.selectedDriver2]
				};
				ScreenManager.navigate('combatScreen', combatData);
			}
		});
		this.rootLayer.addChild(this.startRunButton);
	}

	/**
	 * Create confirmation area
	 */
	private createConfirmationArea(): void {
		// This will be updated when both drivers are selected
		this.updateConfirmationText();
	}

	/**
	 * Load available drivers and initialize panels
	 */
	private async loadDrivers(): Promise<void> {
		try {
			const driverLoader = DriverLoader.getInstance();
			await driverLoader.loadDrivers();
			
			this.availableDrivers = driverLoader.getUnlockedDrivers();
			
			if (this.availableDrivers.length > 0) {
				// Set up left panel with available drivers
				this.leftDriverPanel.setAvailableDrivers(this.availableDrivers);
				this.leftDriverPanel.activate();
				
				// Right panel gets drivers but stays empty until first driver selected
				this.rightDriverPanel.setAvailableDrivers(this.availableDrivers);
				// Don't activate right panel yet - per spec
			}
			
		} catch (error) {
			console.error('Failed to load drivers:', error);
		}
	}

	/**
	 * Handle first driver selection change
	 */
	private onDriver1Changed(): void {
		// When first driver is selected, activate the second panel
		if (this.selectedDriver1 && this.rightDriverPanel.getIsEmpty()) {
			this.rightDriverPanel.activate();
		}
		
		this.updateSynergyDisplay();
		this.updateConfirmationText();
		this.updateStartButton();
	}

	/**
	 * Handle second driver selection change
	 */
	private onDriver2Changed(): void {
		this.updateSynergyDisplay();
		this.updateConfirmationText();
		this.updateStartButton();
	}

	/**
	 * Update synergy display panel
	 */
	private updateSynergyDisplay(): void {
		this.synergyPanel.updateSynergy(this.selectedDriver1, this.selectedDriver2);
	}

	/**
	 * Update confirmation text
	 */
	private updateConfirmationText(): void {
		// Remove existing confirmation text
		if (this.confirmationText) {
			this.rootLayer.removeChild(this.confirmationText);
			this.confirmationText = null;
		}
		
		// Show confirmation text only when both drivers are selected
		if (this.selectedDriver1 && this.selectedDriver2) {
			const confirmationMessage = `Ready to enter the wasteland with ${this.selectedDriver1.metadata.name} and ${this.selectedDriver2.metadata.name}`;
			
			this.confirmationText = new Text(confirmationMessage, {
				style: {
					fontSize: 16,
					color: '#cccccc',
					textAlign: 'center',
				},
			});
			this.confirmationText.setPosition(
				Math.floor(window.innerWidth / 2),
				Math.floor(window.innerHeight * 0.8) // Just above start button
			);
			this.rootLayer.addChild(this.confirmationText);
		}
	}

	/**
	 * Update start button state
	 */
	private updateStartButton(): void {
		const canStart = !!(this.selectedDriver1 && this.selectedDriver2);
		this.startRunButton.setEnabled(canStart);
		
		if (canStart) {
			this.startRunButton.setFillColor('#4a8a4a'); // Green when enabled
		} else {
			this.startRunButton.setFillColor('#666666'); // Gray when disabled
		}
	}


	/**
	 * Get the selected drivers
	 */
	public getSelectedDrivers(): { driver1: Driver | null; driver2: Driver | null } {
		return {
			driver1: this.selectedDriver1,
			driver2: this.selectedDriver2,
		};
	}

	/**
	 * Handle window resize
	 */
	protected onResized(): void {
		// Clear and recreate layout with new dimensions
		const children = [...this.rootLayer.getChildren()];
		children.forEach(child => this.rootLayer.removeChild(child));
		
		this.createBackground();
		this.createTitle();
		this.createDriverPanels();
		this.createSynergyPanel();
		this.createControls();
		this.createConfirmationArea();
		
		// Restore state
		if (this.availableDrivers.length > 0) {
			this.leftDriverPanel.setAvailableDrivers(this.availableDrivers);
			this.rightDriverPanel.setAvailableDrivers(this.availableDrivers);
			
			if (this.selectedDriver1) {
				this.leftDriverPanel.activate();
				this.rightDriverPanel.activate();
			}
		}
		
		this.updateSynergyDisplay();
		this.updateConfirmationText();
		this.updateStartButton();
	}

	/**
	 * Handle screen unmount - reset state
	 */
	protected onUnmount(): void {
		// Reset driver selections
		this.selectedDriver1 = null;
		this.selectedDriver2 = null;
		
		// Reset both panels to initial state
		this.leftDriverPanel.reset();
		this.rightDriverPanel.reset();
		
		// Clear synergy display
		this.synergyPanel.updateSynergy(null, null);
		
		// Reset UI elements
		this.updateConfirmationText();
		this.updateStartButton();
	}

	/**
	 * Handle screen mount - reload drivers
	 */
	protected onMount(): void {
		// Reload drivers when screen is mounted
		this.loadDrivers();
	}
}