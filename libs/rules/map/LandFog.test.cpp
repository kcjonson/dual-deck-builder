#include <rules/map/LandFog.h>
#include <rules/map/Polyline.h>

#include <gtest/gtest.h>

#include <vector>

namespace {

	using namespace rules::map;

	constexpr double kRadius = 600;

	// Every cell, by whether its centre is within `sight` of the line.
	void expectRevealedWithin(const LandFog& fog, const std::vector<Point>& line, double sight) {
		int revealed = 0;
		for (int row = 0; row < kFogCells; ++row) {
			for (int column = 0; column < kFogCells; ++column) {
				const FogCell cell{.column = column, .row = row};
				const Point	  centre = fogCellCentre(cell, kRadius);
				double		  nearest = pointSegmentDistanceSquared(centre, line.front(), line.front());
				for (size_t index = 1; index < line.size(); ++index) {
					nearest = std::min(nearest, pointSegmentDistanceSquared(centre, line[index - 1], line[index]));
				}
				EXPECT_EQ(fog.revealed(cell), nearest <= sight * sight) << "cell " << column << ", " << row;
				revealed += fog.revealed(cell) ? 1 : 0;
			}
		}
		EXPECT_GT(revealed, 0);
	}

	TEST(LandFog, RevealsTheCellsWhoseCentresAreInSightOfALineOrAPointAndNoOthers) {
		const std::vector<Point> line{{.x = -200, .y = -50}, {.x = 0, .y = 0}, {.x = 150, .y = 220}, {.x = 590, .y = 590}};
		LandFog					 alongLine;
		revealAround(alongLine, line, 36, kRadius);
		expectRevealedWithin(alongLine, line, 36);
		const std::vector<Point> point{{.x = 100, .y = -300}};
		LandFog					 round;
		revealAround(round, point, 72, kRadius);
		expectRevealedWithin(round, point, 72);
		EXPECT_TRUE(revealedAt(round, point.front(), kRadius));
		// The two together are what either reveals.
		LandFog both = alongLine;
		both |= round;
		for (int row = 0; row < kFogCells; ++row) {
			for (int column = 0; column < kFogCells; ++column) {
				const FogCell cell{.column = column, .row = row};
				EXPECT_EQ(both.revealed(cell), alongLine.revealed(cell) || round.revealed(cell));
			}
		}
	}

	TEST(LandFog, CutsTheDiscsSquareIntoCellsHoldsAPointPastItInTheEdgeCellAndCountsOnlyTheDiscExplored) {
		EXPECT_EQ(fogCellAt({.x = -kRadius, .y = -kRadius}, kRadius).column, 0);
		const FogCell middle = fogCellAt({.x = 0.1, .y = -0.1}, kRadius);
		EXPECT_EQ(middle.column, kFogCells / 2);
		EXPECT_EQ(middle.row, kFogCells / 2 - 1);
		const FogCell past = fogCellAt({.x = 2 * kRadius, .y = -2 * kRadius}, kRadius);
		EXPECT_EQ(past.column, kFogCells - 1);
		EXPECT_EQ(past.row, 0);
		const Point centre = fogCellCentre({.column = 0, .row = kFogCells - 1}, kRadius);
		EXPECT_DOUBLE_EQ(centre.x, -kRadius + kRadius / kFogCells);
		EXPECT_DOUBLE_EQ(centre.y, kRadius - kRadius / kFogCells);

		LandFog fog;
		EXPECT_EQ(exploredShare(fog), 0);
		// The square's corners lie off the disc, so revealing them explores nothing.
		fog.reveal({.column = 0, .row = 0});
		fog.reveal({.column = kFogCells - 1, .row = kFogCells - 1});
		EXPECT_EQ(exploredShare(fog), 0);
		for (int row = 0; row < kFogCells / 2; ++row) {
			for (int column = 0; column < kFogCells; ++column) {
				fog.reveal({.column = column, .row = row});
			}
		}
		EXPECT_DOUBLE_EQ(exploredShare(fog), 0.5);
		LandFog whole;
		whole.rows.fill(~uint64_t{0});
		EXPECT_DOUBLE_EQ(exploredShare(whole), 1);
	}

} // namespace
