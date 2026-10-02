import { Model } from '../core/Model';
import { BattleMessage, BattleMessageType } from './Battle';

/**
 * Types of combat log entries
 */
export enum CombatLogType {
	ACTION = 'action',
	DAMAGE = 'damage',
	HEAL = 'heal',
	STATUS = 'status',
	TURN = 'turn',
	INFO = 'info',
	MISS = 'miss',
	ARMOR = 'armor',
	BATTLE_END = 'battle_end'
}

/**
 * One line of the combat log, as the player reads it. The turn is the
 * line's one prefix in the drawer.
 */
export interface CombatLogEntry {
	id: string;
	message: string;
	type: CombatLogType;
	turn?: number;
}

export interface CombatLogData {
	entries: CombatLogEntry[];
	maxEntries: number;
	nextId: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CombatLog extends CombatLogData {}

/**
 * How each battle message reaches the player's log, or null for the ones
 * that never do: debug dumps, the record's turn bookkeeping (the screen
 * logs each turn change once itself), the opening (the screen names the
 * matchup), and leftover adrenaline (End Turn warns before it happens).
 */
const BATTLE_MESSAGE_TYPES: Readonly<Record<BattleMessageType, CombatLogType | null>> = {
	battle_start: null,
	turn_start: null,
	turn_end: null,
	adrenaline_remaining: null,
	debug: null,
	card_played: CombatLogType.ACTION,
	damage_dealt: CombatLogType.DAMAGE,
	heal_applied: CombatLogType.HEAL,
	armor_gained: CombatLogType.ARMOR,
	status_applied: CombatLogType.STATUS,
	miss: CombatLogType.MISS,
	out_of_range: CombatLogType.MISS,
	fizzle: CombatLogType.MISS,
	cards_burned: CombatLogType.INFO,
	battle_end: CombatLogType.BATTLE_END,
	general: CombatLogType.INFO,
};

/**
 * The combat log the player reads (DDB-123): player-facing lines only,
 * each tagged with its turn, in a rolling buffer of `maxEntries`.
 */
export class CombatLog extends Model<CombatLogData> {
	static properties = new Set<keyof CombatLogData>([
		'entries',
		'maxEntries',
		'nextId',
	]);

	constructor({ maxEntries = 100 }: { maxEntries?: number } = {}) {
		super({ entries: [], maxEntries, nextId: 1 });
	}

	/** Adds a line, dropping the oldest past `maxEntries`; one `change` event. */
	public addEntry({ message, type = CombatLogType.INFO, turn }: { message: string; type?: CombatLogType; turn?: number }): void {
		const entry: CombatLogEntry = { id: `log-${this.nextId}`, message, type, turn };
		const entries = [...this.entries, entry];
		this.set({
			entries: entries.length > this.maxEntries ? entries.slice(entries.length - this.maxEntries) : entries,
			nextId: this.nextId + 1,
		});
	}

	/** A battle message as the player reads it, if it is one they read. */
	public addBattleMessage(message: BattleMessage): void {
		const type = BATTLE_MESSAGE_TYPES[message.type];
		if (type === null) return;
		this.addEntry({ message: message.line ?? message.message, type, turn: message.turn });
	}

	/** The newest line, or null. */
	public get latestEntry(): CombatLogEntry | null {
		return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
	}
}
