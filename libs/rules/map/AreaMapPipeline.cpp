#include "AreaMapPipeline.h"

#include "Ground.h"
#include "PoiChecks.h"
#include "PoiNames.h"
#include "StopChecks.h"

#include <array>
#include <cassert>
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>

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
			map.places.emplace(input.params, *map.terrain, *map.water, *map.hazards, input.content.placeNames, stream);
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
			return checkRoads(*map.roads, input.params, Ground(*map.terrain, *map.water, *map.hazards));
		}

		// No check: the tree is a pure function of a network the roads stage checked, every node reaching home.
		void runRouteTree(const AreaMapInput& input, AreaMap& map, foundation::Rng&) {
			map.routeTree = buildRouteTree({
				.network = map.roads->network(),
				.travelPace = input.params.travelPace,
				.routeSplit = input.params.routeSplit,
			});
		}

		void runPois(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			const PoiGround ground = poiGround(Ground(*map.terrain, *map.water, *map.hazards), *map.places, input.params.radius);
			map.pois = placePois({
				.network = map.roads->network(),
				.tree = *map.routeTree,
				.ground = ground,
				.params = input.params,
				.tuning = input.content.pois,
				.factions = input.content.factions,
				.stops = input.content.stops,
				.stream = foundation::Rng(stream.seed()),
			});
		}

		// Every rule checkPoiLayer has, and, held strictly, every hard guarantee the layer missed.
		Problems checkPoisStage(const AreaMapInput& input, const AreaMap& map) {
			const bool lenient = poisHeldLeniently(input.params, *map.roads);
			Problems   problems;
			for (const PoiViolation& violation : checkPoiLayer({
					 .network = map.roads->network(),
					 .tree = *map.routeTree,
					 .layer = *map.pois,
					 .params = input.params,
					 .tuning = input.content.pois,
					 .stops = input.content.stops,
					 .sectors = !lenient,
				 })) {
				for (const auto& [name, rule] : kPoiRuleNames) {
					if (rule == violation.rule) {
						problems.push_back(std::string(name) + ": " + violation.detail);
					}
				}
			}
			if (!lenient) {
				for (const std::string& failure : map.pois->failures) {
					problems.push_back("guarantee: " + failure);
				}
			}
			return problems;
		}

		void runStops(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			const Ground  ground(*map.terrain, *map.water, *map.hazards);
			const BiomeAt biomeAt = [ground](Point at) {
				return ground.biome(at.x, at.y);
			};
			map.stops = placeStops({
				.network = map.roads->network(),
				.pois = *map.pois,
				.biomeAt = biomeAt,
				.params = input.params,
				.tuning = input.content.stops,
				.tables = input.content.stopTables,
				.stream = foundation::Rng(stream.seed()),
			});
		}

		// The hard rules alone: a route outside its band, or short on its own road, is in the layer's failures.
		Problems checkStopsStage(const AreaMapInput& input, const AreaMap& map) {
			return stopProblems(checkStopLayer({
				.network = map.roads->network(),
				.pois = *map.pois,
				.stops = *map.stops,
				.params = input.params,
				.tuning = input.content.stops,
				.tables = input.content.stopTables,
			}));
		}

		[[nodiscard]] KnowledgeArgs knowledgeOf(const AreaMapInput& input, const AreaMap& map) {
			return {.network = map.roads->network(), .pois = *map.pois, .params = input.params, .tuning = input.content.knowledge};
		}

		// The validator's guarantees no one stage's check holds, once the stage that completes them has passed its own.
		Problems spanningProblems(const AreaMapInput& input, const AreaMap& map, std::string_view stage) {
			if (stage == "pois") {
				return revealProblems(knowledgeOf(input, map));
			}
			return {};
		}

		// No check: what it makes is only ever drawn, and it writes nothing the stages before it made.
		void runDressing(const AreaMapInput& input, AreaMap& map, foundation::Rng& stream) {
			const AreaMap&				   made = map;
			const Ground				   ground(*made.terrain, *made.water, *made.hazards);
			const std::vector<std::string> names =
				poiNames(*made.pois, *made.places, input.content.pois, input.content.factions, input.params.radius);
			map.dressing = generateDressing({
				.params = input.params,
				.ground = ground,
				.places = *made.places,
				.network = made.roads->network(),
				.pois = *made.pois,
				.poiNames = names,
				.placeNames = input.content.placeNames,
				.featureNames = input.content.featureNames,
				.stream = foundation::Rng(stream.seed()),
			});
		}

	} // namespace

	MapContent readMapContent(const std::filesystem::path& pack) {
		return {
			.placeNames = readPlaceNames(pack / "map" / "place-names.json"),
			.featureNames = readFeatureNames(pack / "map" / "feature-names.json"),
			.pois = readPoiTuning(pack / "map" / "pois.json"),
			.factions = readFactions(pack / "factions" / "factions.json"),
			.stops = readStopTuning(pack / "map" / "stops.json"),
			.stopTables = readStopTables(pack / "map" / "stop-tables.json"),
			.knowledge = readKnowledgeTuning(pack / "map" / "knowledge.json"),
		};
	}

	bool poisHeldLeniently(const MapParams& params, const Roads& roads) {
		const int wanted = loopsWanted(params);
		return loopsNeeded(params, roads.inland()) < wanted && roads.loops() < wanted;
	}

	MapPipeline<AreaMapInput, AreaMap> areaMapPipeline() {
		return MapPipeline<AreaMapInput, AreaMap>{}
			.then({.name = "terrain", .run = runTerrain})
			.then({.name = "water", .run = runWater})
			.then({.name = "hazards", .run = runHazards, .check = checkHazards})
			.then({.name = "places", .run = runPlaces, .check = checkPlacesStage})
			.then({.name = "roads", .run = runRoads, .check = checkRoadsStage})
			.then({.name = "routeTree", .attempts = 1, .run = runRouteTree})
			.then({.name = "pois", .run = runPois, .check = checkPoisStage, .escalate = "roads"})
			.then({.name = "stops", .run = runStops, .check = checkStopsStage, .localRetry = true, .keepable = keepableStops})
			.then({.name = "dressing", .run = runDressing, .inert = true});
	}

	Problems validateAreaMap(const AreaMap& map, const AreaMapInput& input) {
		assert(map.stops && "validateAreaMap: a made map, every gameplay stage's product in it");
		using StageCheck = Problems (*)(const AreaMapInput&, const AreaMap&);
		const std::array<std::pair<std::string_view, StageCheck>, 5> checks{{
			{"hazards", checkHazards},
			{"places", checkPlacesStage},
			{"roads", checkRoadsStage},
			{"pois", checkPoisStage},
			{"stops", checkStopsStage},
		}};

		Problems problems;
		for (const auto& [stage, check] : checks) {
			for (const Problems& found : {check(input, map), spanningProblems(input, map, stage)}) {
				for (const std::string& problem : found) {
					problems.push_back(std::string(stage) + ": " + problem);
				}
			}
		}
		return problems;
	}

	AcceptHook<AreaMap> mapValidator(const AreaMapInput& input) {
		return [&input](const AreaMap& map, const StageAttempt& at) {
			return spanningProblems(input, map, at.stage);
		};
	}

	PipelineResult<AreaMap> generateAreaMap(const MapParams& params, const MapContent& content, const PipelineOptions<AreaMap>& options) {
		const AreaMapInput		  input{.params = params, .content = content};
		const AcceptHook<AreaMap> validator = mapValidator(input);
		PipelineOptions<AreaMap>  held = options;
		held.accept = [&validator, &options](const AreaMap& map, const StageAttempt& at) {
			Problems problems = validator(map, at);
			if (problems.empty() && options.accept) {
				problems = options.accept(map, at);
			}
			return problems;
		};
		return areaMapPipeline().run(params.seed, input, held);
	}

} // namespace rules::map
