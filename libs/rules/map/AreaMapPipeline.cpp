#include "AreaMapPipeline.h"

#include <cstddef>
#include <string>

namespace rules::map {

	namespace {

		void runTerrain(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			map.terrain.emplace(input.params, stream);
		}

		void runWater(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			map.water.emplace(input.params, *map.terrain, stream);
		}

		void runHazards(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			map.hazards.emplace(input.params, *map.terrain, *map.water, stream);
		}

		// A hotspot finding no room is vanishingly rare, so a map short of one draws again.
		Problems checkHazards(const AreaMapInput& input, const AreaMap& map) {
			const size_t placed = map.hazards->hotspots().size();
			if (placed == static_cast<size_t>(input.params.hotspots)) {
				return {};
			}
			return {"placed " + std::to_string(placed) + " of " + std::to_string(input.params.hotspots) + " hotspots"};
		}

		void runPlaces(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			map.places.emplace(input.params, *map.terrain, *map.water, *map.hazards, input.placeNames, stream);
		}

		// An exit with no reachable ground near any turn of its bearings fails here, and the stage draws again.
		Problems checkPlacesStage(const AreaMapInput&, const AreaMap& map) {
			return checkPlaces(*map.places, *map.terrain, *map.water, *map.hazards);
		}

		void runRoads(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			map.roads.emplace(input.params, *map.terrain, *map.water, *map.hazards, *map.places, stream);
		}

		// The links are ordered by the stream, so another attempt links the places in another order.
		Problems checkRoadsStage(const AreaMapInput& input, const AreaMap& map) {
			return checkRoads(*map.roads, input.params);
		}

	} // namespace

	MapPipeline<AreaMapInput, AreaMap> areaMapPipeline() {
		return MapPipeline<AreaMapInput, AreaMap>{}
			.then({.name = "terrain", .run = runTerrain})
			.then({.name = "water", .run = runWater})
			.then({.name = "hazards", .run = runHazards, .check = checkHazards})
			.then({.name = "places", .run = runPlaces, .check = checkPlacesStage})
			.then({.name = "roads", .run = runRoads, .check = checkRoadsStage});
	}

	PipelineResult<AreaMap>
	generateAreaMap(const MapParams& params, const PlaceNamePool& placeNames, const PipelineOptions<AreaMap>& options) {
		const AreaMapInput input{.params = params, .placeNames = placeNames};
		return areaMapPipeline().run(params.seed, input, options);
	}

} // namespace rules::map
