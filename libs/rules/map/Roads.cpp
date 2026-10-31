#include "Roads.h"

#include "EdgeCostField.h"
#include "RoadChecks.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <numeric>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace rules::map {

	namespace {

		// The loops a map's places can close: none for the first `first`, then `none` a place at loops 0, rising
		// by `rise` times loops to at most `most`.
		struct LoopRules {
			int	   first = 4;
			double none = 0.3;
			double rise = 0.9;
			double most = 0.6;
		};

		// Highway spans this long or more can break, where their middle lies past `outside` of the radius.
		struct BrokenRules {
			double length = 70;
			double outside = 0.35;
		};

		constexpr LoopRules	  kLoops;
		constexpr BrokenRules kBroken;

		// Whether every node reaches the compound over the stretches not gone.
		bool allReach(size_t nodes, std::span<const RoadStretch> stretches, const std::set<size_t>& gone) {
			std::vector<std::vector<size_t>> linked(nodes);
			for (size_t id = 0; id < stretches.size(); ++id) {
				if (!gone.contains(id)) {
					linked[static_cast<size_t>(stretches[id].from)].push_back(static_cast<size_t>(stretches[id].to));
					linked[static_cast<size_t>(stretches[id].to)].push_back(static_cast<size_t>(stretches[id].from));
				}
			}
			std::vector<uint8_t> reached(nodes);
			std::vector<size_t>	 pending{0};
			reached[0] = 1;
			size_t count = 1;
			while (!pending.empty()) {
				const size_t node = pending.back();
				pending.pop_back();
				for (const size_t next : linked[node]) {
					if (reached[next] == 0) {
						reached[next] = 1;
						count += 1;
						pending.push_back(next);
					}
				}
			}
			return count == nodes;
		}

		// A route number for each highway, none twice: every number shuffled, and the first `highways` of them.
		std::vector<int> drawRouteNumbers(size_t highways, foundation::Rng& rng) {
			std::vector<int> numbers(static_cast<size_t>(kMostRouteNumber - kLeastRouteNumber + 1));
			std::iota(numbers.begin(), numbers.end(), kLeastRouteNumber);
			rng.shuffle(numbers);
			numbers.resize(highways);
			return numbers;
		}

	} // namespace

	Roads::Roads(
		const MapParams&	   params,
		const Terrain&		   terrain,
		const Water&		   water,
		const Hazards&		   hazards,
		const Places&		   places,
		const foundation::Rng& stream
	)
		: inlandCount(static_cast<int>(places.towns().size() + places.villages().size() + places.crossroads().size())) {
		const Ground			 ground(terrain, water, hazards);
		EdgeCostField			 field(ground, params.curviness);
		const std::vector<Place> list = placeList(places);
		roadLinks =
			layRoadLinks({.field = field, .places = list, .loops = params.loops, .trailShare = params.trailShare, .stream = stream});
		worked = field.worked();
		RoadGraph		roadGraph = buildRoadGraph({.links = roadLinks, .places = list, .ground = ground});
		foundation::Rng breaking = stream.fork("broken");
		BrokenHighways	split = breakHighways({
			 .nodes = roadGraph.nodes,
			 .stretches = std::move(roadGraph.stretches),
			 .places = list,
			 .count = params.brokenHighways,
			 .radius = params.radius,
			 .rng = breaking,
		 });
		const auto		highways =
			std::ranges::count_if(list, [](const Place& place) { return place.kind == PlaceKind::Exit && place.highway; });
		foundation::Rng numbering = stream.fork("numbers");
		roadNetwork = {
			.nodes = std::move(roadGraph.nodes),
			.stretches = std::move(split.stretches),
			.broken = std::move(split.broken),
			.passes = roadLinks.passes,
			.routeNumbers = drawRouteNumbers(static_cast<size_t>(highways), numbering),
		};
		graph = roadGraph.stats;
		networkLoops = loopCount(roadNetwork.nodes.size(), roadNetwork.stretches);
	}

	BrokenHighways breakHighways(BreakArgs args) {
		std::set<int> highwayExits;
		for (const Place& place : args.places) {
			if (place.kind == PlaceKind::Exit && place.highway) {
				highwayExits.insert(place.id);
			}
		}
		const std::vector<RoadStretch>& stretches = args.stretches;
		// Per node, the highway stretches ending on it, counted only at highway exits.
		std::map<int, int> exitHighways;
		for (const RoadStretch& stretch : stretches) {
			if (stretch.roadClass != RoadClass::Highway) {
				continue;
			}
			for (const int node : {stretch.from, stretch.to}) {
				if (highwayExits.contains(args.nodes[static_cast<size_t>(node)].place)) {
					exitHighways[node] += 1;
				}
			}
		}
		const auto lastAtExit = [&](const RoadStretch& stretch) {
			const auto from = exitHighways.find(stretch.from);
			const auto to = exitHighways.find(stretch.to);
			return (from != exitHighways.end() && from->second == 1) || (to != exitHighways.end() && to->second == 1);
		};
		const double		outside = kBroken.outside * args.radius;
		std::vector<size_t> candidates;
		for (size_t id = 0; id < stretches.size(); ++id) {
			const RoadStretch& stretch = stretches[id];
			if (stretch.roadClass != RoadClass::Highway || stretch.length < kBroken.length) {
				continue;
			}
			const Point middle = stretch.points[stretch.points.size() / 2];
			if (middle.x * middle.x + middle.y * middle.y > outside * outside) {
				candidates.push_back(id);
			}
		}
		args.rng.shuffle(candidates);
		std::set<size_t> gone;
		for (const size_t id : candidates) {
			if (std::cmp_greater_equal(gone.size(), args.count)) {
				break;
			}
			if (lastAtExit(stretches[id])) {
				continue;
			}
			gone.insert(id);
			if (!allReach(args.nodes.size(), stretches, gone)) {
				gone.erase(id);
				continue;
			}
			for (const int node : {stretches[id].from, stretches[id].to}) {
				if (const auto found = exitHighways.find(node); found != exitHighways.end()) {
					found->second -= 1;
				}
			}
		}
		BrokenHighways split;
		for (size_t id = 0; id < stretches.size(); ++id) {
			(gone.contains(id) ? split.broken : split.stretches).push_back(std::move(args.stretches[id]));
		}
		return split;
	}

	int loopsWanted(const MapParams& params) {
		return static_cast<int>(std::ceil(params.poiDensity * 30)) + params.strongholds;
	}

	int loopsNeeded(const MapParams& params, int inland) {
		const double share = std::min(kLoops.none + kLoops.rise * params.loops, kLoops.most);
		const int	 closable = inland > kLoops.first ? static_cast<int>(std::ceil(share * (inland - kLoops.first))) : 0;
		return std::min(closable, loopsWanted(params));
	}

	Problems checkRoads(const Roads& roads, const MapParams& params, const Ground& ground) {
		Problems				problems;
		const std::vector<int>& unreached = roads.links().stats.unreached;
		if (!unreached.empty()) {
			std::string ids;
			for (const int id : unreached) {
				ids += (ids.empty() ? "" : ", ") + std::to_string(id);
			}
			problems.push_back("reach: no road reaches places " + ids);
		}
		const int needed = loopsNeeded(params, roads.inland());
		if (roads.loops() < needed) {
			problems.push_back(
				"loops: the roads close " + std::to_string(roads.loops()) + " loops, and the POIs need " + std::to_string(needed)
			);
		}
		for (const RoadViolation& violation : checkRoadNetwork(roads.network(), ground)) {
			for (const auto& [name, rule] : kRoadRuleNames) {
				if (rule == violation.rule) {
					problems.push_back(std::string(name) + ": " + violation.detail);
				}
			}
		}
		return problems;
	}

} // namespace rules::map
