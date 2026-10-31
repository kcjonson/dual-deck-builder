#include <rules/map/AreaMapPipeline.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <string>

// The map validator as the pipeline's accept hook, over the mixed map's roads and first POIs, which the fast lane has.
namespace {

	using namespace rules::map;

	// A POI layer that reveals a stronghold at the start fails the POIs as their own check would, and the runner seats
	// them again on their next attempt.
	TEST(MapValidator, RejectsPoisWhoseStartRevealsAStrongholdAndTheRunnerSeatsThemAgain) {
		const MapParams&   params = fixtures::mixed();
		const AreaMapInput input{.params = params, .content = fixtures::content()};
		const PoiLayer&	   seated = fixtures::poisFor(params);
		ASSERT_FALSE(seated.strongholds.empty());
		PoiLayer revealing = seated;
		revealing.pois[static_cast<size_t>(revealing.strongholds.front().poi)].tier = params.startingReveal + 1;
		int		   attempts = 0;
		const auto pipeline =
			MapPipeline<AreaMapInput, AreaMap>{}
				.then({
					.name = "roads",
					.attempts = 1,
					.run = [&](const AreaMapInput&, AreaMap& map, foundation::Rng&) { map.roads = fixtures::roadsFor(params); },
				})
				.then({
					.name = "pois",
					.run = [&](const AreaMapInput&, AreaMap& map, foundation::Rng&) { map.pois = attempts++ == 0 ? revealing : seated; },
				});
		const PipelineResult<AreaMap> result = pipeline.run(params.seed, input, {.accept = mapValidator(input)});
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].stage, "pois");
		ASSERT_FALSE(result.failures[0].problems.empty());
		EXPECT_TRUE(result.failures[0].problems.front().starts_with("reveal: ")) << result.failures[0].problems.front();
		EXPECT_EQ(result.stages[1].attempt, 1U);
		EXPECT_EQ(result.mapAttempt, 0U);
		const size_t stronghold = static_cast<size_t>(seated.strongholds.front().poi);
		EXPECT_EQ(result.products.pois->pois[stronghold].tier, seated.pois[stronghold].tier);
	}

} // namespace
