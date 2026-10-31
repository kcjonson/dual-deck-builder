#pragma once

// What the POI stage's tests and the stages after it share: POIs seated on random meshes over land of the tests' own,
// each mesh seated once a run, for shapes no seed draws and maps far quicker than a whole pipeline's. Tests only:
// nothing in the library includes it.

#include "AreaMapPipeline.h"
#include "MapParams.h"
#include "Pois.h"
#include "RouteTesting.h"
#include "RouteTree.h"

#include <random/Rng.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>

namespace rules::map::fixtures {

	// The base pack's map content.
	inline const MapContent& baseContent() {
		static const MapContent content = readMapContent(std::filesystem::path(DDB_PACKS_DIR) / "base");
		return content;
	}

	// Mixed's defaults at a radius.
	inline MapParams meshParams(int radius, int strongholds = 4) {
		MapParams params = environmentDefaults(0, Environment::Mixed);
		params.radius = radius;
		params.strongholds = strongholds;
		return params;
	}

	// Land with its ruins round the compound and three towns, ranges in the far west, and wet ground in the south.
	inline PoiGround fakePoiGround(double radius) {
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

	// A random mesh, its route tree, and the base pack's POIs seated on it over fakePoiGround.
	struct SeatedMesh {
		RoadNetwork network;
		RouteTree	tree;
		MapParams	params;
		PoiGround	ground;
		PoiLayer	layer;

		SeatedMesh(uint32_t seed, const MapParams& seatedParams, uint32_t stream = 0)
			: network(randomMesh({.seed = seed, .radius = static_cast<double>(seatedParams.radius)})),
			  tree(buildRouteTree({.network = network})),
			  params(seatedParams),
			  ground(fakePoiGround(seatedParams.radius)),
			  layer(placePois({
				  .network = network,
				  .tree = tree,
				  .ground = ground,
				  .params = params,
				  .tuning = baseContent().pois,
				  .factions = baseContent().factions,
				  .stops = baseContent().stops,
				  .stream = foundation::Rng(stream).fork("pois"),
			  })) {}
	};

	// Radius 800, which seats twenty-odd POIs.
	inline constexpr int kMeshRadius = 800;

	// The mesh of this seed at kMeshRadius, seated on stream 0 once a run.
	inline const SeatedMesh& seatedMesh(uint32_t seed) {
		static std::map<uint32_t, std::unique_ptr<SeatedMesh>> built;
		std::unique_ptr<SeatedMesh>&						   seated = built[seed];
		if (!seated) {
			seated = std::make_unique<SeatedMesh>(seed, meshParams(kMeshRadius));
		}
		return *seated;
	}

} // namespace rules::map::fixtures
