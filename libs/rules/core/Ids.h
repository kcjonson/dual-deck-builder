#pragma once

#include <compare>
#include <string>

namespace rules {

	// A content id from pack data, typed by what it names, so a card's id can't stand in for a driver's.
	template <typename Tag>
	struct Id {
		std::string value;

		auto operator<=>(const Id&) const = default;
	};

	using PackId = Id<struct PackTag>;
	using CardId = Id<struct CardTag>;
	using DriverId = Id<struct DriverTag>;
	using EscortId = Id<struct EscortTag>;
	using OpponentId = Id<struct OpponentTag>;
	using EncounterId = Id<struct EncounterTag>;

} // namespace rules
