#include "RoadGrid.h"

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

	std::array<RoadSlot, 6> openingOrder(Side side) {
		std::array<RoadSlot, 6> order{};
		size_t					next = 0;
		for (const Lane lane : {Lane::Inside, Lane::Outside}) {
			for (const Row row : {Row::Center, Row::Behind, Row::Ahead}) {
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
