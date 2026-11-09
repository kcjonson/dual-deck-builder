#include "road/RoadLayout.h"

#include "road/VehicleToken.h"

#include <algorithm>

namespace game::road {

	Bands bandsFor(Foundation::Vec2 window) {
		const float stageWidth = std::min(window.x, kStageMaxWidth);
		const float left = (window.x - stageWidth) * 0.5F;
		const float roadHeight = window.y - kTopBarHeight - kDockHeight;
		return {
			.stage = {left, 0.0F, stageWidth, window.y},
			.topBar = {left, 0.0F, stageWidth, kTopBarHeight},
			.road = {left, kTopBarHeight, stageWidth, roadHeight},
			.dock = {left, window.y - kDockHeight, stageWidth, kDockHeight},
			.bleed = left,
		};
	}

	RoadGrid roadGrid(Foundation::Vec2 band) {
		RoadGrid	grid{.band = band};
		const float gridX = kRoadPad + kRowGutter;
		const float rowsTop = kLaneHeader + kRowInset;
		grid.laneWidth = std::max(0.0F, band.x - kRoadPad * 2.0F - kRowGutter) / static_cast<float>(grid.laneX.size());
		grid.rowHeight = std::max(0.0F, band.y - rowsTop - kRowInset) / static_cast<float>(grid.rowY.size());
		for (size_t lane = 0; lane < grid.laneX.size(); ++lane) {
			grid.laneX.at(lane) = gridX + static_cast<float>(lane) * grid.laneWidth;
		}
		for (size_t row = 0; row < grid.rowY.size(); ++row) {
			grid.rowY.at(row) = rowsTop + static_cast<float>(row) * grid.rowHeight;
		}
		grid.tokenScale =
			std::min(VehicleToken::kMaxScale, VehicleToken::slotScale({grid.laneWidth, grid.rowHeight}, VehicleToken::kHeight));
		grid.tokensFit = grid.tokenScale >= 1.0F;
		return grid;
	}

	Foundation::Rect RoadGrid::slotRect(rules::RoadSlot slot) const {
		return {
			laneX.at(static_cast<size_t>(slot.lane)),
			rowY.at(static_cast<size_t>(slot.row)),
			laneWidth,
			rowHeight,
		};
	}

	Foundation::Rect RoadGrid::rowsRect() const {
		return {
			laneX.front(),
			rowY.front(),
			laneWidth * static_cast<float>(laneX.size()),
			rowHeight * static_cast<float>(rowY.size()),
		};
	}

} // namespace game::road
