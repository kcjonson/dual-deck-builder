import { Battle, BattleMessage } from './Battle';
import { Card } from './Card';
import { CombatLog, CombatLogType } from './CombatLog';
import { RoadLane, RoadRow } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';

/** DDB-123: the player's log is player-facing lines only, each with one prefix, its turn. */

function message(type: BattleMessage['type'], text: string, line?: string): BattleMessage {
	return { type, message: text, timestamp: 0, turn: 2, ...(line ? { line } : {}) };
}

function vehicle(name: string, lane: RoadLane): Vehicle {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 20,
		maxStructure: 20,
		baseSpeed: 3,
		slot: { lane, row: RoadRow.CENTER },
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: [],
	});
}

const shot = (): Card => new Card({
	type: 'shot',
	name: 'Shot',
	summary: 'Shot',
	description: 'Shot',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 4, range: 1, always_hits: true }],
	tags: [],
});

describe('CombatLog', () => {
	it('keeps the newest maxEntries lines, each with its turn', () => {
		const log = new CombatLog({ maxEntries: 2 });
		log.addEntry({ message: 'one', turn: 1 });
		log.addEntry({ message: 'two', turn: 1 });
		log.addEntry({ message: 'three', type: CombatLogType.TURN, turn: 2 });
		expect(log.entries.map(entry => [entry.message, entry.turn])).toEqual([['two', 1], ['three', 2]]);
		expect(log.latestEntry?.message).toBe('three');
	});

	it('takes the player line of a battle message and leaves the record and the bookkeeping out', () => {
		const log = new CombatLog();
		log.addBattleMessage(message('debug', '=== ENEMY TEAM HANDS ==='));
		log.addBattleMessage(message('battle_start', 'Battle started!'));
		log.addBattleMessage(message('turn_start', 'Player turn 2 started'));
		log.addBattleMessage(message('turn_end', 'Ending player turn'));
		log.addBattleMessage(message('adrenaline_remaining', 'Player1 Ace ended turn with 2 adrenaline remaining'));
		log.addBattleMessage(message('card_played', 'Player1 Ace plays Shot (Adrenaline: 3 -> 2)', 'Ace plays Shot'));
		log.addBattleMessage(message('miss', 'Shot misses Buggy'));
		expect(log.entries.map(entry => [entry.message, entry.type, entry.turn])).toEqual([
			['Ace plays Shot', CombatLogType.ACTION, 2],
			['Shot misses Buggy', CombatLogType.MISS, 2],
		]);
	});

	it('reads a played turn as the player would: no debug dumps, seat tags, or stat dumps', () => {
		const rig = vehicle('Rig', RoadLane.PLAYER_INSIDE);
		const bike = vehicle('Bike', RoadLane.PLAYER_OUTSIDE);
		const buggy = vehicle('Buggy', RoadLane.ENEMY_INSIDE);
		const battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy] }),
		});
		const log = new CombatLog();
		battle.on('battleMessage', (battleMessage: BattleMessage) => log.addBattleMessage(battleMessage));
		battle.start();
		const driver = rig.driver;
		if (!driver) throw new Error('Rig has no driver');
		driver.set({ hand: [shot()], adrenaline: 5 });
		expect(battle.playCard({ driver, cardIndex: 0, targetVehicle: buggy })).toBe(true);
		battle.endPlayerTurn();

		const lines = log.entries.map(entry => entry.message);
		expect(lines).toEqual(expect.arrayContaining(['Rig Driver plays Shot', 'Shot deals 4 total (2 to structure, 2 to occupants) damage to Buggy']));
		for (const line of lines) {
			expect(line).not.toMatch(/===|^ {2}|Player\d|Enemy\d|\((Structure|Armor|Adrenaline|HP|Shield|Speed):/);
		}
		// The record keeps all of it
		expect(battle.getMessages().some(entry => entry.message.startsWith('==='))).toBe(true);
		expect(battle.getMessages().some(entry => entry.message.includes('(Structure: '))).toBe(true);
	});
});
