import { incomingHits } from '../ai/IncomingHits';
import type { Battle } from '../mechanics/Battle';
import type { Card } from '../mechanics/Card';
import type { Team } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';

/**
 * How one card did over a cell's fights (DDB-553), for the per-card report
 * `balance-sim fights --cards` prints. Only the player side's cards.
 */
export interface CardStats {
	/** Copies dealt into a hand: the turn's draw, and any drawn mid-turn. */
	readonly seen: number;
	readonly played: number;
	/** Planned raider intents that dropped out of the preview as the card landed, from raiders it neither wrecked nor stunned. */
	readonly fizzled: number;
	/** Planned damage on the convoy, before Shield and armor, that the card took off by fizzles, moves, and Evade, kills and stuns not counted; less any it brought on. */
	readonly damageBlanked: number;
}

interface Tally {
	seen: number;
	played: number;
	fizzled: number;
	damageBlanked: number;
}

/** What the raiders plan to do as it stands, raider by raider: intents shown, and planned damage that would land. */
interface Threat {
	intents: Map<Vehicle, number>;
	damage: Map<Vehicle, number>;
}

/**
 * Counts each player card's draws and plays through a fight, and what each
 * play did to the raiders' plans: the intents it made fizzle, and the
 * planned damage it took off the convoy. It reads the preview the player
 * sees (Battle.getAllIntents) before and after each card, so it costs two
 * projections of the enemy turn a play; the sim makes one only when asked
 * (SimConfig.cardStats).
 */
export class CardTally {
	private readonly battle: Battle;
	private readonly team: Team;
	private readonly tallies = new Map<string, Tally>();
	/** Cards counted as seen this turn */
	private seenThisTurn = new Set<Card>();
	private threat: Threat = { intents: new Map(), damage: new Map() };

	constructor({ battle, team }: { battle: Battle; team: Team }) {
		this.battle = battle;
		this.team = team;
		battle.on('cardPlayed', ({ card }: { card: Card }) => this.played(card));
	}

	/** Call as each player turn starts, once the hands are dealt and the raiders have planned. */
	public startTurn(): void {
		this.seenThisTurn = new Set();
		this.noteHands();
		this.threat = this.readThreat();
	}

	/** Every card's counts so far, by card type. */
	public get stats(): Record<string, CardStats> {
		return Object.fromEntries([...this.tallies].map(([type, tally]) => [type, { ...tally }]));
	}

	private played(card: Card): void {
		const tally = this.tallyOf(card.type);
		tally.played += 1;
		const after = this.readThreat();
		for (const [raider, intents] of this.threat.intents) {
			// A wrecked or stunned raider drops its plan; that's the hit or the stun, not a fizzle
			if (raider.isOutOfFight || raider.isStunned) continue;
			tally.fizzled += Math.max(0, intents - (after.intents.get(raider) ?? 0));
			tally.damageBlanked += (this.threat.damage.get(raider) ?? 0) - (after.damage.get(raider) ?? 0);
		}
		this.threat = after;
		this.noteHands();
	}

	/** Count each card in a hand on the team that hasn't been counted this turn: the draw, or a card drawn since. */
	private noteHands(): void {
		for (const driver of this.team.getAllDrivers()) {
			for (const card of driver.hand) {
				if (this.seenThisTurn.has(card)) continue;
				this.seenThisTurn.add(card);
				this.tallyOf(card.type).seen += 1;
			}
		}
	}

	private readThreat(): Threat {
		const intents = new Map<Vehicle, number>();
		for (const [raider, shown] of this.battle.getAllIntents()) intents.set(raider, shown.length);
		const damage = new Map<Vehicle, number>();
		for (const hit of incomingHits({ battle: this.battle, team: this.team })) damage.set(hit.raider, (damage.get(hit.raider) ?? 0) + hit.damage);
		return { intents, damage };
	}

	private tallyOf(type: string): Tally {
		let tally = this.tallies.get(type);
		if (!tally) {
			tally = { seen: 0, played: 0, fizzled: 0, damageBlanked: 0 };
			this.tallies.set(type, tally);
		}
		return tally;
	}
}

/** Two cells' or runs' counts together. */
export function addCardStats(into: Record<string, CardStats>, more: Readonly<Record<string, CardStats>>): Record<string, CardStats> {
	const sum: Record<string, CardStats> = { ...into };
	for (const [type, stats] of Object.entries(more)) {
		const held = sum[type];
		sum[type] = held ? {
			seen: held.seen + stats.seen,
			played: held.played + stats.played,
			fizzled: held.fizzled + stats.fizzled,
			damageBlanked: held.damageBlanked + stats.damageBlanked,
		} : stats;
	}
	return sum;
}
