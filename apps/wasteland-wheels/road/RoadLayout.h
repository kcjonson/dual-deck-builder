#pragma once

// The battle screen's bands and the road's grid (Battle Screen Design 2, road-view.md): pure functions of a size, which
// the scene runs on enter and on every resize, so nothing a vehicle does resizes a slot. The scene lays out in the ui's
// logical px, as every other scene does, and the ui's scale setting is the screen's scale: spare height goes to the rows,
// spare width to the slots, and the tokens scale up to 1.25 to fill them.

#include <rules/battle/RoadGrid.h>

#include <graphics/Rect.h>
#include <math/Types.h>

#include <array>

namespace game::road {

	inline constexpr float kTopBarHeight = 36.0F;
	inline constexpr float kDockHeight = 228.0F;
	inline constexpr float kMinRoadHeight = 456.0F;
	// The UI's column: on 21:9 the road's art runs to the window's edges, the UI doesn't.
	inline constexpr float kStageMaxWidth = 1600.0F;
	inline constexpr float kLaneHeader = 26.0F;
	inline constexpr float kRowGutter = 18.0F;
	inline constexpr float kRoadPad = 16.0F;
	inline constexpr float kRowInset = 4.0F;

	// The screen's bands in the window's logical px.
	struct Bands {
		Foundation::Rect stage; // the window's width capped at kStageMaxWidth, centred, its whole height
		Foundation::Rect topBar;
		Foundation::Rect road; // between the top bar and the dock, the stage's width
		Foundation::Rect dock;
		float			 bleed = 0.0F; // how far the road's art runs past the stage on each side, to the window's edges
	};

	[[nodiscard]] Bands bandsFor(Foundation::Vec2 window);

	// The road's grid in the road band's own space: six lanes across past a 16 px pad each side and the 18 px row gutter,
	// three rows down under the lane header and a 4 px inset. A slot is the whole cell.
	struct RoadGrid {
		Foundation::Vec2	 band;
		std::array<float, 6> laneX{}; // each lane's left edge, RoadLane's order
		float				 laneWidth = 0.0F;
		std::array<float, 3> rowY{}; // each row's top, Row's order
		float				 rowHeight = 0.0F;
		// Every token's scale (the mock's k for a 196x117 token), capped at 1.25 and never floored: under 1, tokensFit is
		// false, which is a layout failure.
		float tokenScale = 1.0F;
		bool  tokensFit = true;

		[[nodiscard]] Foundation::Rect slotRect(rules::RoadSlot slot) const;
		// The rows' box, under the header: what the turn banner centres on.
		[[nodiscard]] Foundation::Rect rowsRect() const;
	};

	[[nodiscard]] RoadGrid roadGrid(Foundation::Vec2 band);

} // namespace game::road
