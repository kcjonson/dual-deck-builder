#pragma once

#include <rules/core/Road.h>

#include <array>
#include <optional>

namespace rules {

	// The player's side acts first every turn.
	enum class Side { Player, Raiders };

	// The road's six lanes across, left to right (Combat Rules, The road). A side's formation is its inside and
	// outside lanes; its shoulder is only for the other side's flankers.
	enum class RoadLane { PlayerShoulder, PlayerOutside, PlayerInside, RaiderInside, RaiderOutside, RaiderShoulder };

	// A slot on the road, absolute rather than side-relative, so range is a function of two slots.
	struct RoadSlot {
		RoadLane lane{RoadLane::PlayerInside};
		Row		 row{Row::Center};

		bool operator==(const RoadSlot&) const = default;
	};

	// Lanes apart plus rows apart, with no diagonal shortcut.
	[[nodiscard]] int slotRange(RoadSlot from, RoadSlot to);

	// A side's formation slot as it sits on the road.
	[[nodiscard]] RoadSlot roadSlotOf(Side side, FormationSlot slot);

	[[nodiscard]] bool isShoulder(RoadLane lane);

	[[nodiscard]] bool inFormationOf(Side side, RoadLane lane);

	// The shoulder a side's flankers pull onto: the other side's.
	[[nodiscard]] RoadLane flankShoulderOf(Side side);

	// The other lane of a formation lane, in the same formation.
	[[nodiscard]] RoadLane otherLaneOf(RoadLane lane);

	[[nodiscard]] std::optional<Row> rowAhead(Row row);
	[[nodiscard]] std::optional<Row> rowBehind(Row row);

	// A side's formation in the order vehicles without a slot fill it: inside lane first, center, behind, then ahead.
	// With `firstRow`, each lane starts from that row instead, as a wave fills from the row the latest wreck left.
	[[nodiscard]] std::array<RoadSlot, 6> openingOrder(Side side, std::optional<Row> firstRow = std::nullopt);

	// How a tie on range breaks for `side` (Combat Rules, Orders): its inside lane, its outside lane, then the
	// other side's shoulder, and ahead, center, behind within a lane. Lower comes first.
	[[nodiscard]] int tieRank(Side side, RoadSlot slot);

} // namespace rules
