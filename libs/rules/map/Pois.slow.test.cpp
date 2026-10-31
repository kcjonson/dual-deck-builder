#include <rules/map/AreaMapPipeline.h>
#include <rules/map/MapTesting.h>
#include <rules/map/PoiChecks.h>
#include <rules/map/PoiNames.h>
#include <rules/map/Pois.h>

#include <gtest/gtest.h>

#include <set>
#include <string>
#include <vector>

// The POI stage over the route trees of three maps, as the pipeline seats them on their first streams.
namespace {

	using namespace rules::map;

	class EveryPoiLayer : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(Pois, EveryPoiLayer, ::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands()));

	TEST_P(EveryPoiLayer, KeepsEveryRuleTheChecksHaveAndSaysWhatItCouldntSeat) {
		const MapParams&				params = *GetParam();
		const PoiLayer&					layer = fixtures::poisFor(params);
		const Roads&					roads = fixtures::roadsFor(params);
		const bool						lenient = poisHeldLeniently(params, roads);
		const std::vector<PoiViolation> found = checkPoiLayer({
			.network = roads.network(),
			.tree = fixtures::treeFor(params),
			.layer = layer,
			.params = params,
			.tuning = fixtures::content().pois,
			.stops = fixtures::content().stops,
			.sectors = !lenient && layer.failures.empty(),
		});
		EXPECT_TRUE(found.empty()) << found.front().detail;
		// A first attempt can miss a sector, which the stage's check fails on and its next attempt redraws; the
		// layer names each one it missed.
		size_t missed = 0;
		for (const std::string& failure : layer.failures) {
			EXPECT_TRUE(failure.starts_with("sector ")) << failure;
			missed += failure.starts_with("sector ") ? 1 : 0;
		}
		EXPECT_EQ(layer.strongholds.size() + missed, static_cast<size_t>(params.strongholds));
		int target = 0;
		int placed = 0;
		for (const RingCount& ring : layer.rings) {
			EXPECT_LE(ring.placed, ring.target);
			target += ring.target;
			placed += ring.placed;
		}
		EXPECT_EQ(layer.pois.size(), layer.strongholds.size() + static_cast<size_t>(placed));
		EXPECT_GT(placed, 0);
		// At radius 600 a map's meeting points can't hold all it aims for, and its rings say how far short it fell.
		EXPECT_LT(placed, target);
		EXPECT_LE(layer.pois.size(), fixtures::treeFor(params).meetingPoints.size());
	}

	// The badlands' first roads hold no rotation that seats all four strongholds with own road, so after its eight
	// attempts the POI stage escalates to the roads, which link the places again, and seats them on another network.
	TEST(Pois, EscalateToTheRoadsWhenNoAttemptSeatsEveryStronghold) {
		const MapParams&			  params = fixtures::badlands();
		const PipelineResult<AreaMap> result = generateAreaMap(params, fixtures::content());
		EXPECT_EQ(result.mapAttempt, 0U);
		ASSERT_EQ(result.stages.size(), 7U);
		EXPECT_EQ(result.stages[3].attempt, 0U);
		EXPECT_GT(result.stages[4].attempt, 0U);
		EXPECT_EQ(result.stages[4].runs, result.stages[4].attempt + 1);
		EXPECT_GT(result.stages[6].runs, kStageAttempts);
		for (const StageFailure& failure : result.failures) {
			EXPECT_EQ(failure.stage, "pois");
		}
		const PoiLayer& layer = *result.products.pois;
		EXPECT_TRUE(layer.failures.empty());
		EXPECT_EQ(layer.strongholds.size(), static_cast<size_t>(params.strongholds));
		int placed = 0;
		for (const RingCount& ring : layer.rings) {
			placed += ring.placed;
		}
		EXPECT_EQ(layer.pois.size(), layer.strongholds.size() + static_cast<size_t>(placed));
	}

	TEST_P(EveryPoiLayer, NamesEveryPoiOnceAfterItsTownOrVillageItsFactionOrItsBearing) {
		const MapParams&			   params = *GetParam();
		const PoiLayer&				   layer = fixtures::poisFor(params);
		const Places&				   places = fixtures::placesFor(params);
		const std::vector<std::string> names =
			poiNames(layer, places, fixtures::content().pois, fixtures::content().factions, params.radius);
		ASSERT_EQ(names.size(), layer.pois.size());
		EXPECT_EQ(std::set<std::string>(names.begin(), names.end()).size(), names.size());
		int fromPlaces = 0;
		for (size_t poi = 0; poi < names.size(); ++poi) {
			if (layer.pois[poi].type == kStrongholdType) {
				EXPECT_TRUE(names[poi].ends_with(" stronghold")) << names[poi];
				continue;
			}
			bool placed = false;
			for (const auto* list : {&places.towns(), &places.villages()}) {
				for (const Settlement& settlement : *list) {
					placed = placed || names[poi].starts_with(settlement.name + " ");
				}
			}
			fromPlaces += placed ? 1 : 0;
			if (!placed) {
				EXPECT_NE(names[poi].find(", "), std::string::npos) << names[poi];
			}
		}
		EXPECT_GT(fromPlaces, 0);
	}

} // namespace
