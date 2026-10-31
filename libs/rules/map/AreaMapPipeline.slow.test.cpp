#include <rules/map/AreaMapPipeline.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

// The whole pipeline, run once a test: each stage's retry leaves the stages before it on their first streams.
namespace {

	using namespace rules::map;
	TEST(AreaMapPipeline, RunsTheWaterOnAStreamNestedInTheTerrainsAndMakesTheSameMapToTheBit) {
		const MapParams&			  params = fixtures::mixed();
		std::vector<std::string>	  started;
		const PipelineResult<AreaMap> result = generateAreaMap(
			params, fixtures::content(), {.onProgress = [&](const StageAttempt& attempt) { started.emplace_back(attempt.stage); }}
		);
		EXPECT_EQ(started, (std::vector<std::string>{"terrain", "water", "hazards", "places", "roads", "routeTree", "pois"}));
		EXPECT_EQ(result.mapAttempt, 0U);
		EXPECT_TRUE(result.failures.empty());
		ASSERT_EQ(result.stages.size(), 7U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].name, "water");
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		ASSERT_TRUE(result.products.terrain.has_value() && result.products.water.has_value());
		EXPECT_EQ(result.products.terrain->surface().elevation, fixtures::terrainFor(params).surface().elevation);
		EXPECT_EQ(result.products.terrain->surface().drainage.levels, fixtures::terrainFor(params).surface().drainage.levels);
		const Water& water = *result.products.water;
		const Water& direct = fixtures::waterFor(params);
		EXPECT_EQ(water.drainage().area, direct.drainage().area);
		EXPECT_EQ(water.moisture().size(), direct.moisture().size());
		EXPECT_TRUE(std::ranges::equal(water.moisture(), direct.moisture()));
		EXPECT_TRUE(std::ranges::equal(water.lakeDepth(), direct.lakeDepth()));
		ASSERT_EQ(water.rivers().size(), direct.rivers().size());
		for (size_t id = 0; id < water.rivers().size(); ++id) {
			ASSERT_EQ(water.rivers()[id].line.size(), direct.rivers()[id].line.size());
			for (size_t index = 0; index < water.rivers()[id].line.size(); ++index) {
				EXPECT_EQ(water.rivers()[id].line[index].x, direct.rivers()[id].line[index].x);
				EXPECT_EQ(water.rivers()[id].line[index].y, direct.rivers()[id].line[index].y);
			}
		}
		ASSERT_TRUE(result.products.roads.has_value());
		EXPECT_TRUE(fixtures::sameRoads(*result.products.roads, fixtures::roadsFor(params)));
		// The route tree takes no draws, but its link nests in the roads' stream all the same.
		EXPECT_EQ(result.stages[5].stream, foundation::Rng(fixtures::roadsStream(params).seed()).fork("routeTree", 0).seed());
		ASSERT_TRUE(result.products.routeTree.has_value());
		const RouteTree tree = buildRouteTree({
			.network = fixtures::roadsFor(params).network(),
			.travelPace = params.travelPace,
			.routeSplit = params.routeSplit,
		});
		EXPECT_EQ(result.products.routeTree->parentStretch, tree.parentStretch);
		EXPECT_EQ(result.products.routeTree->hours, tree.hours);
		EXPECT_EQ(result.products.routeTree->meetingPoints.size(), tree.meetingPoints.size());
		// The POIs nest in the route tree's link, and seat what the stage seats straight from that stream.
		EXPECT_EQ(result.stages[6].stream, fixtures::poisStream(params).seed());
		ASSERT_TRUE(result.products.pois.has_value());
		const PoiLayer& seated = fixtures::poisFor(params);
		ASSERT_EQ(result.products.pois->pois.size(), seated.pois.size());
		for (size_t poi = 0; poi < seated.pois.size(); ++poi) {
			EXPECT_EQ(result.products.pois->pois[poi].site.at, seated.pois[poi].site.at);
			EXPECT_EQ(result.products.pois->pois[poi].type, seated.pois[poi].type);
		}
	}

	// One attempt, since another would only repeat it: a route tree the map can't use restarts the map.
	TEST(AreaMapPipeline, RestartsTheMapWhenItRejectsTheRouteTree) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, fixtures::content(), {.accept = [](const AreaMap&, const StageAttempt& attempt) {
								return attempt.stage == "routeTree" && attempt.mapAttempt == 0 ? Problems{"no routes there"} : Problems{};
							}});
		EXPECT_EQ(result.mapAttempt, 1U);
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].stage, "routeTree");
		EXPECT_EQ(result.failures[0].attempt, 0U);
		ASSERT_EQ(result.stages.size(), 7U);
		EXPECT_EQ(result.stages[0].stream, foundation::Rng(params.seed).fork("map", 1).fork("terrain", 0).seed());
		for (const StageRecord& stage : result.stages) {
			EXPECT_EQ(stage.attempt, 0U) << stage.name;
		}
		EXPECT_EQ(result.stages[5].runs, 2U);
	}

	TEST(AreaMapPipeline, RetriesTheHazardsAloneLeavingTheTerrainAndTheWaterAsTheyWere) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, fixtures::content(), {.accept = [](const AreaMap&, const StageAttempt& attempt) {
								return attempt.stage == "hazards" && attempt.attempt == 0 ? Problems{"no craters there"} : Problems{};
							}});
		EXPECT_EQ(result.mapAttempt, 0U);
		ASSERT_EQ(result.stages.size(), 7U);
		EXPECT_EQ(result.stages[0].attempt, 0U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].attempt, 0U);
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		EXPECT_EQ(result.stages[2].attempt, 1U);
		EXPECT_EQ(result.stages[2].stream, fixtures::hazardsStream(params, 1).seed());
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].stage, "hazards");

		EXPECT_EQ(result.products.terrain->surface().elevation, fixtures::terrainFor(params).surface().elevation);
		EXPECT_TRUE(std::ranges::equal(result.products.water->moisture(), fixtures::waterFor(params).moisture()));
		const Hazards retried(params, fixtures::terrainFor(params), fixtures::waterFor(params), fixtures::hazardsStream(params, 1));
		const auto&	  hotspots = result.products.hazards->hotspots();
		ASSERT_EQ(hotspots.size(), retried.hotspots().size());
		for (size_t index = 0; index < hotspots.size(); ++index) {
			EXPECT_EQ(hotspots[index].x, retried.hotspots()[index].x);
			EXPECT_EQ(hotspots[index].y, retried.hotspots()[index].y);
		}
		EXPECT_NE(hotspots.front().x, fixtures::hazardsFor(params).hotspots().front().x);
	}

	TEST(AreaMapPipeline, RetriesThePlacesAloneLeavingTheEarlierStagesAsTheyWere) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, fixtures::content(), {.accept = [](const AreaMap&, const StageAttempt& attempt) {
								return attempt.stage == "places" && attempt.attempt == 0 ? Problems{"no towns there"} : Problems{};
							}});
		ASSERT_EQ(result.stages.size(), 7U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		EXPECT_EQ(result.stages[2].stream, fixtures::hazardsStream(params).seed());
		EXPECT_EQ(result.stages[3].attempt, 1U);
		EXPECT_EQ(result.stages[3].stream, fixtures::placesStream(params, 1).seed());
		EXPECT_EQ(result.products.terrain->surface().elevation, fixtures::terrainFor(params).surface().elevation);
		EXPECT_EQ(result.products.hazards->hotspots().front().x, fixtures::hazardsFor(params).hotspots().front().x);
		const Places retried(
			params,
			fixtures::terrainFor(params),
			fixtures::waterFor(params),
			fixtures::hazardsFor(params),
			fixtures::placeNames(),
			fixtures::placesStream(params, 1)
		);
		const Places& places = *result.products.places;
		ASSERT_EQ(places.villages().size(), retried.villages().size());
		ASSERT_EQ(places.crossroads().size(), retried.crossroads().size());
		EXPECT_EQ(places.towns().front().name, retried.towns().front().name);
		EXPECT_EQ(places.crossroads().front().x, retried.crossroads().front().x);
		EXPECT_NE(places.villages().front().radius, fixtures::placesFor(params).villages().front().radius);
	}

	TEST(AreaMapPipeline, RetriesTheRoadsAloneLeavingTheEarlierStagesAsTheyWere) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, fixtures::content(), {.accept = [](const AreaMap&, const StageAttempt& attempt) {
								return attempt.stage == "roads" && attempt.attempt == 0 ? Problems{"no roads there"} : Problems{};
							}});
		ASSERT_EQ(result.stages.size(), 7U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		EXPECT_EQ(result.stages[2].stream, fixtures::hazardsStream(params).seed());
		EXPECT_EQ(result.stages[3].stream, fixtures::placesStream(params).seed());
		EXPECT_EQ(result.stages[4].attempt, 1U);
		EXPECT_EQ(result.stages[4].stream, fixtures::roadsStream(params, 1).seed());
		EXPECT_EQ(result.products.places->crossroads().front().x, fixtures::placesFor(params).crossroads().front().x);
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].stage, "roads");
		// Another attempt links the places in another order, and draws other route numbers.
		EXPECT_FALSE(fixtures::sameRoads(*result.products.roads, fixtures::roadsFor(params)));
		EXPECT_NE(result.products.roads->network().routeNumbers, fixtures::roadsFor(params).network().routeNumbers);
		// The route tree is the retried roads', on a stream nested in theirs.
		EXPECT_EQ(result.stages[5].stream, foundation::Rng(fixtures::roadsStream(params, 1).seed()).fork("routeTree", 0).seed());
		const RouteTree retried = buildRouteTree({
			.network = result.products.roads->network(),
			.travelPace = params.travelPace,
			.routeSplit = params.routeSplit,
		});
		EXPECT_EQ(result.products.routeTree->parentStretch, retried.parentStretch);
	}

} // namespace
