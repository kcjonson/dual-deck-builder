#include "Turns.h"

#include "CardPlay.h"
#include "Hands.h"
#include "Movement.h"
#include "Statuses.h"
#include "Waves.h"

namespace rules {

	namespace {

		// Each driver's draw at the start of every player turn (Combat Rules, Combat sequence).
		constexpr int kTurnDraw = 5;

		// The raiders rout once the threat left is at or under one part in this many of the start, and break off
		// after this many quiet player turns running (Combat Rules, How a fight ends).
		constexpr int kRoutParts = 4;
		constexpr int kBreakOffTurns = 3;

		std::vector<DriverIndex> driversInFight(const BattleState& state) {
			std::vector<DriverIndex> drivers;
			for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
				if (driverInFight(state, DriverIndex{index})) {
					drivers.push_back(DriverIndex{index});
				}
			}
			return drivers;
		}

		void clearWrecks(BattleState& state, std::vector<Event>& events) {
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const VehicleIndex vehicle{index};
				if (state.vehicle(vehicle).onRoad && !vehicleInFight(state, vehicle)) {
					state.vehicle(vehicle).onRoad = false;
					events.emplace_back(event::LeftRoad{.vehicle = vehicle});
				}
			}
		}

		// What "this turn" asks about starts over with each side's turn: who attacked, and who swerved.
		void forgetTheLastTurn(BattleState& state) {
			for (BattleDriver& driver : state.drivers) {
				driver.attackedThisTurn = false;
			}
			for (BattleVehicle& vehicle : state.vehicles) {
				vehicle.swervedThisTurn = false;
			}
		}

		void endFight(BattleState& state, Outcome outcome, std::optional<RoutCause> rout, std::vector<Event>& events) {
			state.phase = Phase::Over;
			state.actingRaider.reset();
			state.outcome = outcome;
			state.rout = rout;
			events.emplace_back(event::FightEnded{.outcome = outcome, .rout = rout});
		}

	} // namespace

	std::optional<VehicleIndex> raiderAtTheWheel(const BattleState& state, DriverIndex raider) {
		const std::optional<VehicleIndex> vehicle = vehicleCarrying(state, raider);
		if (!driverInFight(state, raider) || !vehicle || state.vehicle(*vehicle).driver != raider) {
			return std::nullopt;
		}
		return vehicle;
	}

	bool canAct(const BattleState& state, DriverIndex driver) {
		if (state.driver(driver).side == Side::Player) {
			return driverInFight(state, driver);
		}
		const std::optional<VehicleIndex> vehicle = raiderAtTheWheel(state, driver);
		return vehicle && !hasStatus(state.vehicle(*vehicle), Status::Stunned);
	}

	bool endIfOver(BattleState& state, std::vector<Event>& events) {
		bool playerLeft = false;
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			if (state.drivers[static_cast<size_t>(index)].side == Side::Player) {
				playerLeft = playerLeft || driverInFight(state, DriverIndex{index});
			}
		}
		if (!playerLeft) {
			endFight(state, Outcome::Lost, std::nullopt, events);
			return true;
		}

		int	 onRoad = 0;
		int	 queued = 0;
		int	 threatLeft = 0;
		bool leaderOut = false;
		for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
			const BattleVehicle& raider = state.vehicles[static_cast<size_t>(index)];
			if (raider.side != Side::Raiders) {
				continue;
			}
			const bool inFight = vehicleInFight(state, VehicleIndex{index});
			onRoad += inFight ? 1 : 0;
			threatLeft += inFight ? raider.threat : 0;
			leaderOut = leaderOut || (raider.leads && !inFight);
		}
		for (const QueuedWave& wave : state.reinforcements.queue) {
			for (const QueuedRaider& raider : wave.raiders) {
				++queued;
				threatLeft += raider.vehicle.threat;
			}
		}
		if (onRoad + queued == 0) {
			endFight(state, Outcome::Won, std::nullopt, events);
			return true;
		}
		// Threat is nominal, each opponent's own number however hurt it is, so spreading damage can't set it off.
		const bool thinned = state.startingThreat > 0 && threatLeft * kRoutParts <= state.startingThreat;
		if (leaderOut || thinned) {
			endFight(state, Outcome::Won, leaderOut ? RoutCause::LeaderOut : RoutCause::ThreatThinned, events);
			return true;
		}
		if (onRoad == 0) {
			announceWave(state, events);
		}
		return false;
	}

	bool breakOffIfQuiet(BattleState& state, std::vector<Event>& events) {
		state.quietTurns = state.raiderHurt ? 0 : state.quietTurns + 1;
		if (state.quietTurns < kBreakOffTurns) {
			return false;
		}
		endFight(state, Outcome::BrokenOff, std::nullopt, events);
		return true;
	}

	// Statuses tick first, so one that lasts "until the end of the next enemy turn" is gone before anyone plans
	// (enemy-intent-planning.md). The raiders' hands from the enemy turn are discarded here rather than at its
	// end, since each held the cards it was choosing from; Shield clears so a Shield given on the player's turn
	// covers exactly the enemy turn after it.
	void openPlayerTurn(BattleState& state, std::vector<Event>& events) {
		state.phase = Phase::Planning;
		state.actingRaider.reset();
		state.raiderHurt = false;
		events.emplace_back(event::TurnStarted{.turn = state.turn, .side = Side::Player});
		tickStatuses(state, events);
		forgetTheLastTurn(state);
		const std::vector<DriverIndex> inFight = driversInFight(state);
		for (const DriverIndex driver : inFight) {
			discardHand(state, driver, events);
		}
		for (const DriverIndex driver : inFight) {
			BattleDriver& refilled = state.driver(driver);
			refilled.adrenaline = refilled.maxAdrenaline;
			events.emplace_back(event::AdrenalineRefilled{.driver = driver, .adrenaline = refilled.adrenaline});
		}
		for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
			BattleVehicle& vehicle = state.vehicles[static_cast<size_t>(index)];
			if (vehicle.shield > 0) {
				events.emplace_back(event::ShieldCleared{.vehicle = VehicleIndex{index}, .shield = vehicle.shield});
				vehicle.shield = 0;
			}
			vehicle.spent = false;
		}
		for (const DriverIndex driver : inFight) {
			drawCards(state, driver, kTurnDraw, events);
		}
		checkWaveDue(state, events);
	}

	void beginEnemyTurn(BattleState& state, std::vector<Event>& events) {
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			if (state.drivers[static_cast<size_t>(index)].side == Side::Player) {
				discardHand(state, DriverIndex{index}, events);
			}
		}
		dropBackFlankers(state, events);
		clearWrecks(state, events);
		forgetTheLastTurn(state);
		state.phase = Phase::EnemyTurn;
		state.actingRaider.reset();
		events.emplace_back(event::TurnStarted{.turn = state.turn, .side = Side::Raiders});
	}

	void passToNextRaider(BattleState& state, std::vector<Event>& events) {
		const int first = state.actingRaider ? state.actingRaider->value + 1 : 0;
		for (int index = first; index < static_cast<int>(state.drivers.size()); ++index) {
			const DriverIndex raider{index};
			if (state.driver(raider).side != Side::Raiders || !raiderAtTheWheel(state, raider)) {
				continue;
			}
			if (!canAct(state, raider)) {
				events.emplace_back(event::RaiderStunned{.raider = raider});
				continue;
			}
			state.actingRaider = raider;
			events.emplace_back(event::RaiderActing{.raider = raider});
			return;
		}
		finishEnemyTurn(state, events);
	}

	// The drop-back comes before the statuses tick at the player's turn, so a one-turn boost still counts for it.
	void finishEnemyTurn(BattleState& state, std::vector<Event>& events) {
		state.actingRaider.reset();
		takeDeathMarks(state, Side::Raiders, events);
		if (endIfOver(state, events)) {
			return;
		}
		dropBackFlankers(state, events);
		clearWrecks(state, events);
		closeUpRaiders(state, events);
		landWave(state, events);
		// Draw Fire lasts until the end of the next enemy turn, which this is.
		state.drawFireCovers.clear();
		++state.turn;
		openPlayerTurn(state, events);
	}

	void playCard(BattleState& state, const Content& content, const action::PlayCard& play, std::vector<Event>& events) {
		BattleDriver&		  caster = state.driver(play.driver);
		const BattleCard	  card = caster.hand[static_cast<size_t>(play.handIndex)];
		const CardDefinition& definition = definitionOf(content, card.card);
		const int			  cost = cardCost(definition, card.upgraded);
		const bool			  exhausts = cardHasTag(definition, card.upgraded, "exhaust");
		const CardPlay		  aimed{
				   .caster = play.driver,
				   .actor = *vehicleCarrying(state, play.driver),
				   .target = play.target,
				   .occupant = play.occupant,
				   .destination = play.destination,
		   };
		// Chosen before anything moves, by the rule actionBlocker checked it with.
		const std::optional<VehicleIndex> carrier =
			isAttackOrder(definition, card.upgraded) ? orderCarrier(state, definition, card.upgraded, aimed) : std::nullopt;

		caster.hand.erase(caster.hand.begin() + play.handIndex);
		caster.adrenaline -= cost;
		(exhausts ? caster.exhausted : caster.discard).push_back(card);
		caster.attackedThisTurn = caster.attackedThisTurn || cardHasTag(definition, card.upgraded, "attack");
		events.emplace_back(
			event::CardPlayed{.driver = play.driver, .card = card, .target = play.target, .cost = cost, .exhausted = exhausts}
		);

		if (isRally(definition, card.upgraded)) {
			resolveRally(state, definition, card.upgraded, play.driver, events);
			return;
		}
		CardPlay resolved = aimed;
		if (carrier) {
			resolved.actor = *carrier;
			events.emplace_back(event::OrderCarried{.escort = *carrier, .target = play.target});
		}
		const bool usesBonus =
			cardHasTag(definition, card.upgraded, "attack") && hasStatus(state.vehicle(resolved.actor), Status::DamageBonus);
		resolveCard(state, cardEffects(definition, card.upgraded), resolved, events);
		if (usesBonus) {
			useDamageBonus(state, resolved.actor, events);
		}
		// An attack order spends the escort that carried it out, and Draw Fire the escort it's played at.
		const std::optional<VehicleIndex> spends = carrier ? carrier : definition.target == CardTarget::Escort ? play.target : std::nullopt;
		if (definition.spendsEscort && spends && !state.vehicle(*spends).spent) {
			state.vehicle(*spends).spent = true;
			events.emplace_back(event::EscortSpent{.escort = *spends});
		}
	}

} // namespace rules
