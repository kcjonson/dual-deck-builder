#include "RoadGrid.h"

#include <algorithm>
#include <cassert>
#include <cstdlib>

namespace rules {

	namespace {

		int laneIndex(RoadLane lane) {
			return static_cast<int>(lane);
		}

		int rowIndex(Row row) {
			return static_cast<int>(row);
		}

	} // namespace

	int slotRange(RoadSlot from, RoadSlot to) {
		return std::abs(laneIndex(from.lane) - laneIndex(to.lane)) + std::abs(rowIndex(from.row) - rowIndex(to.row));
	}

	RoadSlot roadSlotOf(Side side, FormationSlot slot) {
		const bool inside = slot.lane == Lane::Inside;
		if (side == Side::Player) {
			return {.lane = inside ? RoadLane::PlayerInside : RoadLane::PlayerOutside, .row = slot.row};
		}
		return {.lane = inside ? RoadLane::RaiderInside : RoadLane::RaiderOutside, .row = slot.row};
	}

	bool isShoulder(RoadLane lane) {
		return lane == RoadLane::PlayerShoulder || lane == RoadLane::RaiderShoulder;
	}

	bool inFormationOf(Side side, RoadLane lane) {
		if (side == Side::Player) {
			return lane == RoadLane::PlayerInside || lane == RoadLane::PlayerOutside;
		}
		return lane == RoadLane::RaiderInside || lane == RoadLane::RaiderOutside;
	}

	RoadLane flankShoulderOf(Side side) {
		return side == Side::Player ? RoadLane::RaiderShoulder : RoadLane::PlayerShoulder;
	}

	RoadLane otherLaneOf(RoadLane lane) {
		switch (lane) {
			case RoadLane::PlayerInside:
				return RoadLane::PlayerOutside;
			case RoadLane::PlayerOutside:
				return RoadLane::PlayerInside;
			case RoadLane::RaiderInside:
				return RoadLane::RaiderOutside;
			case RoadLane::RaiderOutside:
				return RoadLane::RaiderInside;
			case RoadLane::PlayerShoulder:
			case RoadLane::RaiderShoulder:
				break;
		}
		assert(false && "otherLaneOf: a shoulder isn't one of a formation's lanes");
		return lane;
	}

	std::optional<Row> rowAhead(Row row) {
		return row == Row::Ahead ? std::nullopt : std::optional(static_cast<Row>(rowIndex(row) - 1));
	}

	std::optional<Row> rowBehind(Row row) {
		return row == Row::Behind ? std::nullopt : std::optional(static_cast<Row>(rowIndex(row) + 1));
	}

	std::array<RoadSlot, 6> openingOrder(Side side, std::optional<Row> firstRow) {
		std::array<Row, 3> rows{Row::Center, Row::Behind, Row::Ahead};
		if (firstRow) {
			std::ranges::rotate(rows.begin(), std::ranges::find(rows, *firstRow), std::ranges::find(rows, *firstRow) + 1);
		}
		std::array<RoadSlot, 6> order{};
		size_t					next = 0;
		for (const Lane lane : {Lane::Inside, Lane::Outside}) {
			for (const Row row : rows) {
				order[next++] = roadSlotOf(side, {.lane = lane, .row = row});
			}
		}
		return order;
	}

	int tieRank(Side side, RoadSlot slot) {
		const RoadSlot inside = roadSlotOf(side, {.lane = Lane::Inside, .row = slot.row});
		const RoadSlot outside = roadSlotOf(side, {.lane = Lane::Outside, .row = slot.row});
		const RoadLane farShoulder = side == Side::Player ? RoadLane::RaiderShoulder : RoadLane::PlayerShoulder;
		int			   lane = 3;
		if (slot.lane == inside.lane) {
			lane = 0;
		} else if (slot.lane == outside.lane) {
			lane = 1;
		} else if (slot.lane == farShoulder) {
			lane = 2;
		}
		assert(lane < 3 && "tieRank: a side never sits on its own shoulder");
		return lane * 3 + rowIndex(slot.row);
	}

} // namespace rules
