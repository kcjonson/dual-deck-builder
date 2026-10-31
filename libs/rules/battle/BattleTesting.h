#pragma once

// Shared by the battle tests: the base pack plus a few cards only tests play, and short ways to set a fight up.

#include <rules/battle/Battle.h>
#include <rules/core/Card.h>
#include <rules/packs/Pack.h>

#include <algorithm>
#include <filesystem>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace rules::fights {

	inline Content loadTestContent() {
		const std::vector<std::filesystem::path> roots{std::filesystem::path(DDB_PACKS_DIR) / "base"};
		Content									 content = loadPacks(roots);
		// Cards the base game doesn't have: a big free draw, and a free sure hit.
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

	inline BattleStart fight(std::vector<PlayerSeat> players, std::vector<RaiderSeat> raiders, uint32_t seed = 7) {
		return startBattle(BattleSetup{.players = std::move(players), .raiders = std::move(raiders), .seed = seed}, testContent());
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

	inline bool offers(const std::vector<Action>& actions, const Action& action) {
		return std::ranges::find(actions, action) != actions.end();
	}

} // namespace rules::fights
