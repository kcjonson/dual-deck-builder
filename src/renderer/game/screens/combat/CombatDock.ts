import type { StackOptions } from '../../../engine/components/Stack';
import { ChromeStack } from './ChromeStack';
import { DOCK_HEIGHT } from './CombatLayout';
import { DOCK_GRADIENT, rgba } from './combatStyle';
import { EndTurnColumn } from './EndTurnColumn';
import { PlayerHandLayer } from './PlayerHandLayer';

/** Between the hands and the End Turn column. */
const DOCK_GAP = 16;
/**
 * From the mock: tabs 8 below the dock's edge and cards 38 below it, ending
 * 10 above the bottom. The fan runs to the dock's foot, since its edge
 * cards lean and drop up to 9 into those 10.
 */
const DOCK_PADDING = { top: 8, bottom: 0, left: 16, right: 16 };

/**
 * The battle screen's dock (Battle Screen Design, section 4): each driver's
 * tab and fanned hand side by side, then the 148 px End Turn column at the
 * stage's right end.
 */
export class CombatDock extends ChromeStack {
	public readonly hand: PlayerHandLayer;
	public readonly endTurnColumn: EndTurnColumn;

	constructor({ onEndTurn, ...options }: StackOptions & { onEndTurn: () => void }) {
		super({
			direction: 'horizontal',
			gap: DOCK_GAP,
			padding: DOCK_PADDING,
			crossAlign: 'stretch',
			widthMode: 'fill',
			height: DOCK_HEIGHT,
			chrome: { fill: DOCK_GRADIENT, edge: { color: rgba('line_edge'), edges: { top: true } } },
			...options,
		});

		this.hand = new PlayerHandLayer({
			id: 'combat_player_hand',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		this.addChild(this.hand);

		this.endTurnColumn = new EndTurnColumn({
			id: 'combat_end_turn',
			onEndTurn,
		});
		this.addChild(this.endTurnColumn);
	}
}
