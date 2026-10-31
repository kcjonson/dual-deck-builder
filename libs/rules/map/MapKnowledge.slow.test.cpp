#include <rules/map/MapKnowledge.h>
#include <rules/map/MapTesting.h>
#include <rules/map/Stops.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cstddef>
#include <vector>

// The starting knowledge of three maps' first POIs, as the pipeline seats them on their first streams.
namespace {

	using namespace rules::map;

	class EveryStartingKnowledge : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		MapKnowledge,
		EveryStartingKnowledge,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands())
	);

	TEST_P(EveryStartingKnowledge, ChartsOutFromTheCompoundRumorsTowardTheNextTierAndFindsNoStronghold) {
		const MapParams&	params = *GetParam();
		const PoiLayer&		pois = fixtures::poisFor(params);
		const KnowledgeArgs args{
			.network = fixtures::roadsFor(params).network(),
			.pois = pois,
			.params = params,
			.tuning = fixtures::content().knowledge,
		};
		const MapKnowledge		start = startingKnowledge(args);
		const std::vector<Leg>& legs = pois.legs.legs;
		const std::vector<int>	tiers = legTiers(pois);
		ASSERT_EQ(start.legs.size(), legs.size());
		int rumored = 0;
		for (size_t id = 0; id < legs.size(); ++id) {
			const int		   parent = legs[id].parent;
			const bool		   onKnownRoad = parent < 0 || start.legs[static_cast<size_t>(parent)] == LegKnowledge::Charted;
			const LegKnowledge known = start.legs[id];
			if (tiers[id] <= params.startingReveal) {
				EXPECT_EQ(known, LegKnowledge::Charted) << "leg " << id << " is tier " << tiers[id];
			}
			if (known != LegKnowledge::Uncharted) {
				EXPECT_TRUE(onKnownRoad) << "leg " << id << " is known off charted road";
			}
			if (known == LegKnowledge::Rumored) {
				EXPECT_EQ(tiers[id], params.startingReveal + 1) << "leg " << id;
				rumored += 1;
			}
		}
		EXPECT_GE(rumored, 1);
		EXPECT_LE(rumored, args.tuning.startingRumors);
		for (size_t poi = 0; poi < pois.pois.size(); ++poi) {
			if (pois.pois[poi].tier <= params.startingReveal) {
				EXPECT_TRUE(isFound(start, args, static_cast<int>(poi))) << "POI " << poi;
			}
		}
		EXPECT_TRUE(revealProblems(args).empty()) << revealProblems(args).front();
		EXPECT_TRUE(revealedAt(start.land, {.x = 0, .y = 0}, params.radius));
		const double explored = exploredShare(start.land);
		EXPECT_GT(explored, 0.02);
		EXPECT_LT(explored, 0.4);

		// Revealing a second tier takes in all the first did, and more.
		MapParams wider = params;
		wider.startingReveal = 2;
		const MapKnowledge further = startingKnowledge({.network = args.network, .pois = pois, .params = wider, .tuning = args.tuning});
		for (size_t id = 0; id < legs.size(); ++id) {
			if (start.legs[id] == LegKnowledge::Charted) {
				EXPECT_EQ(further.legs[id], LegKnowledge::Charted) << "leg " << id;
			}
		}
		EXPECT_GT(exploredShare(further.land), explored);
	}

} // namespace
