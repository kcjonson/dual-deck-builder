// How Words names a fight's raiders: a number when the fight has more than one of a kind, kept for the whole fight, the
// same on the plate, in the log and in a play's target, and a lone raider without one.

#include "Words.h"
#include "GameTesting.h"
#include "road/RoadPicture.h"
#include "scenes/battle/BattleLog.h"
#include "scenes/battle/FightTesting.h"

#include <rules/battle/Battle.h>
#include <rules/battle/Waves.h>

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

namespace {

	using namespace game;
	using rules::BattleState;
	using rules::DriverIndex;
	using rules::VehicleIndex;

	const rules::Content& content() {
		return game::testing::testRules().content;
	}

	// The raiders of one kind in the order the fight seated them.
	std::vector<DriverIndex> raidersOf(const BattleState& state, const char* opponent) {
		std::vector<DriverIndex> found;
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			const auto* profile = std::get_if<rules::OpponentId>(&state.drivers[static_cast<size_t>(index)].profile);
			if (profile != nullptr && profile->value == opponent) {
				found.push_back(DriverIndex{index});
			}
		}
		return found;
	}

	VehicleIndex vehicleOf(const BattleState& state, DriverIndex driver) {
		return rules::vehicleCarrying(state, driver).value();
	}

	// Two Scavengers and a lone Rust Buggy.
	BattleState packFight() {
		return game::testing::fieldFight(3);
	}

	TEST(Words, TwoRaidersOfAKindAreNumberedOnThePlateInTheLogAndInAPlaysTarget) {
		const BattleState state = packFight();
		const auto		  scavs = raidersOf(state, "scav_bike");
		ASSERT_EQ(scavs.size(), 2U);
		EXPECT_EQ(fighterName(state, content(), scavs[0], game::testing::kSeats), "Scavenger 1");
		EXPECT_EQ(fighterName(state, content(), scavs[1], game::testing::kSeats), "Scavenger 2");

		EXPECT_EQ(road::tokenData(state, content(), vehicleOf(state, scavs[1]), {}, game::testing::kSeats).name, "Scavenger 2");
		EXPECT_EQ(road::tokenData(state, content(), vehicleOf(state, scavs[0]), {}, game::testing::kSeats).name, "Scavenger 1");

		const battle::LogLine matchup = battle::matchupLine(state, content(), game::testing::kSeats);
		EXPECT_NE(matchup.text.find("Scavenger 1, Scavenger 2"), std::string::npos) << matchup.text;

		const rules::action::PlayCard play{.driver = DriverIndex{0}, .handIndex = 0, .target = vehicleOf(state, scavs[1])};
		EXPECT_EQ(playText(state, content(), play, game::testing::kSeats), "at Scavenger 2's vehicle");
	}

	TEST(Words, ALoneRaiderHasNoNumber) {
		const BattleState state = packFight();
		const auto		  buggies = raidersOf(state, "rust_buggy");
		ASSERT_EQ(buggies.size(), 1U);
		const std::string name = fighterName(state, content(), buggies[0], game::testing::kSeats);
		EXPECT_EQ(name.find_first_of("0123456789"), std::string::npos) << name;
		EXPECT_EQ(vehicleName(state, content(), vehicleOf(state, buggies[0]), game::testing::kSeats), name + "'s vehicle");
	}

	TEST(Words, ANumberSurvivesADeathAndAWaveTakesTheNextOnes) {
		BattleState state = packFight();
		const auto	first = raidersOf(state, "scav_bike");
		ASSERT_EQ(first.size(), 2U);

		state.vehicle(vehicleOf(state, first[0])).structure = 0;
		state.driver(first[0]).hitpoints = 0;
		EXPECT_EQ(fighterName(state, content(), first[1], game::testing::kSeats), "Scavenger 2") << "the other one's death changes nothing";

		state.reinforcements.due = true;
		std::vector<rules::Event> events;
		rules::landWave(state, events);
		const auto all = raidersOf(state, "scav_bike");
		ASSERT_GT(all.size(), 2U) << "the wave brought another Scavenger";
		EXPECT_EQ(fighterName(state, content(), all[1], game::testing::kSeats), "Scavenger 2");
		EXPECT_EQ(fighterName(state, content(), all[2], game::testing::kSeats), "Scavenger 3");
	}

	TEST(Words, ACardWithNoTargetSaysNothingAfterItsName) {
		const BattleState state = packFight();
		EXPECT_EQ(playText(state, content(), {.driver = DriverIndex{0}, .handIndex = 0}, game::testing::kSeats), "");
	}

	TEST(Words, ARaidersIntentNamesItsStatusesAsPlayersReadThem) {
		const BattleState state = packFight();
		rules::Intent	  intent{.kind = rules::IntentKind::Move};
		intent.statuses.push_back(rules::Status::SpeedBoost);
		const std::string text = intentText(state, content(), intent, game::testing::kSeats);
		EXPECT_NE(text.find("Speed boost"), std::string::npos) << text;
		EXPECT_EQ(text.find('_'), std::string::npos) << text;
	}

} // namespace
