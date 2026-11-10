// The combat log's lines (combat-log-content.md) over real fights: each says something, names everyone the way the road
// does, never by seat or id, and between them the fights' lines cover a play of each side's, a hit, a miss, a wreck when
// there was one, the fight's end when it came, and each turn change tagged with the turn it opens.

#include "scenes/battle/BattleLog.h"
#include "scenes/battle/FightTesting.h"

#include <algorithm>
#include <cstdint>
#include <string>
#include <variant>
#include <vector>

namespace {

	using namespace game::battle;
	using namespace game::testing;
	namespace event = rules::event;

	bool has(const std::vector<LogLine>& lines, LogTone tone, const std::string& words) {
		return std::ranges::any_of(lines, [&](const LogLine& line) {
			return line.tone == tone && line.text.find(words) != std::string::npos;
		});
	}

	// What the screen pops MISS for: a hit check that missed, a raider's step that fizzled, a target out of reach.
	bool missed(const rules::Event& happened) {
		const auto* check = std::get_if<event::HitChecked>(&happened);
		return (check != nullptr && !check->hit) || std::holds_alternative<event::PlannedStepFizzled>(happened) ||
			   std::holds_alternative<event::OutOfRange>(happened);
	}

	TEST(BattleLog, APlayedFightsLinesSaySomethingInThePlayersWordsAndCoverWhatHappened) {
		std::vector<LogLine> all;
		bool				 wrecked = false;
		bool				 ended = false;
		bool				 misses = false;
		for (const uint32_t seed : {1U, 2U, 3U, 4U, 5U, 6U}) {
			playFight(seed, 6, [&](const Played& played) {
				const std::vector<LogLine> lines = logLines(played.after, testRules().content, played.events, played.before.turn, kSeats);
				for (const LogLine& line : lines) {
					EXPECT_FALSE(line.text.empty());
					EXPECT_EQ(line.text.find('_'), std::string::npos) << "a raw id in: " << line.text;
					EXPECT_EQ(line.text.find("Driver "), std::string::npos) << "a seat in: " << line.text;
					EXPECT_GE(line.turn, played.before.turn) << line.text;
					EXPECT_LE(line.turn, played.after.turn) << line.text;
				}
				for (const rules::Event& happened : played.events) {
					wrecked = wrecked || std::holds_alternative<event::VehicleWrecked>(happened);
					ended = ended || std::holds_alternative<event::FightEnded>(happened);
					misses = misses || missed(happened);
					if (const auto* started = std::get_if<event::TurnStarted>(&happened)) {
						const std::string words = started->side == rules::Side::Player ? "Your turn." : "The raiders' turn.";
						EXPECT_TRUE(
							std::ranges::any_of(
								lines,
								[&](const LogLine& line) {
									return line.text == words && line.tone == LogTone::Turn && line.turn == started->turn;
								}
							)
						) << words
						  << " tagged " << started->turn;
					}
				}
				all.insert(all.end(), lines.begin(), lines.end());
			});
		}
		EXPECT_TRUE(has(all, LogTone::Player, "Road Warrior 1 plays ")) << "a play of yours, by driver";
		EXPECT_TRUE(has(all, LogTone::Player, "Interceptor 2 plays "));
		EXPECT_TRUE(has(all, LogTone::Raider, "'s vehicle plays ")) << "a raider's play, by vehicle";
		EXPECT_TRUE(has(all, LogTone::Hit, " hits ")) << "a hit";
		EXPECT_TRUE(has(all, LogTone::Raider, " pulls in to ")) << "an arrival";
		EXPECT_TRUE(misses) << "the fights had a miss";
		EXPECT_EQ(has(all, LogTone::Miss, ""), misses);
		EXPECT_EQ(has(all, LogTone::Hit, " is wrecked."), wrecked);
		EXPECT_EQ(has(all, LogTone::Outcome, "Fight "), ended);
	}

	TEST(BattleLog, AHitSaysWhereItWentAMissWhyAndADeathMarkWhoItTookOnce) {
		const rules::BattleState		state = fieldFight(1);
		const rules::DriverIndex		roadWarrior{0};
		const rules::DriverIndex		raider{2};
		const rules::VehicleIndex		rig{0};
		const rules::VehicleIndex		raiders{2};
		const std::vector<rules::Event> events{
			event::CardPlayed{.driver = raider, .card = {.card = rules::CardId{"ram"}}, .target = rig, .cost = 1},
			event::HitChecked{.attacker = raiders, .defender = rig, .attackType = rules::AttackType::Ramming, .skill = 3, .evade = 5},
			event::VehicleDamaged{.vehicle = rig, .damage = 7, .shield = 1, .armor = 2, .structure = 2},
			event::DriverDamaged{.driver = roadWarrior, .hitpoints = 2},
			event::DeathMarkTaken{.vehicle = raiders, .driver = raider},
			event::DriverDamaged{.driver = raider, .hitpoints = 9},
			event::DriverDown{.driver = raider},
		};
		const std::vector<LogLine> lines = logLines(state, testRules().content, events, state.turn, kSeats);
		ASSERT_EQ(lines.size(), 5U);
		EXPECT_EQ(lines[0].tone, LogTone::Raider);
		EXPECT_EQ(lines[1].text, "Ram misses Road Warrior 1's vehicle: ramming 3 against evade 5.");
		EXPECT_EQ(lines[1].tone, LogTone::Miss);
		EXPECT_EQ(lines[2].text, "Ram hits Road Warrior 1's vehicle for 7: 1 to shield, 2 to armor, 2 to structure, 2 to Road Warrior 1.");
		EXPECT_EQ(lines[2].tone, LogTone::Hit);
		EXPECT_TRUE(lines[3].text.starts_with("The death mark on ")) << lines[3].text;
		EXPECT_TRUE(lines[4].text.ends_with(" is dead.")) << lines[4].text;
	}

} // namespace
