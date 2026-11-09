// The battle screen's bands and the road's grid (Battle Screen Design 2, road-view.md) at the sizes the spec checks: the
// 1280x720 slot is 205x141, spare height goes to rows and spare width to slots, the stage caps at 1600 and centres, and
// the tokens fit at every one of them.

#include "road/RoadLayout.h"
#include "road/VehicleToken.h"

#include <gtest/gtest.h>

namespace {

	using game::road::Bands;
	using game::road::RoadGrid;
	using game::road::VehicleToken;
	using rules::RoadLane;
	using rules::RoadSlot;
	using rules::Row;

	TEST(RoadLayout, TheBandsStackTopBarRoadAndDockWithTheRoadTakingTheRest) {
		const Bands bands = game::road::bandsFor({1280.0F, 720.0F});
		EXPECT_FLOAT_EQ(bands.topBar.height, 36.0F);
		EXPECT_FLOAT_EQ(bands.road.y, 36.0F);
		EXPECT_FLOAT_EQ(bands.road.height, 456.0F);
		EXPECT_FLOAT_EQ(bands.dock.y, 720.0F - 228.0F);
		EXPECT_FLOAT_EQ(bands.road.width, 1280.0F);
		EXPECT_FLOAT_EQ(bands.bleed, 0.0F);
		EXPECT_FLOAT_EQ(game::road::bandsFor({1280.0F, 800.0F}).road.height, 536.0F) << "spare height goes to the road";
	}

	TEST(RoadLayout, PastSixteenHundredTheStageCentresAndTheRoadArtBleedsToTheEdges) {
		const Bands bands = game::road::bandsFor({1920.0F, 1080.0F});
		EXPECT_FLOAT_EQ(bands.stage.width, 1600.0F);
		EXPECT_FLOAT_EQ(bands.stage.x, 160.0F);
		EXPECT_FLOAT_EQ(bands.road.x, 160.0F);
		EXPECT_FLOAT_EQ(bands.dock.x, 160.0F);
		EXPECT_FLOAT_EQ(bands.bleed, 160.0F);
		EXPECT_FLOAT_EQ(bands.road.height, 1080.0F - 36.0F - 228.0F);
	}

	TEST(RoadLayout, AtTheReferenceASlotIs205By141) {
		const RoadGrid grid = game::road::roadGrid(game::road::bandsFor({1280.0F, 720.0F}).road.size());
		EXPECT_FLOAT_EQ(grid.laneWidth, 205.0F);
		EXPECT_NEAR(grid.rowHeight, 141.0F, 0.5F);
		EXPECT_FLOAT_EQ(grid.laneX[0], 16.0F + 18.0F) << "past the pad and the row gutter";
		EXPECT_FLOAT_EQ(grid.rowY[0], 26.0F + 4.0F) << "under the lane header and the inset";
		const Foundation::Rect slot = grid.slotRect({.lane = RoadLane::RaiderInside, .row = Row::Behind});
		EXPECT_FLOAT_EQ(slot.x, 34.0F + 3.0F * 205.0F);
		EXPECT_FLOAT_EQ(slot.y, 30.0F + 2.0F * grid.rowHeight);
		EXPECT_FLOAT_EQ(slot.width, 205.0F);
		EXPECT_FLOAT_EQ(grid.rowsRect().y + grid.rowsRect().height, 456.0F - 4.0F);
		EXPECT_FLOAT_EQ(grid.rowsRect().x + grid.rowsRect().width, 1280.0F - 16.0F);
	}

	TEST(RoadLayout, TokensFitEverySpecSizeAndCapAtOneAndAQuarter) {
		struct Case {
			Foundation::Vec2 window;
			float			 scale;
		};
		for (const Case& size : {
				 Case{{1280.0F, 720.0F}, (205.0F - 6.0F) / 196.0F},
				 Case{{1280.0F, 800.0F}, (205.0F - 6.0F) / 196.0F},
				 Case{{1440.0F, 900.0F}, ((1440.0F - 50.0F) / 6.0F - 6.0F) / 196.0F},
				 Case{{1920.0F, 1080.0F}, VehicleToken::kMaxScale},
			 }) {
			const RoadGrid grid = game::road::roadGrid(game::road::bandsFor(size.window).road.size());
			EXPECT_TRUE(grid.tokensFit) << size.window.x << "x" << size.window.y;
			EXPECT_NEAR(grid.tokenScale, size.scale, 1e-4F) << size.window.x << "x" << size.window.y;
			// A passenger's taller token fits the same slot too.
			EXPECT_GE(VehicleToken::slotScale({grid.laneWidth, grid.rowHeight}, VehicleToken::kPassengerHeight), 1.0F);
		}
	}

	TEST(RoadLayout, ATooSmallRoadReportsItsScaleUnflooredAndThatTokensDontFit) {
		const RoadGrid grid = game::road::roadGrid({1000.0F, 400.0F});
		EXPECT_FALSE(grid.tokensFit);
		EXPECT_LT(grid.tokenScale, 1.0F);
	}

} // namespace
