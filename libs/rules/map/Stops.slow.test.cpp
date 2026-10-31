#include <rules/map/AreaMapPipeline.h>
#include <rules/map/MapTesting.h>
#include <rules/map/StopChecks.h>
#include <rules/map/StopTesting.h>
#include <rules/map/Stops.h>

#include <gtest/gtest.h>

#include <string>

// The stops stage over three maps' POIs, as the pipeline places them on their first streams, and the stage's retries in
// the pipeline.
namespace {

	using namespace rules::map;

	class EveryStopLayer : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(Stops, EveryStopLayer, ::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands()));

	TEST_P(EveryStopLayer, KeepsEveryHardRuleEveryFloorOnItsOwnRoadAndARouteHomeByDark) {
		const MapParams&   params = *GetParam();
		const StopLayer&   layer = fixtures::stopsFor(params);
		const PoiLayer&	   pois = fixtures::poisFor(params);
		const RoadNetwork& network = fixtures::roadsFor(params).network();
		const StopTuning&  tuning = fixtures::content().stops;
		fixtures::expectEveryHardRule({
			.network = network,
			.pois = pois,
			.stops = layer,
			.params = params,
			.tuning = tuning,
			.tables = fixtures::content().stopTables,
		});
		fixtures::expectStopsOnTheirLegs(network, pois, layer, tuning);
		fixtures::expectFloorsOnOwnRoad(pois, layer, tuning);
		fixtures::expectHomeByDark(pois, layer, tuning, params.daylightHours);
		EXPECT_FALSE(layer.stops.empty());
	}

	// Every stops attempt rejected, so a release run keeps the one with the fewest problems, past the stage's cap, and
	// the stages before it stay on their first streams.
	TEST(Stops, RetryOnlyThemselvesAndPastTheirCapAReleaseRunKeepsTheBest) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result = generateAreaMap(
			params,
			fixtures::content(),
			{
				.accept =
					[](const AreaMap&, const StageAttempt& attempt) {
						if (attempt.stage != "stops") {
							return Problems{};
						}
						return attempt.attempt == 5 ? Problems{"rejected"} : Problems{"rejected", "and again"};
					},
				.debug = false,
			}
		);
		EXPECT_EQ(result.mapAttempt, 0U);
		ASSERT_EQ(result.stages.size(), 9U);
		for (size_t stage = 0; stage < 7; ++stage) {
			EXPECT_EQ(result.stages[stage].attempt, 0U) << result.stages[stage].name;
			EXPECT_EQ(result.stages[stage].runs, 1U) << result.stages[stage].name;
		}
		EXPECT_EQ(result.stages[6].stream, fixtures::poisStream(params).seed());
		const StageRecord& stops = result.stages[7];
		EXPECT_TRUE(stops.kept);
		EXPECT_EQ(stops.attempt, 5U);
		EXPECT_EQ(stops.stream, fixtures::stopsStream(params, 5).seed());
		// Its eight, and the one kept made again.
		EXPECT_EQ(stops.runs, kStageAttempts + 1);
		EXPECT_EQ(result.failures.size(), kStageAttempts);
		// The dressing nests in the kept attempt's stream.
		EXPECT_EQ(result.stages[8].stream, foundation::Rng(stops.stream).fork("dressing", 0).seed());
		ASSERT_TRUE(result.products.stops.has_value());
		EXPECT_TRUE(fixtures::sameStops(*result.products.stops, fixtures::stopsOn(params, 5)));
		EXPECT_FALSE(fixtures::sameStops(*result.products.stops, fixtures::stopsFor(params)));
	}

} // namespace
