#pragma once

#include "Ground.h"
#include "Places.h"
#include "Polyline.h"

#include <random/Rng.h>

#include <span>
#include <vector>

namespace rules::map {

	enum class DistrictKind { Metro, Town, Village };

	// A ruin a street grid is laid over: the metro, a town, or a village.
	struct Ruin {
		// Its place, by id: the metro is 0.
		int			 place{0};
		DistrictKind kind{DistrictKind::Metro};
		Point		 at;
		// World units.
		double radius{0};
	};

	// One grid of blocks: a town's, a village's, or one district of the metro. A block is a square `spacing` across
	// round its point, its sides along (ux, uy) and (-uy, ux); the streets between blocks are the view's to draw.
	struct StreetDistrict {
		int			 place{0};
		DistrictKind kind{DistrictKind::Metro};
		// A block corner, where two of its streets cross.
		Point  corner;
		double ux{1};
		double uy{0};
		double spacing{0};
		// Standing blocks and rubble.
		std::vector<Point> blocks;
		std::vector<Point> rubble;
	};

	// The metro, the towns, and the villages, in place id order.
	[[nodiscard]] std::vector<Ruin> ruinsOf(const Places& places);

	struct StreetGridArgs {
		std::span<const Ruin> ruins;
		// Every line through the grids, the roads, the collapsed spans, and the rails: a block one runs through, however
		// little of it, is street.
		std::span<const std::span<const Point>> lines;
		const Ground&							ground;
		// streetGrids.
		double built{0};
		// How much of each ruin's radius its grid covers, 0 to 1.
		double cover{0};
		// The grids' stream: each ruin forks its own by its place, `ruin`, and each district from that by its index,
		// `district`.
		foundation::Rng stream;
	};

	// Street grids (Area Map Generation, 11. Dressing; dressing.md, Street grids): each town and village one grid at a
	// drawn angle, the metro several districts at angles spread over a quarter turn that stop short of the line between
	// them, the old district line. A block stands out to a ragged edge round its ruin where its centre and corners are
	// dry and whole, no river lies within half a block of its centre, and no line runs through it; it stands by the
	// survival odds, falling toward the edge, or is rubble. The metro's districts first, then the towns' and the
	// villages', each with a block.
	[[nodiscard]] std::vector<StreetDistrict> streetGrids(const StreetGridArgs& args);

} // namespace rules::map
