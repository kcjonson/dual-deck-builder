#include <rules/map/MapTesting.h>
#include <rules/map/Terrain.h>

#include <gtest/gtest.h>

// Each builds a land of its own.
namespace {

	using namespace rules::map;

	TEST(Terrain, ReadsOnlyTheParametersThatShapeTheLand) {
		const MapParams elsewhere = fixtures::paramsFor(
			fixtures::mixed().seed,
			Environment::Mixed,
			{{NumberParam::Towns, 11},
			 {NumberParam::Hotspots, 6},
			 {NumberParam::Contamination, 0.9},
			 {NumberParam::Lakes, 7},
			 {NumberParam::Highways, 9},
			 {NumberParam::Dressing, 0.1},
			 {NumberParam::Aridity, 0.2}}
		);
		const Terrain terrain(elsewhere, fixtures::terrainStream(elsewhere, 0));
		EXPECT_EQ(terrain.surface().elevation, fixtures::terrainFor(fixtures::mixed()).surface().elevation);
		EXPECT_EQ(terrain.surface().drainage.receivers, fixtures::terrainFor(fixtures::mixed()).surface().drainage.receivers);
	}

	TEST(Terrain, BuildsOtherLandOnAnotherStageAttempt) {
		const Terrain other(fixtures::mixed(), fixtures::terrainStream(fixtures::mixed(), 1));
		EXPECT_NE(other.surface().elevation, fixtures::terrainFor(fixtures::mixed()).surface().elevation);
	}

} // namespace
