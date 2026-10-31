#pragma once

#include <random/Rng.h>

#include <cstddef>
#include <filesystem>
#include <set>
#include <span>
#include <string>
#include <vector>

namespace rules::map {

	// The words towns and villages are named from: a first part and an ending (Ash + ford, Cold + " Springs").
	struct PlaceNamePool {
		std::vector<std::string> starts;
		std::vector<std::string> endings;
	};

	// A pack's map/place-names.json: {"starts": [...], "endings": [...]}, each a list of distinct, non-empty
	// strings. Anything else fails with a ContentError naming the file and the field.
	[[nodiscard]] PlaceNamePool readPlaceNames(const std::filesystem::path& file);

	// Hands out names no two alike on a map, and starts none with a first part already used while one is
	// left, so a map doesn't fill with Copper this and Copper that. Once every pairing is taken it numbers
	// them rather than looping.
	class PlaceNamer {
	  public:
		// The pool has to outlive the namer; `rng` is the places stream's `names` fork, or the dressing's for the
		// metro. Names `taken` already, and their first parts, count as used.
		PlaceNamer(const PlaceNamePool& pool, foundation::Rng&& rng, std::span<const std::string> taken = {});

		[[nodiscard]] std::string next();

	  private:
		const PlaceNamePool*  pool;
		foundation::Rng		  rng;
		std::set<std::string> used;
		std::set<size_t>	  startsUsed;
	};

} // namespace rules::map
