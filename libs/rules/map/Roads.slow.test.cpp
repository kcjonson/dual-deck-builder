#include <rules/map/MapTesting.h>
#include <rules/map/Roads.h>

#include <gtest/gtest.h>

// A second roads stage over a fixture's land.
namespace {

	using namespace rules::map;

	Roads roadsWith(const MapParams& land, const MapParams& params) {
		return {
			params,
			fixtures::terrainFor(land),
			fixtures::waterFor(land),
			fixtures::hazardsFor(land),
			fixtures::placesFor(land),
			fixtures::roadsStream(land),
		};
	}

	double length(const RoadLinks& links, RoadClass road) {
		double total = 0;
		for (const RoadMove& move : links.moves) {
			total += move.roadClass == road ? move.length : 0;
		}
		return total;
	}

	// Trail share only says which back roads are trails, never where a road runs, so one map serves both.
	TEST(Roads, ClosesMoreLoopsAsLoopsRisesAndGivesOutToTrailsMoreReadilyAsTrailShareDoes) {
		const MapParams& land = fixtures::mixed();
		const Roads&	 some = fixtures::roadsFor(land);
		const Roads		 more = roadsWith(land, fixtures::with(fixtures::with(land, &MapParams::loops, 1), &MapParams::trailShare, 1));
		EXPECT_GT(more.links().stats.looped, some.links().stats.looped);
		EXPECT_LT(more.links().stats.skipped, some.links().stats.skipped);
		EXPECT_GT(more.loops(), some.loops());
		// A link joining places not yet joined goes in whatever loops is.
		EXPECT_EQ(more.links().stats.joined + more.links().stats.failed, some.links().stats.joined + some.links().stats.failed);
		const auto trailShare = [](const RoadLinks& links) {
			const double trails = length(links, RoadClass::Trail);
			return trails / (trails + length(links, RoadClass::BackRoad));
		};
		EXPECT_GT(trailShare(more.links()), 1.5 * trailShare(some.links()));
	}

} // namespace
