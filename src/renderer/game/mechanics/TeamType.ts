/**
 * Team type (player or AI controlled). Lives apart from Team so the road
 * model can use it without importing Team, which imports Vehicle.
 */
export enum TeamType {
	PLAYER = 'player',
	ENEMY = 'enemy'
}
