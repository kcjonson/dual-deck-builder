#pragma once

#include "JsonReader.h"

#include <string_view>

namespace rules {

	// A formation's rows, front to back (Combat Rules, The road).
	enum class Row { Ahead, Center, Behind };

	inline constexpr EnumNames<Row, 3> kRowNames{{{"ahead", Row::Ahead}, {"center", Row::Center}, {"behind", Row::Behind}}};

	// The two lanes of a formation; shoulders are the road's, not a formation's.
	enum class Lane { Inside, Outside };

	inline constexpr EnumNames<Lane, 2> kLaneNames{{{"inside", Lane::Inside}, {"outside", Lane::Outside}}};

	struct FormationSlot {
		Lane lane{Lane::Inside};
		Row	 row{Row::Center};

		bool operator==(const FormationSlot&) const = default;
	};

	[[nodiscard]] FormationSlot readFormationSlot(JsonReader reader);

} // namespace rules
