#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/Locker.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	DayEnd rest(Campaign& campaign) {
		return endDay(campaign, testContent(), testRules());
	}

	TEST(DayClock, ANightFeedsThePeopleAtDuskAndEachUnitShortCostsAPersonAndUnrest) {
		Campaign campaign = foundTestCampaign();
		DayEnd	 night = rest(campaign);
		EXPECT_EQ(night.day, 1);
		EXPECT_EQ(night.upkeep, (Resources{.food = 3, .water = 3})) << "12 people, one of each per 4";
		EXPECT_EQ(night.shortfall, Resources{});
		EXPECT_EQ(campaign.stores.food, 18);
		EXPECT_EQ(campaign.day, 2);
		EXPECT_EQ(campaign.log.size(), 1U) << "a fed night writes nothing";

		campaign.stores.food = 1;
		campaign.stores.water = 0;
		night = rest(campaign);
		EXPECT_EQ(night.shortfall, (Resources{.food = 2, .water = 3}));
		EXPECT_EQ(night.peopleLost, 5);
		EXPECT_EQ(night.unrestGained, 5);
		EXPECT_EQ(campaign.stores.people, 7);
		EXPECT_EQ(campaign.stores.food, 0);
		EXPECT_EQ(campaign.unrest, 5);
		EXPECT_EQ(campaign.log.back(), (LogEntry{.day = 2, .text = "Ran short of 2 food and 3 water; 5 people lost."}));
		EXPECT_EQ(campaign.day, 3);

		const Forecast fed = forecastNeeds(Resources{.food = 7, .water = 9, .people = 12}, testRules().compound);
		EXPECT_EQ(fed.food, (Need{.stock = 7, .daily = 3, .days = 2, .shortTonight = false}));
		EXPECT_EQ(fed.water.days, 3);
		EXPECT_TRUE(forecastNeeds(Resources{.food = 2, .water = 9, .people = 12}, testRules().compound).food.shortTonight);
		EXPECT_FALSE(forecastNeeds(Resources{.food = 2}, testRules().compound).food.days.has_value()) << "nobody to eat";
	}

	TEST(DayClock, ANightTakesADayOffEveryInjuryAndTheFitAreReadyAtFullHitpoints) {
		Campaign	  campaign = foundTestCampaign();
		DriverRecord& hurt = campaign.driver(crewOf(campaign, "road_warrior"));
		hurt.status = DriverStatus::Injured;
		hurt.injuredDays = 2;
		hurt.hitpoints = 22;
		EXPECT_TRUE(rest(campaign).healed.empty());
		EXPECT_EQ(campaign.driver(hurt.id).injuredDays, 1);
		EXPECT_EQ(campaign.driver(hurt.id).hitpoints, 22) << "HP holds until they're fit (call 131)";
		EXPECT_EQ(rest(campaign).healed, std::vector{hurt.id});
		EXPECT_EQ(campaign.driver(hurt.id).status, DriverStatus::Ready);
		EXPECT_EQ(campaign.driver(hurt.id).hitpoints, 40);
	}

	TEST(DayClock, ANightThatLeavesNoPeopleEndsTheCampaignOnTheDayItFellAndNothingChangesItAfter) {
		Campaign campaign = foundTestCampaign();
		campaign.stores = Resources{.food = 0, .water = 0, .people = 1};
		campaign.day = 9;
		(void)rest(campaign);
		EXPECT_EQ(campaign.end, (CampaignEnd{.ending = Ending::Starved, .cause = EndCause::NoPeople}));
		EXPECT_EQ(campaign.day, 9) << "the day doesn't turn (call 39)";
		EXPECT_EQ(campaign.log.back(), (LogEntry{.day = 9, .text = "No people are left, and the compound starved."}));

		EXPECT_THROW((void)rest(campaign), std::invalid_argument);
		EXPECT_EQ(scavengeBlocker(campaign), ScavengeRefusal::CampaignOver);
		const CrewId driver = crewOf(campaign, "mechanic");
		EXPECT_EQ(seatBlocker(campaign, driver, std::nullopt), (SeatBlocker{.reason = SeatRefusal::CampaignOver}));
		EXPECT_EQ(
			cardMoveBlocker(
				campaign, testContent(), testRules().deck, {.card = card("repair_kit"), .from = DefaultDeck{driver}, .to = Locker{}}
			),
			(CardBlocker{.reason = CardRefusal::CampaignOver})
		);
		EXPECT_THROW(startRun(campaign, testContent(), RunStart{.seats = {driver}}), std::invalid_argument);
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign) << "an ended campaign saves as it is";

		// With a run out the compound waits for it (call 38).
		Campaign out = foundTestCampaign();
		startRun(out, testContent(), RunStart{.seats = {crewOf(out, "mechanic")}});
		out.stores = Resources{.people = 1};
		(void)rest(out);
		EXPECT_FALSE(out.end.has_value());
		EXPECT_EQ(out.day, 2);
	}

	TEST(DayClock, AScavengingPartyBringsTheDaysHaulHomeAtDuskBeforeTheCompoundEats) {
		Campaign		campaign = foundTestCampaign();
		const Resources haul = rollHaul(campaign.seed, 1, testRules().compound);
		EXPECT_EQ(rollHaul(campaign.seed, 1, testRules().compound), haul);
		EXPECT_TRUE(haul.fuel >= 1 && haul.fuel <= 2 && haul.scrap >= 5 && haul.scrap <= 15);
		EXPECT_EQ(haul.food + haul.water + haul.meds + haul.people, 0);

		const Resources before = campaign.stores;
		const DayEnd	night = scavenge(campaign, testContent(), testRules());
		EXPECT_EQ(night.haul, haul);
		EXPECT_EQ(campaign.stores.fuel, before.fuel + haul.fuel);
		EXPECT_EQ(campaign.stores.scrap, before.scrap + haul.scrap);
		EXPECT_EQ(
			campaign.log.back(),
			(LogEntry{
				.day = 1,
				.text =
					"A scavenging party brought back " + std::to_string(haul.fuel) + " fuel and " + std::to_string(haul.scrap) + " scrap."
			})
		);
		EXPECT_EQ(campaign.day, 2);

		startRun(campaign, testContent(), RunStart{.seats = {crewOf(campaign, "mechanic")}});
		EXPECT_EQ(scavengeBlocker(campaign), ScavengeRefusal::RunOut);
		EXPECT_THROW((void)scavenge(campaign, testContent(), testRules()), std::invalid_argument);
		giveUpLoadOut(campaign);
		campaign.stores.people = 0;
		EXPECT_EQ(scavengeBlocker(campaign), ScavengeRefusal::Abandoned);
	}

} // namespace
