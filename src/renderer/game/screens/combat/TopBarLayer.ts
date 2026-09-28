import { Icon } from '../../../engine/components/Icon';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { IconName } from '../../../engine/text/icons';
import { tokens } from '../../../engine/theme/tokens';
import { Button } from '../../../engine/ui/Button';
import type { Style } from '../../../engine/types/Style';
import { CombatLog } from '../../mechanics/CombatLog';
import { TOP_BAR_BACKGROUND, rgba } from './combatStyle';
import { TOP_BAR_HEIGHT } from './CombatLayout';

const LABEL_STYLE: Style = {
	fontFamily: 'display',
	fontSize: 14,
	letterSpacing: 0.06,
	textTransform: 'uppercase',
	color: rgba('text'),
	whiteSpace: 'nowrap',
};
const RESOURCE_ICON_SIZE = 16;
const LOG_BUTTON_WIDTH = 56;

/**
 * The combat screen's top bar (Battle Screen Design, section 2): the turn,
 * a one-line ticker of the last log entry, shared scrap and fuel, and the
 * log toggle. The menu and the wave counter join it when the game has them.
 */
export class TopBarLayer extends Stack {
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
			...options,
		});
		this.combatLog = combatLog;
		this.setBackgroundColor(TOP_BAR_BACKGROUND);

		this.turnLabel = new Text('', { id: 'combat_turn', style: LABEL_STYLE });
		this.addChild(this.turnLabel);

		// Takes the room the rest leave, and gives it up first
		this.ticker = new Text('', {
			id: 'combat_ticker',
			widthMode: 'fill',
			style: {
				fontSize: 12,
				color: rgba('text_dim'),
				textAlign: 'center',
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(this.ticker);

		this.scrapValue = this.addResource('settings', 'combat_scrap');
		this.fuelValue = this.addResource('local_gas_station', 'combat_fuel');

		// F6 is the keyboard's way to the log, so the button is no Tab stop
		this.logButton = new Button('LOG', {
			id: 'combat_log_toggle',
			size: 'sm',
			width: LOG_BUTTON_WIDTH,
			tabIndex: -1,
		});
		this.logButton.onClick = onToggleLog;
		this.addChild(this.logButton);
	}

	/** An icon and its amount, as one group; returns the amount. */
	private addResource(glyph: IconName, id: string): Text {
		const group = new Stack({ direction: 'horizontal', gap: 6, crossAlign: 'center' });
		group.addChild(new Icon({ glyph, size: RESOURCE_ICON_SIZE, tint: tokens.color.text_dim }));
		const value = new Text('0', { id, style: LABEL_STYLE });
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
