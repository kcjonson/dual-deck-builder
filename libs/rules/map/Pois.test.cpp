#include <rules/map/AreaMapPipeline.h>
#include <rules/map/PoiChecks.h>
#include <rules/map/Pois.h>
#include <rules/map/RouteTesting.h>
#include <rules/map/StopRoom.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <map>
#include <memory>
#include <set>
#include <vector>

namespace {

	using namespace rules::map;

	const MapContent& base() {
		static const MapContent content = readMapContent(std::filesystem::path(DDB_PACKS_DIR) / "base");
		return content;
	}

	MapParams paramsAt(int radius, int strongholds = 4) {
		MapParams params = environmentDefaults(0, Environment::Mixed);
		params.radius = radius;
		params.strongholds = strongholds;
		return params;
	}

	// Land with its ruins round the compound and three towns, ranges in the far west, and wet ground in the south.
	PoiGround fakeGround(double radius) {
		const auto ruin = [](Point at) {
			double most = 0;
			for (const Point town :
				 {Point{.x = 0, .y = 0}, Point{.x = 350, .y = 200}, Point{.x = -300, .y = -350}, Point{.x = 150, .y = -500}}) {
				const double ratio = ((at.x - town.x) * (at.x - town.x) + (at.y - town.y) * (at.y - town.y)) / (60.0 * 60.0);
				most = std::max(most, ratio <= 1 ? 1 : ratio >= 4 ? 0 : (4 - ratio) / 3);
			}
			return most;
		};
		return {
			.radius = radius,
			.metroRadius = 0.15 * radius,
			.biome = [](Point at) { return at.x < -500	 ? Biome::Mountains
										   : at.y < -400 ? Biome::Mire
														 : Biome::Scrub; },
			.elevation = [](Point at) { return at.x < -500 ? 0.8 : 0.4; },
			.moisture = [](Point at) { return at.y < -400 ? 0.9 : 0.4; },
			.ruin = ruin,
		};
	}

	struct Seated {
		RoadNetwork network;
		RouteTree	tree;
		MapParams	params;
		PoiGround	ground;
		PoiLayer	layer;

		Seated(uint32_t seed, int radius, uint32_t stream = 0)
			: network(fixtures::randomMesh({.seed = seed, .radius = static_cast<double>(radius)})),
			  tree(buildRouteTree({.network = network})),
			  params(paramsAt(radius)),
			  ground(fakeGround(radius)),
			  layer(placePois({
				  .network = network,
				  .tree = tree,
				  .ground = ground,
				  .params = params,
				  .tuning = base().pois,
				  .factions = base().factions,
				  .stops = base().stops,
				  .stream = foundation::Rng(stream).fork("pois"),
			  })) {}
	};

	// Radius 800, each seated once a run.
	constexpr int kMeshRadius = 800;

	const Seated& seatedOn(uint32_t seed) {
		static std::map<uint32_t, std::unique_ptr<Seated>> built;
		std::unique_ptr<Seated>&						   seated = built[seed];
		if (!seated) {
			seated = std::make_unique<Seated>(seed, kMeshRadius);
		}
		return *seated;
	}

	std::vector<PoiViolation> violations(const Seated& seated) {
		return checkPoiLayer({
			.network = seated.network,
			.tree = seated.tree,
			.layer = seated.layer,
			.params = seated.params,
			.tuning = base().pois,
			.stops = base().stops,
		});
	}

	TEST(Sectors, StartAtTheirBoundaryAndRunCounterclockwiseToTheNext) {
		const Sectors four(10, 4);
		EXPECT_EQ(four.sectorOf({.x = 1, .y = 0.3}), 0);
		EXPECT_EQ(four.sectorOf({.x = 0, .y = 1}), 0);
		EXPECT_EQ(four.sectorOf({.x = -1, .y = 0.3}), 1);
		EXPECT_EQ(four.sectorOf({.x = -1, .y = -0.3}), 2);
		EXPECT_EQ(four.sectorOf({.x = 0.2, .y = -1}), 3);
		// Just under the first boundary is the last sector.
		EXPECT_EQ(four.sectorOf({.x = 1, .y = 0.1}), 3);
	}

	TEST(Pois, SeatAStrongholdInEverySectorAndPoisRingByRingKeepingEveryRuleTheChecksHave) {
		for (uint32_t seed = 0; seed < 2; ++seed) {
			const Seated&	seated = seatedOn(500 + seed);
			const PoiLayer& layer = seated.layer;
			EXPECT_TRUE(layer.failures.empty()) << "seed " << seed << ": " << (layer.failures.empty() ? "" : layer.failures.front());
			const std::vector<PoiViolation> found = violations(seated);
			EXPECT_TRUE(found.empty()) << "seed " << seed << ": " << (found.empty() ? "" : found.front().detail);
			ASSERT_EQ(layer.strongholds.size(), 4U);
			std::set<std::string> factions;
			for (size_t index = 0; index < layer.strongholds.size(); ++index) {
				const Stronghold& stronghold = layer.strongholds[index];
				EXPECT_EQ(stronghold.poi, static_cast<int>(index));
				EXPECT_EQ(stronghold.sector, static_cast<int>(index));
				EXPECT_EQ(layer.pois[index].type, kStrongholdType);
				EXPECT_EQ(layer.pois[index].tier, 5);
				factions.insert(stronghold.faction);
			}
			EXPECT_EQ(factions.size(), 4U);
			ASSERT_EQ(layer.rings.size(), 4U);
			int placed = 0;
			for (size_t ring = 0; ring < layer.rings.size(); ++ring) {
				EXPECT_EQ(layer.rings[ring].target, base().pois.rings.targets[ring]);
				EXPECT_LE(layer.rings[ring].placed, layer.rings[ring].target);
				placed += layer.rings[ring].placed;
			}
			EXPECT_EQ(layer.pois.size(), layer.strongholds.size() + static_cast<size_t>(placed));
			EXPECT_GT(placed, 20) << "seed " << seed;
			for (size_t poi = layer.strongholds.size(); poi < layer.pois.size(); ++poi) {
				const Poi& destination = layer.pois[poi];
				EXPECT_TRUE(base().pois.types.contains(destination.type)) << destination.type;
				EXPECT_TRUE(destination.tier == destination.ring + 1 || destination.tier == kDaylightTiers + 1);
			}
			std::vector<Destination> destinations;
			for (const Poi& poi : layer.pois) {
				destinations.push_back(poi.arrivals);
			}
			fixtures::expectLegsOverTheNetwork(seated.network, destinations, layer.legs, seated.params.routeSplit);
		}
	}

	TEST(Pois, TypeTheFirstRingToYieldFoodWaterAndFuel) {
		const Seated&	   seated = seatedOn(500);
		std::set<Resource> yielded;
		for (const Poi& poi : seated.layer.pois) {
			if (poi.tier == 1) {
				const PoiType& type = base().pois.types.at(poi.type);
				for (const Resource resource : base().pois.cover) {
					if (type.yields[static_cast<size_t>(resource)] > 0) {
						yielded.insert(resource);
					}
				}
			}
		}
		EXPECT_EQ(yielded.size(), base().pois.cover.size());
	}

	TEST(Pois, DrawTheSameLayerFromTheSameStreamAndAnotherFromAnother) {
		const Seated& first = seatedOn(500);
		const Seated  again(500, kMeshRadius);
		const Seated  other(500, kMeshRadius, 1);
		const auto	  sites = [](const PoiLayer& layer) {
			   std::vector<Point> at;
			   for (const Poi& poi : layer.pois) {
				   at.push_back(poi.site.at);
			   }
			   return at;
		};
		EXPECT_EQ(sites(first.layer), sites(again.layer));
		EXPECT_EQ(first.layer.sectorRotation, again.layer.sectorRotation);
		EXPECT_NE(sites(first.layer), sites(other.layer));
	}

	TEST(Pois, PlaceFewerThanTheTargetWhereTheMeetingPointsRunShortAndSaySo) {
		// A sparse mesh with few loops: few meeting points for four strongholds and thirty POIs.
		RoadNetwork		network = fixtures::randomMesh({.seed = 40, .radius = 700, .spacing = 120, .loops = 0.15});
		const RouteTree tree = buildRouteTree({.network = network});
		const MapParams params = paramsAt(700);
		const PoiGround ground = fakeGround(700);
		const PoiLayer	layer = placePois({
			 .network = network,
			 .tree = tree,
			 .ground = ground,
			 .params = params,
			 .tuning = base().pois,
			 .factions = base().factions,
			 .stops = base().stops,
			 .stream = foundation::Rng(3).fork("pois"),
		 });
		int				target = 0;
		int				placed = 0;
		for (const RingCount& ring : layer.rings) {
			target += ring.target;
			placed += ring.placed;
		}
		EXPECT_LT(placed, target);
		EXPECT_LE(layer.pois.size(), tree.meetingPoints.size());
	}

} // namespace
