#pragma once

// Shared by the battle tests: the base pack plus a few cards only tests play, and short ways to set a fight up.

#include <rules/battle/Battle.h>
#include <rules/battle/EnemyTurn.h>
#include <rules/battle/Policy.h>
#include <rules/core/Card.h>
#include <rules/packs/Pack.h>

#include <algorithm>
#include <filesystem>
#include <initializer_list>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace rules::fights {

	inline Content loadTestContent() {
		const std::vector<std::filesystem::path> roots{std::filesystem::path(DDB_PACKS_DIR) / "base"};
		Content									 content = loadPacks(roots);
		// Cards the base game doesn't have: a big free draw, a free sure hit, and one for both drivers.
		const auto add = [&](std::string_view json) {
			const nlohmann::json object = nlohmann::json::parse(json);
			CardDefinition		 card = readCard(JsonReader(object, "test card"));
			content.cards.emplace(card.id, std::move(card));
		};
		add(R"({"id": "test_draw", "name": "Test Draw", "summary": "Draw 4.", "description": "Draw 4 cards.",
			"rarity": "common", "cost": 0, "targetType": "self", "tags": ["utility"], "image": "",
			"effects": [{"type": "draw_cards", "value": 4, "target": "self"}]})");
		add(R"({"id": "test_slam", "name": "Test Slam", "summary": "Deal 10.", "description": "Deal 10 damage. Always hits.",
			"rarity": "common", "cost": 0, "targetType": "enemy_single", "tags": ["attack"], "image": "",
			"effects": [{"type": "damage", "value": 10, "alwaysHits": true, "target": "target"}]})");
		// A target type no base card uses, which the rules don't play yet.
		add(R"({"id": "test_pair", "name": "Test Pair", "summary": "Both gain 1.", "description": "Both drivers gain 1 armor.",
			"rarity": "common", "cost": 0, "targetType": "both_drivers", "tags": ["utility"], "image": "",
			"effects": [{"type": "gain_armor", "value": 1, "target": "self"}]})");
		return content;
	}

	inline const Content& testContent() {
		static const Content content = loadTestContent();
		return content;
	}

	inline PlayerSeat seat(std::string_view driver) {
		const DriverId id{std::string(driver)};
		return PlayerSeat{.driver = id, .deck = cardsOf(testContent().drivers.at(id).startingDeck), .slot = std::nullopt};
	}

	inline RaiderSeat raider(std::string_view opponent) {
		return RaiderSeat{.opponent = OpponentId{std::string(opponent)}, .slot = std::nullopt};
	}

	// Plans nothing: a raider that only ends its turn.
	struct Idle final : Policy {
		[[nodiscard]] Action choose(const BattleState&, const Content&, std::span<const Action>, foundation::Rng&) const override {
			return action::EndTurn{};
		}
	};

	// The first play on offer each time, until only the end of the turn is left.
	struct FirstOffered final : Policy {
		[[nodiscard]] Action choose(const BattleState&, const Content&, std::span<const Action> actions, foundation::Rng&) const override {
			return actions.front();
		}
	};

	// Every card it can play at `target`, or with no target, in hand order.
	struct AimAt final : Policy {
		std::optional<VehicleIndex> target;

		explicit AimAt(std::optional<int> vehicle)
			: target(vehicle ? std::optional(VehicleIndex{*vehicle}) : std::nullopt) {}

		[[nodiscard]] Action choose(const BattleState&, const Content&, std::span<const Action> actions, foundation::Rng&) const override {
			for (const Action& action : actions) {
				const auto* play = std::get_if<action::PlayCard>(&action);
				if (play && (!play->target || play->target == target)) {
					return action;
				}
			}
			return action::EndTurn{};
		}
	};

	// A card at each of `targets` in turn, one a step, then the end of its plan.
	struct AimEach final : Policy {
		std::vector<int> targets;
		mutable size_t	 next{0};

		explicit AimEach(std::vector<int> aimedAt)
			: targets(std::move(aimedAt)) {}

		[[nodiscard]] Action choose(const BattleState&, const Content&, std::span<const Action> actions, foundation::Rng&) const override {
			for (const Action& action : actions) {
				const auto* play = std::get_if<action::PlayCard>(&action);
				if (next < targets.size() && play && play->target == VehicleIndex{targets[next]}) {
					++next;
					return action;
				}
			}
			return action::EndTurn{};
		}
	};

	inline std::vector<Event> plan(BattleState& state, const Policy& policy) {
		return planEnemyTurn(state, testContent(), [&](const BattleState&, DriverIndex) -> const Policy& { return policy; });
	}

	// Plans again, for a test that has rigged a raider's hand since.
	inline std::vector<Event> replan(BattleState& state, const Policy& policy) {
		state.phase = Phase::Planning;
		return plan(state, policy);
	}

	inline void planIdle(BattleState& state) {
		static const Idle idle;
		(void)plan(state, idle);
	}

	// The fight's opening, with its raiders planning nothing.
	inline BattleStart fight(std::vector<PlayerSeat> players, std::vector<RaiderSeat> raiders, uint32_t seed = 7) {
		BattleStart start =
			startBattle(BattleSetup{.players = std::move(players), .raiders = std::move(raiders), .seed = seed}, testContent());
		planIdle(start.state);
		return start;
	}

	// The fight's opening with a convoy, in roster order, its raiders planning nothing.
	inline BattleStart convoy(std::vector<PlayerSeat> players, std::vector<std::string_view> escorts, std::vector<RaiderSeat> raiders) {
		std::vector<EscortSeat> seats;
		for (const std::string_view escort : escorts) {
			seats.push_back(EscortSeat{.escort = EscortId{std::string(escort)}, .structure = std::nullopt, .slot = std::nullopt});
		}
		BattleStart start = startBattle(
			BattleSetup{.players = std::move(players), .escorts = std::move(seats), .raiders = std::move(raiders), .seed = 7}, testContent()
		);
		planIdle(start.state);
		return start;
	}

	// The player's EndTurn and the enemy turn it plays, with the raiders' next turn planned idle.
	inline std::vector<Event> endTurn(BattleState& state) {
		std::vector<Event> events = apply(state, testContent(), action::EndTurn{});
		if (state.phase == Phase::Planning) {
			planIdle(state);
		}
		return events;
	}

	// Replaces a driver's hand, so a test plays the card it means to.
	inline void giveHand(BattleState& state, DriverIndex driver, std::initializer_list<std::string_view> cards) {
		std::vector<BattleCard>& hand = state.driver(driver).hand;
		hand.clear();
		for (const std::string_view card : cards) {
			hand.push_back(BattleCard{.card = CardId{std::string(card)}, .upgraded = false});
		}
	}

	inline action::PlayCard play(int driver, int handIndex, std::optional<int> target = std::nullopt) {
		return action::PlayCard{
			.driver = DriverIndex{driver},
			.handIndex = handIndex,
			.target = target ? std::optional(VehicleIndex{*target}) : std::nullopt,
			.occupant = std::nullopt,
		};
	}

	template <typename Kind>
	std::vector<Kind> eventsOf(const std::vector<Event>& events) {
		std::vector<Kind> found;
		for (const Event& event : events) {
			if (const auto* kind = std::get_if<Kind>(&event)) {
				found.push_back(*kind);
			}
		}
		return found;
	}

	// The raiders that committed a plan, in the order they planned.
	inline std::vector<DriverIndex> planners(const std::vector<Event>& events) {
		std::vector<DriverIndex> raiders;
		for (const event::PlanCommitted& committed : eventsOf<event::PlanCommitted>(events)) {
			raiders.push_back(committed.raider);
		}
		return raiders;
	}

	inline bool offers(const std::vector<Action>& actions, const Action& action) {
		return std::ranges::find(actions, action) != actions.end();
	}

} // namespace rules::fights
