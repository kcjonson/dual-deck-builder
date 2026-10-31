#include "StopContents.h"

#include <random/Rng.h>

#include <cassert>
#include <cmath>
#include <cstddef>
#include <utility>

namespace rules::map {

	StopContents rollStop(const StopLayer& layer, int stop, int roll, const StopTuning& tuning) {
		assert(stop >= 0 && std::cmp_less(stop, layer.stops.size()) && "rollStop: a stop the layer has");
		assert(roll >= 0 && "rollStop: a roll is a count from 0");
		const StopType				type = layer.stops.at(static_cast<size_t>(stop)).type;
		const foundation::Rng		stream = foundation::Rng(layer.contentSeed).fork("stop", stop).fork("roll", roll);
		const StopTuning::Contents& contents = tuning.contents;
		StopContents				rolled{
						   .stop = stop,
						   .roll = roll,
						   .type = type,
						   .hours = tuning.types[static_cast<size_t>(type)].hours,
						   .seed = stream.fork("run").seed(),
						   .hazard = {},
						   .supplies = std::nullopt,
		   };
		if (type == StopType::Hazard) {
			const StopTuning::HourSteps& steps = contents.hazardHours;
			const int					 count = static_cast<int>(std::round((steps.max - steps.min) / steps.step));
			rolled.hours = steps.min + stream.fork("hours").nextInt(0, count) * steps.step;
			rolled.hazard = stream.fork("hazard").pick(contents.hazards);
		}
		if (type == StopType::FindSupplies) {
			foundation::Rng resources = stream.fork("resource");
			const Resource	resource =
				kResourceNames[static_cast<size_t>(resources.nextInt(0, static_cast<int>(kResourceNames.size()) - 1))].second;
			const IntRange& amount = contents.supplies[static_cast<size_t>(resource)];
			rolled.supplies = Haul{.resource = resource, .amount = stream.fork("amount").nextInt(amount.min, amount.max)};
		}
		return rolled;
	}

} // namespace rules::map
