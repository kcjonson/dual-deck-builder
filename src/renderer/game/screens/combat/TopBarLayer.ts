import { Component } from '../../../engine/components/Component';
import { Icon } from '../../../engine/components/Icon';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text, TextStyleObject } from '../../../engine/components/Text';
import type { IconName } from '../../../engine/text/icons';
import { Button } from '../../../engine/ui/Button';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { StyleObject } from '../../../engine/style/styleObject';
import { CombatLog } from '../../mechanics/CombatLog';
import { ChromeStack } from './ChromeStack';
import { Rgba, TOP_BAR_BACKGROUND, hexRgba, rgba } from './combatStyle';
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
/** The menu key is square, the mock's `.kbtn` around a 16 px glyph. */
/** Disabled, its edge drops to a hairline and its glyph to the disabled text colour. */
const MENU_BUTTON_STYLE: StyleObject = { ...LOG_BUTTON_STYLE, padding: 0, disabled: { borderColor: 'line_hairline', color: 'text_disabled' } };
const MENU_GLYPH_SIZE = 16;
const MENU_GLYPH_COLOR = rgba('text_dim');
const MENU_GLYPH_DISABLED_COLOR = rgba('text_disabled');
/** The bars' centres in the 16 px box, and their rects, built once. */
const MENU_BARS = [3.5, 8, 12.5].map((y) => ({ x: 2, y: y - 0.9, width: 12, height: 1.8 }));
/** The mock's scrap and fuel tints (`.g-top .grp`). */
const SCRAP_COLOR = hexRgba('#c9b27a');
const FUEL_COLOR = hexRgba('#c9a36a');
/** Raiders still to come, in the raiders' red (the mock's `--enemy`). */
const INCOMING_COLOR = hexRgba('#d4513f');

/** The wave, as the top bar shows it: which wave of how many, and the raiders still to come. */
export interface WaveStatus {
	number: number;
	total: number;
	incoming: number;
}

/** The mock's `i-menu`: three 1.8 px bars in a 16 px box, dimmed with its button. */
class MenuGlyph extends Component {
	constructor() {
		super({ width: MENU_GLYPH_SIZE, height: MENU_GLYPH_SIZE, anchor: 'center', pointerEvents: 'none' });
	}

	public render(draw: DrawApi): void {
		const fill = this.effectivelyEnabled ? MENU_GLYPH_COLOR : MENU_GLYPH_DISABLED_COLOR;
		const id = this.id ?? undefined;
		for (const rect of MENU_BARS) draw.drawRect({ id, rect, fill });
	}
}

/**
 * The combat screen's top bar (Battle Screen Design, section 2): the menu,
 * the wave and the raiders still to come, the turn, a one-line ticker of
 * the last log entry, shared scrap and fuel, and the log toggle.
 *
 * The game has no pause menu yet, so the menu button is drawn disabled
 * until one exists (DDB-264).
 */
export class TopBarLayer extends ChromeStack {
	private readonly combatLog: CombatLog;
	private readonly menuButton: Button;
	private readonly waveLabel: Text;
	private readonly incomingLabel: Text;
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

		this.menuButton = new Button({
			label: '',
			id: 'combat_menu',
			size: 'sm',
			width: LOG_BUTTON_HEIGHT,
			height: LOG_BUTTON_HEIGHT,
			disabled: true,
			style: MENU_BUTTON_STYLE,
			tooltip: 'Menu: not yet available',
		});
		this.menuButton.addChild(new MenuGlyph());
		this.addChild(this.menuButton);

		const wave = new Stack({ direction: 'horizontal', gap: 8, crossAlign: 'center' });
		this.waveLabel = new Text({ text: '', id: 'combat_wave', style: LABEL_STYLE, wrap: 'none' });
		this.incomingLabel = new Text({
			text: '',
			id: 'combat_incoming',
			style: { ...LABEL_STYLE, color: INCOMING_COLOR },
			wrap: 'none',
			visible: false,
		});
		wave.addChild(this.waveLabel);
		wave.addChild(this.incomingLabel);
		this.addChild(wave);

		this.turnLabel = new Text({ text: '', id: 'combat_turn', style: { ...LABEL_STYLE, color: rgba('text_dim') }, wrap: 'none' });
		this.addChild(this.turnLabel);

		// Takes the room the rest leave, and gives it up first
		this.ticker = new Text({
			text: '',
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

		this.scrapValue = this.addResource({ glyph: 'settings', id: 'combat_scrap', color: SCRAP_COLOR });
		this.fuelValue = this.addResource({ glyph: 'local_gas_station', id: 'combat_fuel', color: FUEL_COLOR });

		// The L key is the keyboard's way to the log, so the button is no Tab stop
		this.logButton = new Button({
			label: 'LOG',
			id: 'combat_log_toggle',
			size: 'sm',
			width: LOG_BUTTON_WIDTH,
			height: LOG_BUTTON_HEIGHT,
			tabIndex: -1,
			style: LOG_BUTTON_STYLE,
		});
		this.logButton.onClick = onToggleLog;
		this.logButton.addChild(new Text({
			text: LOG_KEY,
			anchor: 'right',
			x: -8,
			style: { fontRole: 'mono', fontSize: 10, color: rgba('text_faint') },
			wrap: 'none',
		}));
		this.addChild(this.logButton);
	}

	/** An icon and its amount, as one group; returns the amount. */
	private addResource({ glyph, id, color }: { glyph: IconName; id: string; color: Rgba }): Text {
		const group = new Stack({ direction: 'horizontal', gap: 6, crossAlign: 'center' });
		group.addChild(new Icon({ glyph, size: RESOURCE_ICON_SIZE, tint: color }));
		const value = new Text({ text: '0', id, style: { ...LABEL_STYLE, color }, wrap: 'none' });
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
		this.ticker.text = this.combatLog.latestEntry?.message ?? '';
	}

	/** The menu button, disabled until the game has a pause menu. */
	public get menu(): Button {
		return this.menuButton;
	}

	public set wave({ number, total, incoming }: WaveStatus) {
		this.waveLabel.text = `Wave ${number} of ${total}`;
		this.incomingLabel.text = `+${incoming} incoming`;
		this.incomingLabel.visible = incoming > 0;
	}

	public set turn(turn: number) {
		this.turnLabel.text = `Turn ${turn}`;
	}

	public set scrap(amount: number) {
		this.scrapValue.text = amount.toString();
	}

	public set fuel(amount: number) {
		this.fuelValue.text = amount.toString();
	}
}
