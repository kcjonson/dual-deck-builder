import { Icon } from '../../../engine/components/Icon';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text, TextStyleObject } from '../../../engine/components/Text';
import type { IconName } from '../../../engine/text/icons';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import type { StyleObject } from '../../../engine/style/styleObject';
import { CombatLog } from '../../mechanics/CombatLog';
import { ChromeStack } from './ChromeStack';
import { TOP_BAR_BACKGROUND, rgba } from './combatStyle';
import { TOP_BAR_HEIGHT } from './CombatLayout';

const LABEL_STYLE: TextStyleObject = {
	fontRole: 'display',
	fontSize: 14,
	letterSpacing: 0.06,
	textTransform: 'uppercase',
	color: rgba('text'),
};
const RESOURCE_ICON_SIZE = 16;
const LOG_BUTTON_WIDTH = 62;
/** R13.25's 24 px minimum target at the 0.8 floor, so 30 logical. */
const LOG_BUTTON_HEIGHT = 30;
/** The mock's `.kbtn`: an outlined key, muted display label, and the key's name beside it. */
const LOG_BUTTON_STYLE: StyleObject = {
	backgroundColor: 'transparent',
	borderColor: 'line_edge',
	color: 'text_dim',
	borderRadius: 'r_sm',
	fontSize: 12,
	letterSpacing: 0.08,
	padding: { left: 8, right: 22 },
	hover: { backgroundColor: 'bg_hover', borderColor: 'line_strong', color: 'text' },
};
/** The key that toggles the log, shown in the button. */
export const LOG_KEY = 'L';

/**
 * The combat screen's top bar (Battle Screen Design, section 2): the turn,
 * a one-line ticker of the last log entry, shared scrap and fuel, and the
 * log toggle. The menu and the wave counter join it when the game has them.
 */
export class TopBarLayer extends ChromeStack {
	private readonly combatLog: CombatLog;
	private readonly turnLabel: Text;
	private readonly ticker: Text;
	private readonly scrapValue: Text;
	private readonly fuelValue: Text;
	private readonly logButton: Button;
	private unsubscriber: (() => void) | null = null;

	constructor({ combatLog, onToggleLog, ...options }: StackOptions & { combatLog: CombatLog; onToggleLog: () => void }) {
		super({
			direction: 'horizontal',
			gap: 18,
			padding: { left: 12, right: 12 },
			crossAlign: 'center',
			height: TOP_BAR_HEIGHT,
			widthMode: 'fill',
			chrome: { fill: TOP_BAR_BACKGROUND, edge: { color: rgba('line_hairline'), edges: { bottom: true } } },
			...options,
		});
		this.combatLog = combatLog;

		this.turnLabel = new Text('', { id: 'combat_turn', style: LABEL_STYLE, wrap: 'none' });
		this.addChild(this.turnLabel);

		// Takes the room the rest leave, and gives it up first
		this.ticker = new Text('', {
			id: 'combat_ticker',
			widthMode: 'fill',
			style: {
				fontSize: 12,
				color: rgba('text_dim'),
				textAlign: 'center',
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.ticker);

		this.scrapValue = this.addResource('settings', 'combat_scrap');
		this.fuelValue = this.addResource('local_gas_station', 'combat_fuel');

		// The L key is the keyboard's way to the log, so the button is no Tab stop
		this.logButton = new Button('LOG', {
			id: 'combat_log_toggle',
			size: 'sm',
			width: LOG_BUTTON_WIDTH,
			height: LOG_BUTTON_HEIGHT,
			tabIndex: -1,
			style: LOG_BUTTON_STYLE,
		});
		this.logButton.onClick = onToggleLog;
		this.logButton.addChild(new Text(LOG_KEY, {
			anchor: 'right',
			x: -8,
			style: { fontRole: 'mono', fontSize: 10, color: rgba('text_faint') },
			wrap: 'none',
		}));
		this.addChild(this.logButton);
	}

	/** An icon and its amount, as one group; returns the amount. */
	private addResource(glyph: IconName, id: string): Text {
		const group = new Stack({ direction: 'horizontal', gap: 6, crossAlign: 'center' });
		group.addChild(new Icon({ glyph, size: RESOURCE_ICON_SIZE, tint: tokens.color.text_dim }));
		const value = new Text('0', { id, style: LABEL_STYLE, wrap: 'none' });
		group.addChild(value);
		this.addChild(group);
		return value;
	}

	/** The ticker follows the log, subscribed while mounted (R8.14). */
	protected onMount(): void {
		this.unsubscriber = this.combatLog.on('change', () => this.showLatestEntry());
		this.showLatestEntry();
	}

	protected onUnmount(): void {
		this.unsubscriber?.();
		this.unsubscriber = null;
	}

	private showLatestEntry(): void {
		this.ticker.setText(this.combatLog.getLatestEntry()?.message ?? '');
	}

	public set turn(turn: number) {
		this.turnLabel.setText(`Turn ${turn}`);
	}

	public set scrap(amount: number) {
		this.scrapValue.setText(amount.toString());
	}

	public set fuel(amount: number) {
		this.fuelValue.setText(amount.toString());
	}
}
