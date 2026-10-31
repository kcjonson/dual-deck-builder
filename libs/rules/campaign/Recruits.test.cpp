#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <set>
#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	TEST(Recruits, ARecruitJoinsThePoolFitWithTheirStartingDeckAndANumberedName) {
		Campaign	 campaign = foundTestCampaign();
		const CrewId first = crewOf(campaign, "mechanic");
		const CrewId second = recruitDriver(campaign, testContent(), DriverId{"mechanic"});
		EXPECT_EQ(second, CrewId{"driver-4"});
		EXPECT_EQ(campaign.nextDriverNumber, 5);
		EXPECT_EQ(
			campaign.driver(second),
			(DriverRecord{
				.id = second,
				.archetype = DriverId{"mechanic"},
				.status = DriverStatus::Ready,
				.hitpoints = 30,
				.injuredDays = 0,
				.vehicle = {.structure = 60, .armor = 5},
				.defaultDeck = campaign.driver(first).defaultDeck,
			})
		) << "the founding Mechanic's deck is the starting deck too";
		EXPECT_EQ(driverName(campaign, testContent(), second), "Mechanic 2");
		EXPECT_EQ(driverName(campaign, testContent(), crewOf(campaign, "road_warrior")), "Road Warrior 1");
		EXPECT_THROW((void)recruitDriver(campaign, testContent(), DriverId{"war_boy"}), std::invalid_argument);
	}

	TEST(Recruits, AFindTurnsUpTheMissingFirstThenSomeoneNewAndBothRideHomeOrAreLostWithTheRun) {
		Campaign	 campaign = foundTestCampaign();
		const CrewId warrior = crewOf(campaign, "road_warrior");
		const CrewId interceptor = crewOf(campaign, "interceptor");
		const CrewId mechanic = crewOf(campaign, "mechanic");
		(void)recruitDriver(campaign, testContent(), DriverId{"road_warrior"});
		(void)recruitDriver(campaign, testContent(), DriverId{"mechanic"});
		// The Interceptor crashed out of a run that failed, at 15 HP, their bike a wreck.
		DriverRecord& lost = campaign.driver(interceptor);
		lost.status = DriverStatus::Missing;
		lost.hitpoints = 15;
		lost.vehicle = VehicleCondition{.structure = 1, .armor = 0};
		startRun(campaign, testContent(), RunStart{.seats = {warrior, mechanic}});

		const std::vector<DriverId> unlocked = unlockedAtStart(testContent());
		EXPECT_EQ(whoIsFound(campaign, testContent(), unlocked, 5), (FoundDriver{interceptor}));
		takeFoundDriver(campaign, testContent(), interceptor);
		EXPECT_THROW(takeFoundDriver(campaign, testContent(), interceptor), std::invalid_argument) << "found already";
		EXPECT_THROW(takeFoundDriver(campaign, testContent(), warrior), std::invalid_argument) << "not missing";
		EXPECT_EQ(whoIsFound(campaign, testContent(), unlocked, 5), (FoundDriver{DriverId{"interceptor"}}))
			<< "two Road Warriors, two Mechanics, and one Interceptor, missing or not (call 211)";
		takeFoundDriver(campaign, testContent(), DriverId{"interceptor"});
		std::set<DriverId> drawn;
		for (uint32_t seed = 0; seed < 20; ++seed) {
			drawn.insert(std::get<DriverId>(whoIsFound(campaign, testContent(), unlocked, seed)));
		}
		EXPECT_EQ(drawn.size(), 3U) << "two of each, the recruit riding home counted, so any of them";
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);
		EXPECT_THROW(giveUpLoadOut(campaign), std::invalid_argument) << "it picked someone up, so it left";

		// Lost, the run loses them both: the Interceptor stays missing, and nobody new joins (calls 43 and 212).
		Campaign	  failing = campaign;
		CampaignFight fight = startCampaignFight(failing, testContent(), EncounterId{"scav_tail"}).fight;
		fight.state.driver(DriverIndex{0}).hitpoints = 0;
		fight.state.driver(DriverIndex{1}).hitpoints = 0;
		fight.state.phase = Phase::Over;
		fight.state.outcome = Outcome::Lost;
		const FightWriteBack written = writeBackFight(failing, testContent(), testRules(), fight);
		EXPECT_EQ(written.lost->found, std::vector{interceptor});
		EXPECT_EQ(written.lost->recruits, std::vector{DriverId{"interceptor"}});
		EXPECT_EQ(failing.driver(interceptor).status, DriverStatus::Missing);
		EXPECT_EQ(failing.drivers.size(), campaign.drivers.size());

		// Home, the Interceptor is back in the infirmary for the 10 HP they're missing, their bike at 1 structure (call
		// 41), and someone new joins the pool.
		const Unloaded home = unloadRun(campaign, testContent(), testRules());
		EXPECT_EQ(home.found, std::vector{interceptor});
		EXPECT_EQ(home.injuries, (std::vector{Injury{.driver = interceptor, .hitpointsMissing = 10, .days = 1}}));
		const DriverRecord& back = campaign.driver(interceptor);
		EXPECT_EQ(back.status, DriverStatus::Injured);
		EXPECT_EQ(back.vehicle, (VehicleCondition{.structure = kLimpStructure, .armor = 0}));
		ASSERT_EQ(home.recruited.size(), 1U);
		const DriverRecord& recruit = campaign.driver(home.recruited.front());
		EXPECT_EQ(recruit.archetype, DriverId{"interceptor"});
		EXPECT_EQ(recruit.hitpoints, 25);
		EXPECT_EQ(recruit.status, DriverStatus::Ready);
		EXPECT_EQ(campaign.log.back().text, "Interceptor 2 joined the compound, found on the road.");
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);
	}

} // namespace
