#pragma once

#include "Hazards.h"
#include "MapParams.h"
#include "MapPipeline.h"
#include "PlaceNames.h"
#include "Terrain.h"
#include "Water.h"

#include <random/Rng.h>

#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace rules::map {

	enum class SettlementKind { Town, Village };

	// A town or a village: ruins round a named place the roads join.
	struct Settlement {
		int			   id{0};
		SettlementKind kind{SettlementKind::Town};
		double		   x{0};
		double		   y{0};
		// World units of ruins round it.
		double		radius{0};
		std::string name;
		// How good the ground is, the score it was taken by.
		double suitability{0};
	};

	// An unnamed place where county roads meet.
	struct Crossroads {
		int	   id{0};
		double x{0};
		double y{0};
	};

	// Where a road leaves the area at the rim.
	struct Exit {
		int	   id{0};
		double x{0};
		double y{0};
		// Degrees counterclockwise from east.
		double bearing{0};
		// A highway's exit, or a back road's.
		bool highway{false};
	};

	// Stage 4 of area map generation, the settlements (Area Map Generation, Pipeline, 4. Settlements;
	// places.md), after the hazards, on the `places` stream forked by feature: `suitability`, `towns`,
	// `villages`, `names`, `exits`, and `crossroads`. The metro sits at the centre. Towns and villages go
	// where real ones do, best ground first and spaced; exits where the highways and back roads leave at the
	// rim; crossroads Poisson-spaced over the rest by roadDensity. Every place stands where a road from the
	// metro surely reaches it, across rivers by bridges. Ids run the metro 0, then towns, villages,
	// crossroads, and exits.
	class Places {
	  public:
		// The params are validated, and the layers and name pool are theirs; `stream` is this stage's.
		Places(
			const MapParams&	   params,
			const Terrain&		   terrain,
			const Water&		   water,
			const Hazards&		   hazards,
			const PlaceNamePool&   names,
			const foundation::Rng& stream
		);

		// The metro's radius; it's place 0, at the origin.
		[[nodiscard]] double						 metroRadius() const { return metro; }
		[[nodiscard]] const std::vector<Settlement>& towns() const { return townList; }
		[[nodiscard]] const std::vector<Settlement>& villages() const { return villageList; }
		[[nodiscard]] const std::vector<Crossroads>& crossroads() const { return crossroadList; }
		// Highways' first, then back roads'.
		[[nodiscard]] const std::vector<Exit>& exits() const { return exitList; }

	  private:
		double					metro{0};
		std::vector<Settlement> townList;
		std::vector<Settlement> villageList;
		std::vector<Crossroads> crossroadList;
		std::vector<Exit>		exitList;
	};

	enum class PlaceKind { Metro, Town, Village, Crossroads, Exit };

	// Any place, as the roads join it.
	struct Place {
		int		  id{0};
		PlaceKind kind{PlaceKind::Metro};
		double	  x{0};
		double	  y{0};
		// An exit a highway leaves by.
		bool highway{false};
	};

	// Every place in id order: the metro at the origin, then the towns, villages, crossroads, and exits.
	[[nodiscard]] std::vector<Place> placeList(const Places& places);

	// Per square between cell centres (LandFields::openSquares' numbering): 1 where a flood fill from the
	// metro reaches it over open squares, less any a crater reaches into and any with a lake cell at a
	// corner. Rivers don't stop it, since roads bridge them. Exact for cliffs, craters, and lakes.
	[[nodiscard]] std::vector<uint8_t> reachedSquares(const Terrain& terrain, const Water& water, const Hazards& hazards);

	// What's wrong with the places: any but the metro off the squares a road from the metro surely reaches,
	// or in a river. The places stage's check.
	[[nodiscard]] Problems checkPlaces(const Places& places, const Terrain& terrain, const Water& water, const Hazards& hazards);

} // namespace rules::map
