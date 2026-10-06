import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Button } from '../../../engine/ui/Button';
import { Container } from '../../../engine/components/Container';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Driver } from '../../mechanics/Driver';
import { isSameDriver } from '../../mechanics/DriverPair';
import { DriverLoader } from '../../core/DriverLoader';
import { DriverPanel } from './DriverPanel';
import { SynergyPreviewPanel } from './SynergyPreviewPanel';
import { INSPECT_KEYS, inspectHotkey } from '../../ui/cardInspect';
import { contains } from '../../../engine/services/OverlayService';

const BACK_BUTTON_WIDTH = 200;
/** The driver panels' share of the body's width against the synergy column's. */
const PANEL_WEIGHT = 35;
const SYNERGY_WEIGHT = 18;
const START_RUN_WIDTH = 300;

/**
 * Driver Selection Screen implementing Game Flow Spec section 1.2
 * Sequential driver selection with synergy preview
 *
 * One page stack the viewport's size: a header row (Back, the title), the
 * body (the two driver panels with the synergy panel centred in the column
 * between them), and START RUN with its summary beside it. The panels take
 * whatever height the header and footer leave, so a resize sizes the page
 * and the stacks lay the rest out again; nothing is rebuilt. Escape and Back
 * return to the menu; the Escape is the root's own (R9.15), so an open
 * driver Select closes on it first.
 */
export class DriverSelectionScreen extends Screen {
	private selectedDriver1: Driver | null = null;
	private selectedDriver2: Driver | null = null;
	private availableDrivers: Driver[] = [];

	private page!: Stack;
	private leftDriverPanel!: DriverPanel;
	private rightDriverPanel!: DriverPanel;
	private synergyPanel!: SynergyPreviewPanel;
	private confirmationText!: Text;
	private startRunButton!: Button;
	/**
	 * A card preview of this screen was up as of the last frame. The tooltip
	 * service hears Escape before the hotkeys and has hidden the preview by
	 * the time the screen's Escape runs, so the screen has to remember it.
	 */
	private previewShown = false;

	constructor() {
		super('driverSelectionScreen');
	}

	/**
	 * Builds the page at the root's size and loads the roster. A resize only
	 * sizes the page again, so it keeps the selection.
	 */
	protected onMount(): void {
		this.page = new Stack({
			id: 'driver_select_page',
			direction: 'vertical',
			padding: { top: 24, bottom: 24, left: 48, right: 48 },
			gap: 16,
			crossAlign: 'stretch',
			style: { backgroundColor: '#2a2a4a' },
		});
		this.page.addChild(this.createHeader());
		this.page.addChild(this.createBody());
		this.page.addChild(this.createFooter());
		this.rootLayer.addChild(this.page);
		this.sizePage();

		this.rootLayer.hotkeys.register('Escape', () => this.escape());
		for (const key of INSPECT_KEYS) this.rootLayer.hotkeys.register(key, () => inspectHotkey(this.context));
		this.loadDrivers();
	}

	protected onUnmount(): void {
		for (const key of ['Escape', ...INSPECT_KEYS]) this.rootLayer.hotkeys.unregister(key);
		this.rootLayer.clearChildren();
		this.previewShown = false;
		this.selectedDriver1 = null;
		this.selectedDriver2 = null;
		this.availableDrivers = [];
	}

	/** Back at the left, the title centred: a spacer the button's width balances the row. */
	private createHeader(): Stack {
		const header = new Stack({
			id: 'driver_select_header',
			direction: 'horizontal',
			crossAlign: 'center',
			gap: 16,
		});

		const backButton = new Button({
			label: 'Back to Menu',
			id: 'driver_select_back_button',
			// Tab reaches it first, as it reads (R9.18: a positive tabIndex
			// leads the order)
			tabIndex: 1,
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_BUTTON_WIDTH,
			height: 50,
		});
		backButton.onClick = () => this.back();
		header.addChild(backButton);

		header.addChild(new Text({
			text: 'Choose Your Drivers',
			id: 'driver_select_title',
			widthMode: 'fill',
			style: {
				fontSize: 48,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		}));

		header.addChild(new Container({ width: BACK_BUTTON_WIDTH, height: 1 }));
		return header;
	}

	/** The two driver panels, and the synergy panel centred in the column between them. */
	private createBody(): Stack {
		const body = new Stack({
			id: 'driver_select_body',
			direction: 'horizontal',
			gap: 16,
			crossAlign: 'stretch',
			heightMode: 'fill',
		});

		this.leftDriverPanel = new DriverPanel({
			id: 'driver_select_panel_left',
			side: 'left',
			widthMode: 'fill',
			fillWeight: PANEL_WEIGHT,
		});
		this.leftDriverPanel.onDriverChanged = (driver) => {
			this.selectedDriver1 = driver;
			this.rightDriverPanel.partnerDriver = driver;
			this.onDriver1Changed();
		};
		body.addChild(this.leftDriverPanel);

		const synergyColumn = new Stack({
			id: 'driver_select_synergy_column',
			direction: 'vertical',
			distribution: 'center',
			crossAlign: 'stretch',
			widthMode: 'fill',
			fillWeight: SYNERGY_WEIGHT,
		});
		this.synergyPanel = new SynergyPreviewPanel({
			id: 'driver_select_synergy_panel',
		});
		synergyColumn.addChild(this.synergyPanel);
		body.addChild(synergyColumn);

		// Right panel - Second driver selection (initially empty)
		this.rightDriverPanel = new DriverPanel({
			id: 'driver_select_panel_right',
			side: 'right',
			widthMode: 'fill',
			fillWeight: PANEL_WEIGHT,
		});
		this.rightDriverPanel.onDriverChanged = (driver) => {
			this.selectedDriver2 = driver;
			this.leftDriverPanel.partnerDriver = driver;
			this.onDriver2Changed();
		};
		body.addChild(this.rightDriverPanel);

		return body;
	}

	/**
	 * START RUN centred at the foot, and the summary next to it once both
	 * drivers are picked (Game Flow Spec 1.2's confirmation): the summary takes
	 * the room left of the button, the same room on the right stays empty so
	 * the button keeps the middle, and an empty summary moves nothing.
	 */
	private createFooter(): Stack {
		const footer = new Stack({
			id: 'driver_select_footer',
			direction: 'horizontal',
			gap: 16,
			crossAlign: 'center',
		});

		this.confirmationText = new Text({
			text: '',
			id: 'driver_select_confirmation',
			widthMode: 'fill',
			style: {
				fontSize: 16,
				color: '#cccccc',
				textAlign: 'right',
			},
			wrap: 'word',
		});
		footer.addChild(this.confirmationText);

		// The primary action; disabled until two different drivers are picked,
		// which the accent tone draws as its neutral disabled look.
		this.startRunButton = new Button({
			label: 'START RUN',
			id: 'driver_select_start_run_button',
			tone: 'accent',
			size: 'lg',
			width: START_RUN_WIDTH,
			height: 60,
			style: {
				fontSize: 'fs_xl',
			},
		});
		this.startRunButton.enabled = false;
		this.startRunButton.onClick = () => {
			if (this.canStartRun && this.selectedDriver1 && this.selectedDriver2) {
				// Navigate to combat with driver data
				const combatData = {
					drivers: [this.selectedDriver1, this.selectedDriver2]
				};
				ScreenManager.navigate('combatScreen', combatData);
			}
		};
		footer.addChild(this.startRunButton);

		footer.addChild(new Container({ widthMode: 'fill', height: 1 }));
		return footer;
	}

	/** The page is the viewport's size; its stacks place everything in it. */
	private sizePage(): void {
		this.page.setSize(this.rootLayer.width, this.rootLayer.height);
	}

	/**
	 * Load available drivers and initialize panels
	 */
	private async loadDrivers(): Promise<void> {
		const page = this.page;
		try {
			const driverLoader = DriverLoader.getInstance();
			await driverLoader.loadDrivers();
			// The screen left, or left and came back, while the roster loaded.
			if (this.page !== page || !this.isActive) return;

			this.availableDrivers = driverLoader.getUnlockedDrivers();

			if (this.availableDrivers.length > 0) {
				// Right panel gets drivers first but stays empty until the left
				// panel picks, which activates it on a different driver
				this.rightDriverPanel.availableDrivers = this.availableDrivers;

				this.leftDriverPanel.availableDrivers = this.availableDrivers;
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
		if (this.selectedDriver1 && this.rightDriverPanel.isEmpty) {
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
	 * The summary beside START RUN once both drivers are selected
	 */
	private updateConfirmationText(): void {
		const first = this.selectedDriver1;
		const second = this.selectedDriver2;
		this.confirmationText.text = first && second
			? `Ready to enter the wasteland with ${first.metadata.name} and ${second.metadata.name}`
			: '';
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
		this.startRunButton.enabled = this.canStartRun;
	}


	/** The drivers chosen in each panel. */
	public get selectedDrivers(): { driver1: Driver | null; driver2: Driver | null } {
		return {
			driver1: this.selectedDriver1,
			driver2: this.selectedDriver2,
		};
	}

	/**
	 * The viewport changed: the page takes the new size and its stacks lay
	 * everything out again in the layout phase (R8.18)
	 */
	protected onResized(): void {
		this.sizePage();
	}

	protected onUpdate(): void {
		const { tooltips } = this.context;
		this.previewShown = tooltips.surface !== null && tooltips.owner !== null && contains(this.rootLayer, tooltips.owner);
	}

	/** Dismisses a card preview, which is all the first Escape does; the next leaves. */
	private escape(): void {
		if (this.previewShown) {
			this.previewShown = false;
			return;
		}
		this.back();
	}

	/** To the menu, focus back on Start Game, which opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}
