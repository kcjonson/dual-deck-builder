#pragma once

#include "BattleAction.h"
#include "BattleEvent.h"
#include "BattleState.h"

#include <rules/core/Deck.h>
#include <rules/packs/Pack.h>

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace rules {

	// The fight is a value and these are its rules (rules-ai-and-packs.md): legalActions says what the side to
	// act can do, and apply does it and returns what happened. apply is the one place effects are carried out,
	// so a preview, a projection, or an AI's lookahead is apply on a copy of the state.
	//
	// Each player turn opens in Planning: planEnemyTurn (EnemyTurn.h) has every raider commit its coming turn,
	// each through its own Policy, which libs/ai implements and the rules never call on their own. The player then
	// plays from either driver until EndTurn, which plays the raiders' plans without choosing again and opens the
	// next player turn. Nothing chooses for a whole side.

	// One of the player's drivers, the vehicle their archetype comes with, and the deck they bring.
	struct PlayerSeat {
		DriverId				driver;
		std::vector<BattleCard> deck;
		// Where the vehicle opens; without one it takes the next free slot in the opening order.
		std::optional<FormationSlot> slot;
	};

	// A raider, with the vehicle and deck its opponent definition gives it.
	struct RaiderSeat {
		OpponentId					 opponent;
		std::optional<FormationSlot> slot;
		// Starts already flanking, on the player's shoulder in this row, which needs a player's vehicle in it
		// (Combat Rules, The road). An ambusher has no slot to drop back to.
		std::optional<Row> ambush;
	};

	// One of the convoy's escorts, in roster order, the order they joined it.
	struct EscortSeat {
		EscortId escort;
		// What it carries from earlier fights; full without one.
		std::optional<int> structure;
		// Where the encounter opens it; without one it takes its type's preferred slot, or the next free one.
		std::optional<FormationSlot> slot;
	};

	// Game stage runs 0 to 6, and each grows every raider's structure, and every raider's HP but a mook's, 5%
	// (Runs and Encounters, Game stage and Encounter data).
	inline constexpr int kMostStage = 6;
	inline constexpr int kStageGrowthPercent = 5;

	struct BattleSetup {
		// One or two, no driver twice.
		std::vector<PlayerSeat> players;
		// Up to four.
		std::vector<EscortSeat> escorts;
		// The first wave, on the road when the fight starts, in the order they act.
		std::vector<RaiderSeat> raiders;
		// The waves queued behind it, each pulling into the formation as it comes due (Combat Rules, Reinforcements).
		std::vector<EncounterWave> waves;
		// The most raiders on the road at once, which holds the rest of a due wave back; none for no cap.
		std::optional<int> roadCap;
		int				   stage{0};
		uint32_t		   seed{0};
	};

	struct BattleStart {
		BattleState		   state;
		std::vector<Event> events;
	};

	// A deck list's cards, unupgraded, in the order it lists them.
	[[nodiscard]] std::vector<BattleCard> cardsOf(std::span<const DeckEntry> deck);

	// Seats everyone, puts the vehicles on the road, queues the later waves, shuffles every deck on the road, and opens
	// the player's first turn, the opening deal and full adrenaline, for the raiders to plan. Throws
	// std::invalid_argument for a setup the rules refuse.
	[[nodiscard]] BattleStart startBattle(const BattleSetup& setup, const Content& content);

	// Why a card in hand can't be played at all right now, whatever it's played at: whose turn it is, the
	// driver's state, adrenaline, a passenger's attack, or a part of the card the rules don't play yet.
	[[nodiscard]] std::optional<std::string>
	cardBlocker(const BattleState& state, const Content& content, DriverIndex driver, int handIndex);

	// Why this action isn't legal now, or nullopt when it is.
	[[nodiscard]] std::optional<std::string> actionBlocker(const BattleState& state, const Content& content, const Action& action);

	// Every legal action, the plays in seat, hand, and target order, then EndTurn. Empty once the fight is over.
	[[nodiscard]] std::vector<Action> legalActions(const BattleState& state, const Content& content);

	// Throws std::invalid_argument for an action actionBlocker refuses.
	std::vector<Event> apply(BattleState& state, const Content& content, const Action& action);

} // namespace rules
