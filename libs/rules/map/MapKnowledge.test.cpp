#include <rules/map/MapKnowledge.h>
#include <rules/map/PoiTesting.h>
#include <rules/map/RouteTesting.h>

#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace {

	using namespace rules::map;
	using fixtures::meshFrom;

	// Stretch ids, in the order the ladder lays them.
	enum Stretch { Trunk, Second, Third, Fourth, North, Up, South, Down, PoiA, PoiB, PoiC, Spur };

	// A highway east out of the compound past three junctions, a back road north and south off the first two, and the
	// north and south roads' ends joined, three POIs halfway along the joins: A between the two norths, B between the
	// second north and the highway's end, C between the two souths. The first highway stretch and a spur west of the
	// compound are city streets. Routes split wherever they like (routeSplit 1), since the ladder is too short for half.
	struct Ladder {
		RoadNetwork		network;
		RouteTree		tree;
		PoiLayer		pois;
		MapParams		params = fixtures::meshParams(600);
		KnowledgeTuning tuning{.sight = 0.06, .poiSight = 0.12, .startingRumors = 2};

		Ladder(int tierA, int tierB, int tierC, bool strongholdB)
			: network(meshFrom(
				  {{0, 0}, {100, 0}, {250, 0}, {400, 0}, {100, 100}, {250, 100}, {550, 0}, {100, -100}, {250, -100}, {-100, 0}},
				  {{.from = 0, .to = 1, .roadClass = RoadClass::Highway},
				   {.from = 1, .to = 2, .roadClass = RoadClass::Highway},
				   {.from = 2, .to = 3, .roadClass = RoadClass::Highway},
				   {.from = 3, .to = 6, .roadClass = RoadClass::Highway},
				   {.from = 1, .to = 4},
				   {.from = 2, .to = 5},
				   {.from = 1, .to = 7},
				   {.from = 2, .to = 8},
				   {.from = 4, .to = 5},
				   {.from = 5, .to = 6},
				   {.from = 7, .to = 8},
				   {.from = 0, .to = 9}}
			  )),
			  tree(buildRouteTree({.network = network, .routeSplit = 1})) {
			network.stretches[Trunk].street = true;
			network.stretches[Spur].street = true;
			params.startingReveal = 1;
			std::vector<Destination> destinations;
			for (const int stretch : {PoiA, PoiB, PoiC}) {
				const MeetingPoint& point = *std::ranges::find(tree.meetingPoints, stretch, &MeetingPoint::stretch);
				const double		along = network.stretches[static_cast<size_t>(stretch)].length / 2;
				destinations.push_back(arrivalsAt(network, tree, point, along));
				pois.pois.push_back({
					.site =
						{.at = pointAlong(network.stretches[static_cast<size_t>(stretch)].points, along),
						 .stretch = stretch,
						 .along = along},
					.arrivals = destinations.back(),
					.type = "clinic",
					.ring = 0,
					.tier = 0,
				});
			}
			pois.pois[0].tier = tierA;
			pois.pois[1].tier = tierB;
			pois.pois[2].tier = tierC;
			if (strongholdB) {
				pois.pois[1].type = std::string(kStrongholdType);
				pois.strongholds.push_back({.poi = 1, .faction = "mire_crawlers", .sector = 0});
			}
			pois.legs = buildLegs({.network = network, .tree = tree, .destinations = destinations});
		}

		[[nodiscard]] KnowledgeArgs args() const { return {.network = network, .pois = pois, .params = params, .tuning = tuning}; }

		// The leg that starts on this stretch: each of the ladder's legs starts on a different one.
		[[nodiscard]] int legFrom(Stretch stretch) const {
			const auto found = std::ranges::find_if(pois.legs.legs, [&](const Leg& leg) { return leg.pieces.front().stretch == stretch; });
			EXPECT_NE(found, pois.legs.legs.end()) << "no leg starts on stretch " << stretch;
			return static_cast<int>(found - pois.legs.legs.begin());
		}

		[[nodiscard]] LegKnowledge known(const MapKnowledge& knowledge, Stretch first) const {
			return knowledge.legs[static_cast<size_t>(legFrom(first))];
		}
	};

	TEST(MapKnowledge, ChartsTheRevealsTiersTheStreetsAndAHighwayOneLegFurtherAndRumorsTheNearestLegsOn) {
		const Ladder ladder(1, 2, 2, false);
		ASSERT_EQ(ladder.pois.legs.legs.size(), 9U);
		const MapKnowledge start = startingKnowledge(ladder.args());
		ASSERT_EQ(start.legs.size(), 9U);
		// A is tier 1, so every leg its routes drive is charted.
		for (const Stretch first : {Trunk, Second, North, Up, PoiA}) {
			EXPECT_EQ(ladder.known(start, first), LegKnowledge::Charted) << "the leg from stretch " << first;
		}
		// The highway runs one leg further, into B's tier: more highway than back road, though it ends on one.
		EXPECT_EQ(ladder.known(start, Third), LegKnowledge::Charted);
		// The radio's two rumors are C's routes, nearer than B's by the second north.
		EXPECT_EQ(ladder.known(start, South), LegKnowledge::Rumored);
		EXPECT_EQ(ladder.known(start, Down), LegKnowledge::Rumored);
		EXPECT_EQ(ladder.known(start, PoiB), LegKnowledge::Uncharted);
		// The land round charted road and the streets is seen, the street spur no route drives included, and only that.
		const double radius = ladder.params.radius;
		EXPECT_TRUE(revealedAt(start.land, {.x = 400, .y = 0}, radius));
		EXPECT_TRUE(revealedAt(start.land, {.x = -100, .y = 0}, radius));
		EXPECT_FALSE(revealedAt(start.land, {.x = 100, .y = -100}, radius));
		EXPECT_FALSE(revealedAt(start.land, {.x = -300, .y = 300}, radius));
		// Every POI is found: A and B by charted road into them, C by its rumored roads.
		for (int poi = 0; poi < 3; ++poi) {
			EXPECT_TRUE(isFound(start, ladder.args(), poi)) << "POI " << poi;
		}

		Ladder silent(1, 2, 2, false);
		silent.tuning.startingRumors = 0;
		EXPECT_EQ(silent.known(startingKnowledge(silent.args()), South), LegKnowledge::Uncharted);
		// With two tiers revealed, every leg is, and no POI is in a tier past it to rumor.
		Ladder wide(1, 2, 2, false);
		wide.params.startingReveal = 2;
		const MapKnowledge all = startingKnowledge(wide.args());
		EXPECT_TRUE(std::ranges::all_of(all.legs, [](LegKnowledge known) { return known == LegKnowledge::Charted; }));
	}

	TEST(MapKnowledge, ChartsALegOnTheStreetsPastTheRevealAndNeverRunsAHighwayIntoAStronghold) {
		// Every POI past the reveal: the trunk is charted only for its streets, and the highway on from it into C's tier.
		const Ladder	   far(3, 2, 2, false);
		const MapKnowledge start = startingKnowledge(far.args());
		EXPECT_EQ(far.known(start, Trunk), LegKnowledge::Charted);
		EXPECT_EQ(far.known(start, Second), LegKnowledge::Charted);
		EXPECT_EQ(far.known(start, North), LegKnowledge::Uncharted);

		const Ladder	   held(1, 5, 2, true);
		const MapKnowledge guarded = startingKnowledge(held.args());
		EXPECT_EQ(held.known(guarded, Third), LegKnowledge::Uncharted);
		EXPECT_EQ(held.known(guarded, PoiB), LegKnowledge::Uncharted);
		EXPECT_FALSE(isFound(guarded, held.args(), 1));
		EXPECT_TRUE(revealProblems(held.args()).empty());
	}

	TEST(MapKnowledge, NamesAStrongholdTheStartFindsOrTiersWithinATierOfTheReveal) {
		Ladder seen(1, 5, 2, true);
		seen.tuning.sight = 0.3;
		const std::vector<std::string> found = revealProblems(seen.args());
		ASSERT_EQ(found.size(), 1U);
		EXPECT_EQ(found[0], "reveal: the mire_crawlers stronghold, POI 1, is found at the start");
		const Ladder				   near(1, 2, 2, true);
		const std::vector<std::string> tiered = revealProblems(near.args());
		ASSERT_FALSE(tiered.empty());
		EXPECT_EQ(tiered[0], "reveal: the mire_crawlers stronghold, POI 1, is tier 2, within a tier of the starting reveal's 1");
	}

	TEST(MapKnowledge, RevealsWhatARunDrivesAndReachesAndNeverTakesKnowledgeBack) {
		const Ladder	   ladder(1, 5, 2, true);
		MapKnowledge	   knowledge = startingKnowledge(ladder.args());
		const MapKnowledge start = knowledge;
		const double	   radius = ladder.params.radius;
		const int		   intoB = ladder.legFrom(PoiB);
		EXPECT_FALSE(isFound(knowledge, ladder.args(), 1));
		rumorLeg(knowledge, intoB);
		EXPECT_EQ(knowledge.legs[static_cast<size_t>(intoB)], LegKnowledge::Rumored);
		EXPECT_TRUE(isFound(knowledge, ladder.args(), 1)) << "a leg into a stronghold rumored finds it";
		// Driving it charts it and sees the land along it, which a rumor doesn't take back.
		driveLeg(knowledge, ladder.args(), intoB);
		rumorLeg(knowledge, intoB);
		EXPECT_EQ(knowledge.legs[static_cast<size_t>(intoB)], LegKnowledge::Charted);
		EXPECT_TRUE(revealedAt(knowledge.land, {.x = 325, .y = 75}, radius));
		const Point site = ladder.pois.pois[1].site.at;
		EXPECT_FALSE(revealedAt(knowledge.land, {.x = site.x + 60, .y = site.y}, radius));
		reachPoi(knowledge, ladder.args(), 1);
		EXPECT_TRUE(revealedAt(knowledge.land, {.x = site.x + 60, .y = site.y}, radius));
		EXPECT_FALSE(revealedAt(knowledge.land, {.x = site.x + 90, .y = site.y}, radius));
		for (size_t leg = 0; leg < start.legs.size(); ++leg) {
			EXPECT_GE(knowledge.legs[leg], start.legs[leg]) << "leg " << leg;
		}
		LandFog both = knowledge.land;
		both |= start.land;
		EXPECT_EQ(both, knowledge.land);
	}

	TEST(MapKnowledge, ReadsTheBasePacksTuningAndRefusesSightsThatDontFit) {
		const KnowledgeTuning& tuning = fixtures::baseContent().knowledge;
		EXPECT_GT(tuning.sight, 0);
		EXPECT_GE(tuning.poiSight, tuning.sight);
		EXPECT_GE(tuning.startingRumors, 1);
		const std::filesystem::path file = std::filesystem::temp_directory_path() / "ddb-knowledge.test.json";
		const auto					refused = [&](const std::string& json, const std::string& field) {
			 std::ofstream(file, std::ios::binary) << json;
			 try {
				 (void)readKnowledgeTuning(file);
			 } catch (const rules::ContentError& error) {
				 return std::string(error.what()).find(field) != std::string::npos;
			 }
			 return false;
		};
		EXPECT_TRUE(refused(R"({"sight": 0, "poiSight": 0.1, "startingRumors": 2})", "sight"));
		EXPECT_TRUE(refused(R"({"sight": 0.1, "poiSight": 0.05, "startingRumors": 2})", "poiSight"));
		EXPECT_TRUE(refused(R"({"sight": 0.1, "poiSight": 0.2, "startingRumors": -1})", "startingRumors"));
		EXPECT_TRUE(refused(R"({"sight": 0.1, "poiSight": 0.2, "startingRumors": 2, "fog": 1})", "fog"));
		std::filesystem::remove(file);
	}

} // namespace
