import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver } from '../../mechanics/DriverPair';
import { DriverLoader } from '../../core/DriverLoader';
import { DriverPanel } from './DriverPanel';
import { SynergyPreviewPanel } from './SynergyPreviewPanel';

/** Space between the synergy panel and each driver panel. */
const SYNERGY_MARGIN = 10;

/**
 * Driver Selection Screen implementing Game Flow Spec section 1.2
 * Sequential driver selection with synergy preview
 */
export class DriverSelectionScreen extends Screen {
	private selectedDriver1: Driver | null = null;
	private selectedDriver2: Driver | null = null;
	private availableDrivers: Driver[] = [];
	
	// UI components
	private background!: Rectangle;
	private leftDriverPanel!: DriverPanel;
	private rightDriverPanel!: DriverPanel;
	private synergyPanel!: SynergyPreviewPanel;
	
	// Control elements
	private titleText!: Text;
	private confirmationText!: Text;
	private startRunButton!: Button;
	private backButton!: Button;
	

	/**
	 * Create a new driver selection screen. Its elements are built once;
	 * placeElements sizes and places them from the root on mount and on
	 * every resize, so a resize keeps the selection.
	 */
	constructor() {
		super('driverSelectionScreen');

		this.createBackground();
		this.createTitle();
		this.createDriverPanels();
		this.createSynergyPanel();
		this.createControls();
		this.createConfirmationArea();
	}

	/**
	 * Create the background
	 */
	private createBackground(): void {
		this.background = new Rectangle({
			style: {
				backgroundColor: '#2a2a4a', // Darker than main menu
			},
		});
		this.rootLayer.addChild(this.background);
	}

	/**
	 * Create the title
	 */
	private createTitle(): void {
		// Centred across the screen
		this.titleText = new Text('Choose Your Drivers', {
			id: 'driver_select_title',
			style: {
				fontSize: 48,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
		});
		this.rootLayer.addChild(this.titleText);
	}

	/**
	 * Create the driver selection panels
	 */
	private createDriverPanels(): void {
		// Left panel - First driver selection
		this.leftDriverPanel = new DriverPanel('left', {
			id: 'driver_select_panel_left',
		});
		this.leftDriverPanel.setOnDriverChanged((driver) => {
			this.selectedDriver1 = driver;
			this.rightDriverPanel.partnerDriver = driver;
			this.onDriver1Changed();
		});
		this.rootLayer.addChild(this.leftDriverPanel);

		// Right panel - Second driver selection (initially empty)
		this.rightDriverPanel = new DriverPanel('right', {
			id: 'driver_select_panel_right',
		});
		this.rightDriverPanel.setOnDriverChanged((driver) => {
			this.selectedDriver2 = driver;
			this.leftDriverPanel.partnerDriver = driver;
			this.onDriver2Changed();
		});
		this.rootLayer.addChild(this.rightDriverPanel);
	}

	/**
	 * Create the synergy preview panel
	 */
	private createSynergyPanel(): void {
		this.synergyPanel = new SynergyPreviewPanel({
			id: 'driver_select_synergy_panel',
		});
		this.rootLayer.addChild(this.synergyPanel);
	}

	/**
	 * Create control buttons
	 */
	private createControls(): void {

		// Back button
		this.backButton = new Button('Back to Menu', {
			id: 'driver_select_back_button',
			// Tab reaches it first, as it reads, though the panels are built
			// before it (R9.18: a positive tabIndex leads the order)
			tabIndex: 1,
			icon: 'arrow_back',
			size: 'lg',
			width: 200,
			height: 50,
		});
		this.backButton.setPosition(30, 30);
		this.backButton.onClick = () => {
			ScreenManager.navigate('mainMenuScreen');
		};
		this.rootLayer.addChild(this.backButton);
		
		// The primary action; disabled until two different drivers are picked,
		// which the accent tone draws as its neutral disabled look.
		this.startRunButton = new Button('START RUN', {
			id: 'driver_select_start_run_button',
			tone: 'accent',
			size: 'lg',
			width: 300,
			height: 60,
			style: {
				fontSize: 'fs_xl',
			},
		});
		this.startRunButton.setEnabled(false);
		this.startRunButton.onClick = () => {
			if (this.canStartRun && this.selectedDriver1 && this.selectedDriver2) {
				// Navigate to combat with driver data
				const combatData = {
					drivers: [this.selectedDriver1, this.selectedDriver2]
				};
				ScreenManager.navigate('combatScreen', combatData);
			}
		};
		this.rootLayer.addChild(this.startRunButton);
	}

	/**
	 * The confirmation line, centred across the screen just above the start
	 * button; shown once both drivers are selected
	 */
	private createConfirmationArea(): void {
		this.confirmationText = new Text('', {
			visible: false,
			style: {
				fontSize: 16,
				color: '#cccccc',
				textAlign: 'center',
			},
			wrap: 'none',
		});
		this.rootLayer.addChild(this.confirmationText);
	}

	/**
	 * Everything from the root's size, which is the viewport's: the panels
	 * take 35 percent of the width each with the synergy panel in the gap
	 * between them, and the title and controls sit above and below.
	 */
	private placeElements(): void {
		const screenWidth = this.rootLayer.width;
		const screenHeight = this.rootLayer.height;

		this.background.setSize(screenWidth, screenHeight);

		this.titleText.setPosition(0, screenHeight * 0.08);
		this.titleText.setWidth(screenWidth);

		const panelWidth = Math.floor(screenWidth * 0.35);
		const panelHeight = Math.floor(screenHeight * 0.6);
		const panelY = Math.floor(screenHeight * 0.2); // Start below title
		this.leftDriverPanel.setPosition(Math.floor(screenWidth * 0.05), panelY);
		this.leftDriverPanel.setSize(panelWidth, panelHeight);
		this.rightDriverPanel.setPosition(Math.floor(screenWidth * 0.6), panelY);
		this.rightDriverPanel.setSize(panelWidth, panelHeight);

		// The gap between the driver panels (40% to 60% of the width), less a
		// margin either side. It used to be 25% wide and overlap both panels,
		// and it is submitted after them, so it covered the ends of the left
		// panel's flavour text.
		const gapStart = Math.floor(screenWidth * 0.4);
		this.synergyPanel.setPosition(gapStart + SYNERGY_MARGIN, Math.floor(screenHeight * 0.55));
		this.synergyPanel.setSize(
			Math.floor(screenWidth * 0.6) - gapStart - SYNERGY_MARGIN * 2,
			Math.floor(screenHeight * 0.2),
		);

		this.startRunButton.setPosition(
			Math.floor(screenWidth / 2 - 150),
			Math.floor(screenHeight * 0.85),
		);

		this.confirmationText.setPosition(0, Math.floor(screenHeight * 0.8));
		this.confirmationText.setWidth(screenWidth);
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
				// Right panel gets drivers first but stays empty until the left
				// panel picks, which activates it on a different driver
				this.rightDriverPanel.setAvailableDrivers(this.availableDrivers);
				
				this.leftDriverPanel.setAvailableDrivers(this.availableDrivers);
				this.leftDriverPanel.activate();
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
	 * Show the confirmation line only when both drivers are selected
	 */
	private updateConfirmationText(): void {
		const first = this.selectedDriver1;
		const second = this.selectedDriver2;
		this.confirmationText.setVisible(first !== null && second !== null);
		if (first && second) {
			this.confirmationText.setText(`Ready to enter the wasteland with ${first.metadata.name} and ${second.metadata.name}`);
		}
	}

	/**
	 * Both slots are filled, with two different drivers
	 */
	private get canStartRun(): boolean {
		if (!this.selectedDriver1 || !this.selectedDriver2) return false;
		return !isSameDriver(this.selectedDriver1, this.selectedDriver2);
	}

	/**
	 * Update start button state
	 */
	private updateStartButton(): void {
		this.startRunButton.setEnabled(this.canStartRun);
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
	 * The viewport changed: the same elements move and resize, and the
	 * panels lay their contents out again in the layout phase (R8.18)
	 */
	protected onResized(): void {
		this.placeElements();
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
		this.placeElements();
		// Escape goes back, as the Back button does (R9.15's root table)
		this.rootLayer.hotkeys.register('Escape', () => ScreenManager.navigate('mainMenuScreen'));
		// Reload drivers when screen is mounted
		this.loadDrivers();
	}
}