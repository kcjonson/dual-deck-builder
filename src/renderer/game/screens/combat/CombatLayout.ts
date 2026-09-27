import { Rect } from '../../../engine/draw/geometry';

/**
 * Where each combat screen layer sits for a viewport size
 */
export interface CombatLayout {
	resourceBar: Rect;
	enemyBattlefield: Rect;
	playerBattlefield: Rect;
	hand: Rect;
	turnBanner: Rect;
	combatLog: Rect;
}

const RESOURCE_BAR_SHARE = 0.07;
const ENEMY_BATTLEFIELD_SHARE = 0.23;
const PLAYER_BATTLEFIELD_SHARE = 0.4;
const HAND_SHARE = 0.18;

const EDGE_MARGIN = 10;
const TURN_BANNER_WIDTH = 200;
const TURN_BANNER_HEIGHT = 40;
const COMBAT_LOG_WIDTH = 240;
const COMBAT_LOG_HEIGHT = 200;

/**
 * The combat screen's one layout, used on mount and on every resize. The
 * bands stack top to bottom and cover 88% of the height; the bottom 12% is
 * left empty until the battle screen redesign says what goes there.
 */
export function computeCombatLayout({ width, height }: { width: number; height: number }): CombatLayout {
	const resourceBarHeight = Math.floor(height * RESOURCE_BAR_SHARE);
	const enemyY = resourceBarHeight;
	const enemyHeight = Math.floor(height * ENEMY_BATTLEFIELD_SHARE);
	const playerY = enemyY + enemyHeight;
	const playerHeight = Math.floor(height * PLAYER_BATTLEFIELD_SHARE);
	const handY = playerY + playerHeight;
	const handHeight = Math.floor(height * HAND_SHARE);
	const overlayY = resourceBarHeight + EDGE_MARGIN;

	return {
		resourceBar: { x: 0, y: 0, width, height: resourceBarHeight },
		enemyBattlefield: { x: 0, y: enemyY, width, height: enemyHeight },
		playerBattlefield: { x: 0, y: playerY, width, height: playerHeight },
		hand: { x: 0, y: handY, width, height: handHeight },
		turnBanner: { x: EDGE_MARGIN, y: overlayY, width: TURN_BANNER_WIDTH, height: TURN_BANNER_HEIGHT },
		combatLog: {
			x: width - COMBAT_LOG_WIDTH - EDGE_MARGIN,
			y: overlayY,
			width: COMBAT_LOG_WIDTH,
			height: COMBAT_LOG_HEIGHT,
		},
	};
}
