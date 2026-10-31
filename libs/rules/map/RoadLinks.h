#pragma once

#include "EdgeCostField.h"
#include "MoveCost.h"
#include "Places.h"

#include <random/Rng.h>

#include <array>
#include <span>
#include <vector>

namespace rules::map {

	// What the links did.
	struct RoadLinkStats {
		// Searches run, and the cells they expanded.
		int searches{0};
		int expanded{0};
		// Highway exits a highway was laid from.
		int highways{0};
		// Back road candidates, and how each went: joining places not yet joined, closing a loop, skipped for a
		// detour short enough, or with no path.
		int candidates{0};
		int joined{0};
		int looped{0};
		int skipped{0};
		int failed{0};
		// Places still cut off after the links, joined to the nearest road the compound reaches.
		int stragglers{0};
		int spurs{0};
		// Diagonals dropped for closing a triangle with two road moves round their square.
		int triangles{0};
		// Places no road reaches, by id.
		std::vector<int> unreached;
	};

	// A road laid along a move between two cell centres.
	struct RoadMove {
		// The cells it joins, `from` the one it's filed under, and the move from there (kMoveX, kMoveY).
		int from{0};
		int to{0};
		int direction{0};
		// The best class laid along it.
		RoadClass roadClass{RoadClass::Highway};
		// The highway laid along it first, by its exit's order among the highway exits from 0; -1 for none.
		int	   highway{-1};
		double length{0};
		// It crosses a river on a bridge, the metro's included.
		bool bridged{false};
	};

	// The highest point of a road over a range, which the dressing can label.
	struct RoadPass {
		double x{0};
		double y{0};
	};

	// The road links as moves on the land grid: what the road graph is drawn from.
	struct RoadLinks {
		// In the field's move order, each once. A diagonal never closes a triangle with two road moves round its square,
		// and a cell beside the compound has at most one move into it.
		std::vector<RoadMove> moves;
		// Per place by id, the cell it stands on, -1 for one with no open cell to stand on. The compound stands
		// on the four cells round the origin, which compoundCells names.
		std::vector<int> placeCells;
		// Where spur trails stop.
		std::vector<int>	  spurEnds;
		std::vector<RoadPass> passes;
		RoadLinkStats		  stats;
	};

	struct RoadLinkArgs {
		EdgeCostField&		   field;
		std::span<const Place> places;
		double				   loops{0};
		double				   trailShare{0};
		const foundation::Rng& stream;
	};

	// Map 7, the road links (Area Map Generation, Pipeline, 5. Roads; road-network.md): least-cost paths
	// between the places over the field, laid as moves. Highways first, from each highway exit to the
	// compound through the best town near its bearing; then back roads along the Gabriel graph's links over
	// every place, about shortest first. A link joining places the roads don't yet connect always goes in;
	// one between places already connected only where the roads between them run longer than its own path by
	// the detour factor `loops` sets (Galin et al.'s test). Places still cut off join the nearest road the
	// compound reaches; then spur trails run into the high country from villages, and back roads give out to
	// trails across rough country by `trailShare`.
	//
	// The stream orders the links, drawing on its `links` fork, and the spurs, on `spur` forks by village id,
	// so another attempt links the places in another order. The places are placeList's.
	[[nodiscard]] RoadLinks layRoadLinks(const RoadLinkArgs& args);

	// The compound's four cells round the origin, the first of them its place cell.
	[[nodiscard]] std::array<int, 4> compoundCells(const LandGrid& grid);

} // namespace rules::map
