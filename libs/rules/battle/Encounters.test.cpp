#include <rules/battle/BattleTesting.h>
#include <rules/battle/Encounters.h>

#include <gtest/gtest.h>

#include <set>
#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const OpponentId kScavBike{"scav_bike"};

	std::vector<OpponentId> opponentsOf(const std::vector<RaiderSeat>& seats) {
		std::vector<OpponentId> opponents;
		for (const RaiderSeat& seat : seats) {
			opponents.push_back(seat.opponent);
		}
		return opponents;
	}

	TEST(Encounters, EveryFightStopHasTwoOrThreeToPickFromAtEveryTier) {
		for (int skulls = 1; skulls <= kMostSkulls; ++skulls) {
			for (int tier = 1; tier <= kMostTier; ++tier) {
				const size_t pool = encountersFor(testContent(), skulls, tier).size();
				EXPECT_TRUE(pool >= 2 && pool <= 3) << skulls << " skulls, tier " << tier << ": " << pool;
			}
		}

		EXPECT_EQ(pickEncounter(testContent(), 2, 3, 5), pickEncounter(testContent(), 2, 3, 5));
		std::set<EncounterId> picked;
		for (uint32_t seed = 0; seed < 40; ++seed) {
			picked.insert(pickEncounter(testContent(), 2, 3, seed));
		}
		EXPECT_EQ(picked.size(), encountersFor(testContent(), 2, 3).size()) << "the seed picks among all of them";
		EXPECT_THROW((void)pickEncounter(testContent(), 4, 1, 5), std::invalid_argument);
		EXPECT_THROW((void)pickEncounter(testContent(), 1, 0, 5), std::invalid_argument);
	}

	TEST(Encounters, GameStageQueuesGrowRaidersAndGrowsStructureAndHitpointsButAMooksHitpoints) {
		BattleSetup setup{.players = {seat("road_warrior"), seat("interceptor")}, .seed = 7};
		fieldEncounter(setup, testContent(), EncounterId{"scav_pack"}, 5);
		EXPECT_EQ(opponentsOf(setup.raiders), (std::vector{kScavBike, kScavBike, OpponentId{"rust_buggy"}}));
		ASSERT_EQ(setup.waves.size(), 1U);
		EXPECT_EQ(setup.waves[0].raiders, (std::vector{kScavBike, kScavBike, kScavBike, kScavBike})) << "two more at stage 5";
		EXPECT_EQ(setup.waves[0].arriveAt, 1);
		EXPECT_EQ(setup.waves[0].afterTurns, 3);
		EXPECT_EQ(setup.roadCap, 3);

		const BattleState state = startBattle(setup, testContent()).state;
		// 25% up, rounding half up: the bike's 12 structure to 15, the buggy's 30 structure and HP to 38.
		const BattleVehicle& bike = state.vehicle(VehicleIndex{2});
		EXPECT_EQ(bike.maxStructure, 15);
		EXPECT_EQ(state.driver(DriverIndex{2}).maxHitpoints, 5) << "a mook's HP doesn't grow";
		EXPECT_EQ(state.vehicle(VehicleIndex{4}).maxStructure, 38);
		EXPECT_EQ(state.driver(DriverIndex{4}).maxHitpoints, 38);
		const QueuedRaider& queued = state.reinforcements.queue.front().raiders.front();
		EXPECT_EQ(queued.vehicle.maxStructure, 15);
		EXPECT_EQ(queued.driver.hitpoints, 5);
		EXPECT_EQ(state.startingThreat, 8);
		EXPECT_EQ(state.reinforcements.total, 2);
	}

	TEST(Encounters, ALoneDriverMeetsHalfTheRaidersCutFromTheLastWave) {
		// The warband's 4, 3, and 3 to half of 10: the last wave goes and the second keeps one.
		BattleSetup solo{.players = {seat("mechanic")}, .seed = 7};
		fieldEncounter(solo, testContent(), EncounterId{"scav_warband"}, 0);
		EXPECT_EQ(solo.raiders.size(), 4U);
		ASSERT_EQ(solo.waves.size(), 1U);
		EXPECT_EQ(solo.waves[0].raiders, std::vector{kScavBike});

		// Never under four: the tail's 2 and 2 stay whole.
		fieldEncounter(solo, testContent(), EncounterId{"scav_tail"}, 0);
		EXPECT_EQ(solo.raiders.size(), 2U);
		ASSERT_EQ(solo.waves.size(), 1U);
		EXPECT_EQ(solo.waves[0].raiders.size(), 2U);

		EXPECT_THROW(fieldEncounter(solo, testContent(), EncounterId{"no_such_fight"}, 0), std::invalid_argument);
		EXPECT_THROW(fieldEncounter(solo, testContent(), EncounterId{"scav_tail"}, kMostStage + 1), std::invalid_argument);
	}

} // namespace
