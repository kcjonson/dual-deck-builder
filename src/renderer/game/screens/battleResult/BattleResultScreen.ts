import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import type { ScreenName } from '../../core/ScreenManager';
import { Text } from '../../../engine/components/Text';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { ATLAS } from '../../ui/atlas/atlasStyle';
import { DamageMark } from '../../ui/atlas/DamageMark';
import { LegendBox } from '../../ui/atlas/LegendBox';

/**
 * What the battle result screen shows: the outcome, and where Continue goes.
 * The outcome alone is plain data, so the dev navigate hook can pass
 * exactly what the combat screen does for a skirmish. Statistics (salvage,
 * levels, turns) join it when the screen shows them.
 */
export interface BattleResultData {
	victory: boolean;
	/** The raiders broke off: neither won nor lost (Combat Rules, How a fight ends). `victory` is false. */
	brokenOff?: boolean;
	/** The line under the outcome, when the stock one is wrong: a fight given up wasn't lost to wrecks. */
	subtitle?: string;
	/** Where Continue goes, with what: a supply run's fight goes back to its run. The menu when left out. */
	next?: { screen: ScreenName; data?: unknown };
}

const PANEL_WIDTH = 600;
const CONTINUE_WIDTH = 260;
const TITLE_SIZE = 56;
const KICKER_SIZE = 12;

function isBattleResultData(data: unknown): data is BattleResultData {
	return typeof data === 'object' && data !== null && 'victory' in data;
}

/**
 * Screen displayed after battle ends, on the atlas sheet (UI Art Direction,
 * Screens): one legend box centred on the page with the outcome and
 * Continue, the highway, which has focus on mount. Enter continues, and so
 * does Escape, since there is nowhere else to go.
 *
 * A loss takes one hero mark after the event (Wear): LOST, stamped on the
 * W2 page above the box, clear of the text. Only a fallen compound is a
 * damaged (W3) sheet. The title is display 700: the logo's brush letters are baked
 * as the logo, not as an alphabet, so there's no "VICTORY" to cut from them.
 */
export class BattleResultScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private next: BattleResultData['next'] = undefined;

	constructor() {
		const root = new AtlasSheet({
			id: 'battleResultScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			distribution: 'center',
			crossAlign: 'center',
			gap: 4,
		});
		super('battleResultScreen', { root, theme: 'atlas' });
		this.sheet = root;
	}

	protected onMount(data?: unknown): void {
		if (!isBattleResultData(data)) {
			console.error('BattleResultScreen: Invalid or missing data');
			return;
		}
		const { victory } = data;
		const brokenOff = !victory && data.brokenOff === true;
		const lost = !victory && !brokenOff;
		this.next = data.next;

		if (lost) this.sheet.addChild(new DamageMark({ id: 'result_stamp', kind: 'lost' }));
		const panel = new LegendBox({
			id: 'result_panel',
			width: PANEL_WIDTH,
			crossAlign: 'center',
			gap: 12,
			padding: 32,
		});
		panel.addChild(new Text({
			text: victory ? 'Fight won' : brokenOff ? 'Fight broken off' : 'Fight lost',
			id: 'result_kicker',
			style: { fontRole: 'mono', fontWeight: 500, fontSize: KICKER_SIZE, letterSpacing: 0.14, textTransform: 'uppercase', color: 'text_dim', textAlign: 'center' },
			wrap: 'none',
		}));
		panel.addChild(new Text({
			text: victory ? 'VICTORY!' : brokenOff ? 'BROKEN OFF' : 'DEFEAT!',
			id: 'result_title',
			style: {
				fontRole: 'display',
				fontWeight: 700,
				fontSize: TITLE_SIZE,
				letterSpacing: ATLAS.headTracking,
				color: lost ? 'status_crit' : 'text',
				textAlign: 'center',
			},
			wrap: 'none',
		}));
		panel.addChild(new Text({
			text: data.subtitle ?? (victory ? 'All enemies have been defeated!' : brokenOff ? 'The raiders broke off. Nothing won, nothing lost.' : 'Your vehicles have been destroyed!'),
			id: 'result_subtitle',
			widthMode: 'fill',
			style: { fontSize: 16, color: 'text_dim', textAlign: 'center' },
		}));

		const continueButton = new AtlasButton({
			label: 'Continue',
			id: 'result_continue_button',
			variant: 'highway',
			shield: true,
			labelSize: 24,
			height: 56,
			width: CONTINUE_WIDTH,
			margin: { top: 16 },
			onClick: () => this.continue(),
		});
		panel.addChild(continueButton);
		this.sheet.addChild(panel);

		this.rootLayer.hotkeys.register('Escape', () => this.continue());
		this.context.focus.focus(continueButton);
	}

	protected onUnmount(): void {
		this.rootLayer.hotkeys.unregister('Escape');
		this.sheet.clearChildren();
		this.next = undefined;
	}

	/** Where the fight said to go next, or to the menu, focus back on what was focused when it was left, so an Enter there doesn't found a campaign. */
	private continue(): void {
		if (this.next) ScreenManager.navigate(this.next.screen, this.next.data);
		else ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}
