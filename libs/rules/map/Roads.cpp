#include "Roads.h"

#include "EdgeCostField.h"
#include "Ground.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <initializer_list>
#include <string>
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

		constexpr LoopRules kLoops;

		// The cycle rank of the road moves, the compound's four cells counted as one: the loops the network
		// drawn from them closes, since the graph only joins runs of moves into stretches.
		int roadLoops(const RoadLinks& links, const LandGrid& grid) {
			const std::array<int, 4> compound = compoundCells(grid);
			const auto				 vertexOf = [&](int cell) {
				  return std::ranges::find(compound, cell) != compound.end() ? compound[0] : cell;
			};
			// Per cell, its root among the cells roads join, -1 for none.
			std::vector<int> parent(static_cast<size_t>(grid.cells()), -1);
			const auto		 rootOf = [&](int cell) {
				  int root = cell;
				  while (parent[static_cast<size_t>(root)] != root) {
					  root = parent[static_cast<size_t>(root)];
				  }
				  return root;
			};
			int edges = 0;
			int vertices = 0;
			int pieces = 0;
			for (const RoadMove& move : links.moves) {
				const int a = vertexOf(move.from);
				const int b = vertexOf(move.to);
				edges += 1;
				for (const int vertex : {a, b}) {
					if (parent[static_cast<size_t>(vertex)] < 0) {
						parent[static_cast<size_t>(vertex)] = vertex;
						vertices += 1;
						pieces += 1;
					}
				}
				const int rootA = rootOf(a);
				const int rootB = rootOf(b);
				if (rootA != rootB) {
					parent[static_cast<size_t>(rootA)] = rootB;
					pieces -= 1;
				}
			}
			return edges - vertices + pieces;
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
		loopCount = roadLoops(roadLinks, terrain.surface().grid);
		worked = field.worked();
	}

	int loopsWanted(const MapParams& params) {
		return static_cast<int>(std::ceil(params.poiDensity * 30)) + params.strongholds;
	}

	int loopsNeeded(const MapParams& params, int inland) {
		const double share = std::min(kLoops.none + kLoops.rise * params.loops, kLoops.most);
		const int	 closable = inland > kLoops.first ? static_cast<int>(std::ceil(share * (inland - kLoops.first))) : 0;
		return std::min(closable, loopsWanted(params));
	}

	Problems checkRoads(const Roads& roads, const MapParams& params) {
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
		return problems;
	}

} // namespace rules::map
