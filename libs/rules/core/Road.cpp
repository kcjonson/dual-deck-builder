#include "Road.h"

namespace rules {

	FormationSlot readFormationSlot(JsonReader reader) {
		const FormationSlot slot{.lane = reader.requireEnum("lane", kLaneNames), .row = reader.requireEnum("row", kRowNames)};
		reader.finish();
		return slot;
	}

} // namespace rules
