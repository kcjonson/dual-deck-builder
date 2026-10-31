#pragma once

// What the scenes call things on screen: names from the packs and words for the rules' reasons. Nothing here decides
// anything; each refusal is the rules' own blocker, worded.

#include "MapJob.h"

#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleState.h>
#include <rules/battle/EnemyTurn.h>
#include <rules/campaign/Campaign.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/EventStops.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>
#include <rules/core/JsonReader.h>
#include <rules/map/StopData.h>
#include <rules/packs/Pack.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace game {

	// An enum value's name in the rules' table for it, which every enum the save writes has.
	template <typename Enum, size_t Count>
	[[nodiscard]] std::string_view nameOf(const rules::EnumNames<Enum, Count>& names, Enum value) {
		const auto named = std::ranges::find(names, value, &std::pair<std::string_view, Enum>::second);
		if (named == names.end()) {
			throw std::logic_error("nameOf: a value its table doesn't name");
		}
		return named->first;
	}

	// "1 driver", "3 drivers".
	[[nodiscard]] std::string counted(int count, std::string_view one, std::string_view many);

	// "Making the area map: water (2 of 9)".
	[[nodiscard]] std::string progressText(const MapProgress& progress);

	// "Food 20 - Water 18 - Fuel 6 - Meds 2 - Scrap 40 - People 12".
	[[nodiscard]] std::string storesText(const rules::campaign::Resources& resources);
	// "2 fuel and 12 scrap", or "nothing".
	[[nodiscard]] std::string amountsText(const rules::campaign::Resources& resources);

	// "Road Warrior 2" and how they stand: "ready, 30/30 HP", "injured, fit in 2 days", "dead".
	[[nodiscard]] std::string
	driverStanding(const rules::campaign::Campaign& campaign, const rules::Content& content, const rules::campaign::DriverRecord& driver);

	// A stop as a run meets it: "Ambush, 2 skulls", "Find: supplies", "Wreck".
	[[nodiscard]] std::string stopText(const rules::map::Stop& stop);

	[[nodiscard]] std::string seatRefusalText(const rules::campaign::SeatBlocker& blocker);
	[[nodiscard]] std::string departRefusalText(const rules::campaign::DepartBlocker& blocker);
	[[nodiscard]] std::string scavengeRefusalText(rules::campaign::ScavengeRefusal refusal);
	[[nodiscard]] std::string choiceRefusalText(
		const rules::campaign::ChoiceBlocker& blocker,
		const rules::campaign::EventNeeds&	  needs,
		const rules::Content&				  content
	);

	// A card by its pack name, "Ram (2)" with its adrenaline cost.
	[[nodiscard]] std::string cardText(const rules::Content& content, const rules::CardId& card);

	// A fight's side of things: who a driver or a vehicle is, a play's target, and a raider's intent.
	[[nodiscard]] std::string fighterName(const rules::BattleState& state, const rules::Content& content, rules::DriverIndex driver);
	[[nodiscard]] std::string vehicleName(const rules::BattleState& state, const rules::Content& content, rules::VehicleIndex vehicle);
	[[nodiscard]] std::string playText(const rules::BattleState& state, const rules::Content& content, const rules::action::PlayCard& play);
	[[nodiscard]] std::string intentText(const rules::BattleState& state, const rules::Content& content, const rules::Intent& intent);
	[[nodiscard]] std::string outcomeText(rules::Outcome outcome);

} // namespace game
