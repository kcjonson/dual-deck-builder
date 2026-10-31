#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/RunDecks.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <map>
#include <set>
#include <stop_token>
#include <string>
#include <string_view>
#include <vector>

namespace {

	using namespace rules;
	using namespace rules::campaigns;
	namespace fixtures = rules::map::fixtures;

	std::string checkError(const Campaign& campaign, const map::AreaMap& map) {
		try {
			checkCampaignMap(campaign, map);
		} catch (const ContentError& error) {
			return error.what();
		}
		return "";
	}

	TEST(CampaignMap, TheMapsStateHoldsOnlyIdsTheMapHasAndOnlyOnTheMapItsOriginMakes) {
		const CampaignMap&	  made = testMap();
		const map::PoiLayer&  pois = *made.map.pois;
		const map::StopLayer& stops = *made.map.stops;
		const int			  poiCount = static_cast<int>(pois.pois.size());
		const int			  legCount = static_cast<int>(pois.legs.legs.size());
		const int			  stopCount = static_cast<int>(stops.stops.size());
		ASSERT_GE(pois.strongholds.size(), 2U);
		Campaign campaign = foundOnTestMap();
		EXPECT_EQ(campaign.seed, fixtures::mixed().seed);
		campaign.day = 6;
		campaign.mapState = MapState{
			.clearedPois = {poiCount - 1},
			.chartedLegs = {0, legCount - 1},
			.stops = {StopState{.stop = 0, .roll = 1, .cleared = {}}, StopState{.stop = stopCount - 1, .roll = 0, .cleared = 5}},
			.strongholdsTaken = {pois.strongholds.front().poi},
		};
		EXPECT_EQ(checkError(campaign, made.map), "");
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);

		Campaign outside = campaign;
		outside.mapState.clearedPois.push_back(poiCount);
		EXPECT_EQ(
			checkError(outside, made.map),
			"campaign.mapState.clearedPois[1] names POI " + std::to_string(poiCount) + ", and the map has " + std::to_string(poiCount)
		);
		outside = campaign;
		outside.mapState.chartedLegs.push_back(legCount);
		EXPECT_EQ(
			checkError(outside, made.map),
			"campaign.mapState.chartedLegs[2] names leg " + std::to_string(legCount) + ", and the map has " + std::to_string(legCount)
		);
		outside = campaign;
		outside.mapState.stops.push_back(StopState{.stop = stopCount, .roll = 1, .cleared = {}});
		EXPECT_EQ(
			checkError(outside, made.map),
			"campaign.mapState.stops[2] names stop " + std::to_string(stopCount) + ", and the map has " + std::to_string(stopCount)
		);
		// Strongholds come first in the POI layer, so the first POI past them isn't one.
		const int town = static_cast<int>(pois.strongholds.size());
		outside = campaign;
		outside.mapState.strongholdsTaken = {town};
		EXPECT_EQ(
			checkError(outside, made.map),
			"campaign.mapState.strongholdsTaken[0] names POI " + std::to_string(town) + ", which isn't a stronghold"
		);

		Campaign elsewhere = campaign;
		elsewhere.mapOrigin.fingerprint += 1;
		EXPECT_TRUE(checkError(elsewhere, made.map).starts_with("campaign.mapOrigin.fingerprint is "));
	}

	TEST(CampaignMap, ALoadRefusesAttemptsThatDontFitTheMapsStagesBeforeMakingAnything) {
		const nlohmann::json save = writeCampaign(foundOnTestMap(), testContent());
		const auto			 loadError = [&](const auto& change) -> std::string {
			  nlohmann::json copy = save;
			  change(copy["mapOrigin"]["attempts"]["stages"]);
			  try {
				  (void)loadCampaign(copy, testContent(), fixtures::content());
			  } catch (const ContentError& error) {
				  return error.what();
			  }
			  return "";
		};
		// The pipeline's own words say what doesn't fit; the save's say where.
		const auto misfit = [](const std::string& error, std::string_view stage) {
			return error.starts_with("campaign.mapOrigin's attempts don't fit the map's stages: ") &&
				   error.find(stage) != std::string::npos;
		};
		EXPECT_TRUE(misfit(loadError([](nlohmann::json& stages) { stages["routeTree"] = 1; }), "routeTree attempt 1"));
		EXPECT_TRUE(misfit(loadError([](nlohmann::json& stages) { stages.erase("pois"); }), "pois"));
		EXPECT_TRUE(misfit(loadError([](nlohmann::json& stages) { stages["weather"] = 0; }), "weather"));
	}

	// A stop asked for before anything runs ends the founding or the load at the first stage, and never moves the seed.
	TEST(CampaignMap, AStopRequestedEndsAFoundingAndALoadBeforeTheFirstStage) {
		std::stop_source stop;
		stop.request_stop();
		const MapMaking making{.debug = false, .cancel = stop.get_token()};
		try {
			(void)makeCampaignMap(7, fixtures::content(), making);
			ADD_FAILURE() << "the founding's map was made";
		} catch (const map::MapPipelineCancelled& cancelled) {
			EXPECT_EQ(cancelled.before, "terrain");
		}
		try {
			(void)loadCampaign(writeCampaign(foundOnTestMap(), testContent()), testContent(), fixtures::content(), making);
			ADD_FAILURE() << "the save's map was made again";
		} catch (const map::MapPipelineCancelled& cancelled) {
			EXPECT_EQ(cancelled.before, "terrain");
		}
	}

	TEST(CampaignMap, TheGameStageCountsStrongholdsTakenAndARouteReadsTheMapStateAsItStandsToday) {
		Campaign campaign = foundTestCampaign();
		EXPECT_EQ(gameStage(campaign), 0);
		campaign.day = 17;
		EXPECT_EQ(gameStage(campaign), 2) << "a stage every eight days";
		campaign.mapState.strongholdsTaken = {1};
		EXPECT_EQ(gameStage(campaign), 4) << "and two a stronghold";
		campaign.mapState.strongholdsTaken = {0, 1};
		EXPECT_EQ(gameStage(campaign), 6);
		campaign.day = 40;
		EXPECT_EQ(gameStage(campaign), 6) << "and no further";

		campaign.mapState.stops = {
			StopState{.stop = 2, .roll = 1, .cleared = {}},
			StopState{.stop = 5, .roll = 0, .cleared = 38},
			StopState{.stop = 6, .roll = 2, .cleared = 39},
		};
		const map::MapToday today = mapToday(campaign);
		EXPECT_TRUE(today.legs.empty()) << "every leg charted, until fog";
		EXPECT_EQ(today.cleared, (std::set{5, 6}));
		EXPECT_EQ(today.rolls, (std::map<int, int>{{2, 1}, {6, 2}}));
		EXPECT_EQ(today.gameStage, 6);
	}

} // namespace
