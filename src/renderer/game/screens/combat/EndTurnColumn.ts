import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { StyleObject } from '../../../engine/style/styleObject';
import { Button } from '../../../engine/ui/Button';
import { rgba } from './combatStyle';
import { END_TURN_COLUMN_WIDTH } from './CombatLayout';

/**
 * The battle screen mock's End Turn (`.endturn .btn`): a bone face with dark
 * text, 21 px display tracked 0.1 em, white on hover with the warm accent at
 * its edge, and the neutral surface with muted text while waiting. Not the
 * accent tone: yellow is keywords and interaction, and the one big action
 * reads apart from both.
 */
const END_TURN_STYLE: StyleObject = {
	backgroundColor: 'text',
	borderColor: 'text',
	color: 'accent_contrast',
	borderRadius: 'r_md',
	fontSize: 21,
	letterSpacing: 0.1,
	hover: { backgroundColor: 'text_bright', borderColor: 'accent' },
	disabled: { backgroundColor: 'bg_panel_raised', borderColor: 'line_edge', color: 'text_dim' },
};
const END_TURN_HEIGHT = 64;
/** Where the column's content starts below the dock's top edge, from the mock. */
const COLUMN_TOP = 18;

/**
 * The End Turn column at the right end of the dock (Battle Screen Design,
 * section 4): the turn number above the button, and a warning under it
 * while adrenaline is left unspent.
 */
export class EndTurnColumn extends Stack {
	private readonly turnLabel: Text;
	private readonly endTurnButton: Button;
	private readonly warning: Text;

	constructor({ onEndTurn, ...options }: StackOptions & { onEndTurn: () => void }) {
		super({
			direction: 'vertical',
			gap: 8,
			padding: { top: COLUMN_TOP },
			crossAlign: 'stretch',
			width: END_TURN_COLUMN_WIDTH,
			heightMode: 'fill',
			...options,
		});

		this.turnLabel = new Text({
			text: '',
			id: 'end_turn_turn',
			style: {
				fontRole: 'display',
				fontSize: 13,
				letterSpacing: 0.14,
				textTransform: 'uppercase',
				color: rgba('text_dim'),
				textAlign: 'center',
			},
			wrap: 'none',
		});
		this.addChild(this.turnLabel);

		this.endTurnButton = new Button({
			label: 'END TURN',
			id: 'end_turn_button',
			size: 'lg',
			width: END_TURN_COLUMN_WIDTH,
			height: END_TURN_HEIGHT,
			style: END_TURN_STYLE,
		});
		this.endTurnButton.onClick = onEndTurn;
		this.addChild(this.endTurnButton);

		// The mock's `.warn`: 12 on 15, wrapping inside the column, since two
		// drivers' pools past six can run to "16 adrenaline unspent"
		this.warning = new Text({
			text: '',
			id: 'end_turn_warning',
			style: { fontRole: 'mono', fontSize: 12, color: rgba('accent'), textAlign: 'center' },
			lineHeight: 15 / 12,
			wrap: 'word',
		});
		this.addChild(this.warning);
	}

	/** For the combat screen's keyboard focus: where it lands when the hand has nothing to play. */
	public get endTurn(): Button {
		return this.endTurnButton;
	}

	/**
	 * Whether End Turn asks for the end-turn preview (section 6): the pointer
	 * is on it, or keyboard focus is, which is the keyboard's way to read
	 * the raiders' plan.
	 */
	public get previewing(): boolean {
		return this.endTurnButton.hovered || this.endTurnButton.focusVisible;
	}

	/**
	 * The turn and whose move it is above the button, and the adrenaline
	 * the player would leave unspent under it. While the raiders act the
	 * button says WAIT and the dock that holds it is locked (section 6).
	 */
	public show({ turn, playerTurn, waiting, unspentAdrenaline }: { turn: number; playerTurn: boolean; waiting: boolean; unspentAdrenaline: number }): void {
		this.turnLabel.text = `Turn ${turn} · ${playerTurn ? 'Your move' : 'Raiders'}`;
		this.endTurnButton.label = waiting ? 'WAIT' : 'END TURN';
		this.warning.text = playerTurn && unspentAdrenaline > 0 ? `${unspentAdrenaline} adrenaline unspent` : '';
	}
}
