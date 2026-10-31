#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/Infirmary.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	TEST(Infirmary, InjuryDaysAreTheHitpointsMissingOverTenRoundedUp) {
		const CompoundRules& rules = testRules().compound;
		EXPECT_EQ(injuryDays(40, 40, rules), 0);
		EXPECT_EQ(injuryDays(39, 40, rules), 1);
		EXPECT_EQ(injuryDays(1, 40, rules), 4);
		EXPECT_EQ(injuryDays(1, 25, rules), 3);
	}

	TEST(Infirmary, ARunHomeHurtGoesInAndMedsBuyDaysOff) {
		Campaign	 campaign = foundTestCampaign();
		const CrewId warrior = crewOf(campaign, "road_warrior");
		const CrewId interceptor = crewOf(campaign, "interceptor");
		startRun(campaign, testContent(), RunStart{.seats = {warrior, interceptor}});
		campaign.driver(warrior).hitpoints = 1;

		const Unloaded home = unloadRun(campaign, testContent(), testRules());
		EXPECT_EQ(home.injuries, (std::vector{Injury{.driver = warrior, .hitpointsMissing = 39, .days = 4}}));
		EXPECT_EQ(campaign.driver(warrior).status, DriverStatus::Injured);
		EXPECT_EQ(campaign.driver(interceptor).status, DriverStatus::Ready) << "nothing missing, nothing to heal";
		EXPECT_EQ(campaign.tally.runsHome, 1);
		EXPECT_EQ(seatBlocker(campaign, warrior, std::nullopt), (SeatBlocker{.reason = SeatRefusal::Injured, .injuredDays = 4}));

		const CompoundRules& rules = testRules().compound;
		EXPECT_EQ(treatmentBlocker(campaign, rules, warrior, 5), (TreatmentBlocker{.reason = TreatmentRefusal::TooManyDays, .count = 4}));
		EXPECT_EQ(treatmentBlocker(campaign, rules, warrior, 4), (TreatmentBlocker{.reason = TreatmentRefusal::TooFewMeds, .count = 4}));
		EXPECT_EQ(treatmentBlocker(campaign, rules, interceptor, 1), (TreatmentBlocker{.reason = TreatmentRefusal::NotInjured}));
		EXPECT_THROW(treatDriver(campaign, testContent(), rules, warrior, 4), std::invalid_argument);

		treatDriver(campaign, testContent(), rules, warrior, 3);
		EXPECT_EQ(campaign.stores.meds, 0);
		EXPECT_EQ(campaign.driver(warrior).injuredDays, 1);
		(void)endDay(campaign, testContent(), testRules());
		EXPECT_EQ(campaign.driver(warrior).status, DriverStatus::Ready) << "the night takes the last day";
		EXPECT_EQ(campaign.driver(warrior).hitpoints, 40);
	}

} // namespace
