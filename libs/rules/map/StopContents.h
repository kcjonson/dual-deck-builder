#pragma once

#include "PoiData.h"
#include "StopData.h"
#include "Stops.h"

#include <cstdint>
#include <optional>
#include <string>

namespace rules::map {

	// A Find: supplies stop's haul.
	struct Haul {
		Resource resource{Resource::Food};
		int		 amount{0};

		bool operator==(const Haul&) const = default;
	};

	// What a stop holds, rolled when a run reveals it (stops-and-routes.md, Contents): plain data the save can keep.
	struct StopContents {
		int stop{0};
		// How many times it's been rolled before: 0 the first time, up one each time it comes back after a cooldown.
		int		 roll{0};
		StopType type{StopType::Wreck};
		// Its type's hours, or a hazard's own, rolled.
		double hours{0};
		// The seed of the stream the run draws the rest from: a fight's raiders, a found driver, an event's outcome.
		uint32_t seed{0};
		// A hazard's kind, one of the tuning's; empty for any other stop.
		std::string			hazard;
		std::optional<Haul> supplies;

		bool operator==(const StopContents&) const = default;
	};

	// A stop's contents, a pure function of the layer's content seed, the stop's id, and the roll: from
	// fork("stop", id).fork("roll", roll), each field on a fork of its own, so nothing else on the map moves them
	// (call 9). The stop is one the layer has and the roll a count from 0.
	[[nodiscard]] StopContents rollStop(const StopLayer& layer, int stop, int roll, const StopTuning& tuning);

} // namespace rules::map
