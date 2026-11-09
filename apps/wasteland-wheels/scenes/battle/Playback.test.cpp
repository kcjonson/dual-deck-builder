// The fight played back (Playback.h, enemy-turn-pacing.md) over real fights: a play is one beat that settles; an end turn
// opens the raiders' turn at once, lands each beat on the pacing's times and ends on the player's turn or the fight's
// end, losing no event; between beats the bars are the fight before less what has landed; and the mirror, run over
// every event, ends where the rules did.

#include "scenes/battle/Playback.h"
#include "scenes/battle/FightTesting.h"

#include <algorithm>
#include <cstdint>
#include <span>
#include <utility>
#include <variant>
#include <vector>

namespace {

	using namespace game::battle;
	using namespace game::testing;
	using rules::BattleState;
	using rules::Event;
	namespace event = rules::event;

	constexpr double kStep = 0.05;

	template <typename Wanted>
	bool has(std::span<const Event> events) {
		return std::ranges::any_of(events, [](const Event& happened) { return std::holds_alternative<Wanted>(happened); });
	}

	bool startsTurn(std::span<const Event> events, rules::Side side) {
		return std::ranges::any_of(events, [&](const Event& happened) {
			const auto* started = std::get_if<event::TurnStarted>(&happened);
			return started != nullptr && started->side == side;
		});
	}

	// The bars `before` had, less what the landed hits and clears took and plus what was gained, against the picture's.
	void expectBarsFollow(const BattleState& before, std::span<const Event> landed, const BattleState& picture) {
		for (int index = 0; index < static_cast<int>(before.vehicles.size()); ++index) {
			const rules::VehicleIndex vehicle{index};
			int						  shield = before.vehicle(vehicle).shield;
			int						  armor = before.vehicle(vehicle).armor;
			int						  structure = before.vehicle(vehicle).structure;
			for (const Event& happened : landed) {
				if (const auto* hit = std::get_if<event::VehicleDamaged>(&happened); hit && hit->vehicle == vehicle) {
					shield -= hit->shield;
					armor -= hit->armor;
					structure -= hit->structure;
				} else if (const auto* cleared = std::get_if<event::ShieldCleared>(&happened); cleared && cleared->vehicle == vehicle) {
					shield -= cleared->shield;
				} else if (const auto* gained = std::get_if<event::ShieldGained>(&happened); gained && gained->vehicle == vehicle) {
					shield += gained->shield;
				} else if (const auto* plated = std::get_if<event::ArmorGained>(&happened); plated && plated->vehicle == vehicle) {
					armor += plated->armor;
				} else if (const auto* repaired = std::get_if<event::Repaired>(&happened); repaired && repaired->vehicle == vehicle) {
					structure += repaired->structure;
					armor += repaired->armor;
				}
			}
			EXPECT_EQ(picture.vehicle(vehicle).shield, shield) << "vehicle " << index;
			EXPECT_EQ(picture.vehicle(vehicle).armor, armor) << "vehicle " << index;
			EXPECT_EQ(picture.vehicle(vehicle).structure, structure) << "vehicle " << index;
		}
		for (int index = 0; index < static_cast<int>(before.drivers.size()); ++index) {
			const rules::DriverIndex driver{index};
			int						 hitpoints = before.driver(driver).hitpoints;
			for (const Event& happened : landed) {
				if (const auto* hurt = std::get_if<event::DriverDamaged>(&happened); hurt && hurt->driver == driver) {
					hitpoints -= hurt->hitpoints;
				} else if (const auto* healed = std::get_if<event::DriverHealed>(&happened); healed && healed->driver == driver) {
					hitpoints += healed->hitpoints;
				}
			}
			EXPECT_EQ(picture.driver(driver).hitpoints, hitpoints) << "driver " << index;
		}
	}

	std::vector<std::pair<rules::Status, int>> statusesOf(const rules::BattleVehicle& vehicle) {
		std::vector<std::pair<rules::Status, int>> statuses;
		for (const rules::VehicleStatus& status : vehicle.statuses) {
			statuses.emplace_back(status.status, status.value);
		}
		std::ranges::sort(statuses);
		return statuses;
	}

	// The picture every event moves `before` to, against the fight the rules left, on everything the road shows.
	void expectMirrorEndsWhereTheRulesDid(const Played& played) {
		BattleState picture = played.before;
		for (const Event& happened : played.events) {
			mirror(picture, happened, played.after);
		}
		ASSERT_EQ(picture.vehicles.size(), played.after.vehicles.size());
		ASSERT_EQ(picture.drivers.size(), played.after.drivers.size());
		for (size_t index = 0; index < picture.vehicles.size(); ++index) {
			const rules::BattleVehicle& shown = picture.vehicles[index];
			const rules::BattleVehicle& real = played.after.vehicles[index];
			EXPECT_EQ(shown.structure, real.structure) << "vehicle " << index;
			EXPECT_EQ(shown.armor, real.armor) << "vehicle " << index;
			EXPECT_EQ(shown.shield, real.shield) << "vehicle " << index;
			EXPECT_EQ(shown.slot, real.slot) << "vehicle " << index;
			EXPECT_EQ(shown.onRoad, real.onRoad) << "vehicle " << index;
			EXPECT_EQ(shown.flank.has_value(), real.flank.has_value()) << "vehicle " << index;
			EXPECT_EQ(shown.driver, real.driver) << "vehicle " << index;
			EXPECT_EQ(shown.passenger, real.passenger) << "vehicle " << index;
			EXPECT_EQ(shown.isEscort(), real.isEscort()) << "vehicle " << index;
			EXPECT_EQ(statusesOf(shown), statusesOf(real)) << "vehicle " << index;
		}
		for (size_t index = 0; index < picture.drivers.size(); ++index) {
			EXPECT_EQ(picture.drivers[index].hitpoints, played.after.drivers[index].hitpoints) << "driver " << index;
			EXPECT_EQ(picture.drivers[index].crashedOut, played.after.drivers[index].crashedOut) << "driver " << index;
		}
		EXPECT_EQ(picture.turn, played.after.turn);
		EXPECT_EQ(picture.outcome, played.after.outcome);
	}

	// Plays `played` back in frame steps, checking where each beat lands and the bars between them.
	void expectPacedPlayback(const Played& played) {
		Playback playback;
		playback.start(played.before, played.after, played.events);
		ASSERT_TRUE(playback.playing());
		std::vector<std::pair<double, Beat>> seen;
		std::vector<Event>					 landed;
		double								 now = 0.0;
		std::vector<Beat>					 beats = playback.advance(0.0);
		while (true) {
			for (Beat& beat : beats) {
				landed.insert(landed.end(), beat.events.begin(), beat.events.end());
				seen.emplace_back(now, std::move(beat));
			}
			if (!playback.playing()) {
				break;
			}
			expectBarsFollow(played.before, landed, playback.shown());
			ASSERT_LT(now, 30.0) << "a turn plays out in seconds";
			now += kStep;
			beats = playback.advance(kStep);
		}

		ASSERT_FALSE(seen.empty());
		EXPECT_EQ(landed, played.events) << "every event lands once, in order";
		EXPECT_EQ(playback.shown().vehicles, played.after.vehicles) << "settled, it shows the fight";
		for (size_t index = 0; index < seen.size(); ++index) {
			EXPECT_EQ(seen[index].second.settles, index + 1 == seen.size()) << "beat " << index;
		}
		const Beat& last = seen.back().second;
		const bool	over = played.after.phase == rules::Phase::Over;
		EXPECT_EQ(has<event::FightEnded>(last.events), over);

		if (!played.endTurn || !startsTurn(played.events, rules::Side::Raiders)) {
			ASSERT_EQ(seen.size(), 1U) << "a play, or an end turn the fight ends before the raiders' turn, is one beat";
			EXPECT_DOUBLE_EQ(seen.front().first, 0.0);
			return;
		}
		EXPECT_DOUBLE_EQ(seen.front().first, 0.0);
		EXPECT_EQ(seen.front().second.opens, rules::Side::Raiders);
		EXPECT_FALSE(seen.front().second.acting.has_value());
		for (size_t index = 1; index < seen.size(); ++index) {
			const double due = kEnemyLeadIn + static_cast<double>(index - 1) * kEnemyBeat;
			EXPECT_GE(seen[index].first, due - 1e-6) << "beat " << index;
			EXPECT_LT(seen[index].first, due + kStep + 1e-6) << "beat " << index;
			const Beat& beat = seen[index].second;
			if (beat.acting) {
				EXPECT_TRUE(
					std::ranges::any_of(
						beat.events,
						[&](const Event& happened) {
							const auto* acting = std::get_if<event::RaiderActing>(&happened);
							return acting != nullptr && acting->raider == *beat.acting;
						}
					)
				) << "beat "
				  << index << " glows the raider acting in it";
			}
			EXPECT_EQ(beat.opens.has_value(), index + 1 == seen.size() && !over) << "beat " << index;
		}
		if (!over) {
			EXPECT_EQ(last.opens, rules::Side::Player);
			EXPECT_TRUE(startsTurn(last.events, rules::Side::Player));
		}
	}

	TEST(Playback, EveryActionPlaysBackOnItsBeatsAndTheMirrorEndsWhereTheRulesDid) {
		int endTurns = 0;
		int raiderBeats = 0;
		for (const uint32_t seed : {1U, 2U, 3U}) {
			playFight(seed, 6, [&](const Played& played) {
				SCOPED_TRACE(::testing::Message() << "seed " << seed << ", turn " << played.before.turn);
				expectPacedPlayback(played);
				expectMirrorEndsWhereTheRulesDid(played);
				endTurns += played.endTurn ? 1 : 0;
				raiderBeats += played.endTurn && has<event::RaiderActing>(played.events) ? 1 : 0;
			});
		}
		EXPECT_GE(endTurns, 6);
		EXPECT_GT(raiderBeats, 0) << "the fights had raiders acting";
	}

	TEST(Playback, NoEventsMakeNoBeatsAndShowTheFight) {
		const BattleState before = fieldFight(4);
		BattleState		  after = before;
		after.turn = 9;
		Playback playback;
		playback.start(before, after, {});
		EXPECT_FALSE(playback.playing());
		EXPECT_EQ(playback.shown().turn, 9);
		EXPECT_TRUE(playback.advance(0.0).empty());
	}

	TEST(Playback, ARaiderStunnedOrDroppingItsPlanRidesWithTheNextBeatAndAStartLandsWhatWasPlaying) {
		const BattleState		 state = fieldFight(5);
		const rules::DriverIndex first{2};
		const rules::DriverIndex second{3};
		const rules::DriverIndex third{4};
		const std::vector<Event> events{
			event::TurnStarted{.turn = 1, .side = rules::Side::Raiders},
			event::RaiderStunned{.raider = first},
			event::RaiderActing{.raider = second},
			event::CardPlayed{.driver = second, .card = {.card = rules::CardId{"ram"}}, .cost = 1},
			event::PlanDropped{.raider = third},
			event::TurnStarted{.turn = 2, .side = rules::Side::Player},
		};
		Playback playback;
		playback.start(state, state, events);
		ASSERT_EQ(playback.advance(0.0).size(), 1U);
		EXPECT_TRUE(playback.advance(kEnemyLeadIn - 0.1).empty());
		const std::vector<Beat> raider = playback.advance(0.1);
		ASSERT_EQ(raider.size(), 1U);
		EXPECT_EQ(raider.front().acting, second);
		EXPECT_EQ(raider.front().events.size(), 3U) << "the stun ahead of it rides with it";
		const std::vector<Beat> turn = playback.advance(kEnemyBeat);
		ASSERT_EQ(turn.size(), 1U);
		EXPECT_EQ(turn.front().events.size(), 2U) << "the dropped plan rides with the player's turn";
		EXPECT_TRUE(turn.front().settles);
		EXPECT_FALSE(playback.playing());

		playback.start(state, state, events);
		(void)playback.advance(0.0);
		BattleState later = state;
		later.turn = 7;
		playback.start(state, later, {event::TurnStarted{.turn = 7, .side = rules::Side::Player}});
		EXPECT_EQ(playback.advance(0.0).size(), 1U) << "the turn still playing landed, and the new play is its own beat";
		EXPECT_EQ(playback.shown().turn, 7);
	}

} // namespace
