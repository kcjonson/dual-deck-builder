#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/core/ContentError.h>
#include <rules/map/MapTesting.h>
#include <rules/map/RollParams.h>
#include <rules/map/StopTesting.h>

#include <gtest/gtest.h>

#include <string>

// Each makes whole maps: founding's, and a load's.
namespace {

	using namespace rules;
	using namespace rules::campaigns;
	namespace fixtures = rules::map::fixtures;

	TEST(CampaignMap, FoundingMakesTheSeedsMapAndALoadMakesTheSameOneAgain) {
		// A Mixed map at 850, as small as a roll makes one.
		const uint32_t	  seed = 60;
		const CampaignMap made = makeCampaignMap(seed, fixtures::content());
		EXPECT_EQ(made.origin.params, map::rollParams(seed).params);
		EXPECT_EQ(made.origin.fingerprint, mapFingerprint(made.map));
		EXPECT_EQ(made.origin.stageAttempts.size(), 8U);

		Campaign campaign =
			foundCampaign(testContent(), testRules(), Founding{.map = made.origin, .unlocked = unlockedAtStart(testContent())});
		EXPECT_EQ(campaign.seed, seed);
		EXPECT_EQ(campaign.drivers, foundTestCampaign({}, seed).drivers) << "the deal is the seed's, whatever map it's on";
		campaign.mapState = MapState{
			.clearedPois = {static_cast<int>(made.map.pois->pois.size()) - 1},
			.chartedLegs = {0},
			.stops = {StopState{.stop = 3, .roll = 0, .cleared = 1}},
			.strongholdsTaken = {made.map.pois->strongholds.back().poi},
		};
		const nlohmann::json save = writeCampaign(campaign, testContent());
		const LoadedCampaign loaded = loadCampaign(save, testContent(), fixtures::content());
		EXPECT_EQ(loaded.campaign, campaign);
		EXPECT_TRUE(fixtures::sameRoads(*loaded.map.roads, *made.map.roads));
		EXPECT_TRUE(fixtures::sameStops(*loaded.map.stops, *made.map.stops));
		EXPECT_EQ(mapFingerprint(loaded.map), made.origin.fingerprint);
	}

	// On the fast lane's map, which is smaller: an attempt the stops could have had, but not the one that won, makes a
	// map, but another one.
	TEST(CampaignMap, ALoadOnAnAttemptThatDidntWinFails) {
		nlohmann::json save = writeCampaign(foundOnTestMap(), testContent());
		save["mapOrigin"]["attempts"]["stages"]["stops"] = 1;
		try {
			(void)loadCampaign(save, testContent(), fixtures::content());
			ADD_FAILURE() << "expected a ContentError";
		} catch (const ContentError& error) {
			EXPECT_TRUE(
				std::string(error.what()).starts_with("campaign.mapOrigin.fingerprint is " + fingerprintText(testMap().origin.fingerprint))
			) << error.what();
		}
	}

} // namespace
