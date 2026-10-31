#include <rules/map/MapTesting.h>
#include <rules/map/StreetGrids.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <span>
#include <vector>

namespace {

	using namespace rules::map;

	struct Grids {
		std::vector<Ruin>			ruins;
		std::vector<StreetDistrict> districts;
	};

	// A road east to west through the metro's middle.
	const std::vector<Point> kAcross{{.x = -200, .y = 0.5}, {.x = 200, .y = -0.5}};

	Grids gridsFor(const MapParams& params, double built, double cover, uint32_t seed) {
		const std::array<std::span<const Point>, 1> lines{kAcross};
		Grids										grids{.ruins = ruinsOf(fixtures::placesFor(params)), .districts = {}};
		grids.districts = streetGrids({
			.ruins = grids.ruins,
			.lines = lines,
			.ground = fixtures::groundFor(params),
			.built = built,
			.cover = cover,
			.stream = foundation::Rng(seed),
		});
		return grids;
	}

	// Whether `point` lies inside the block square round `centre`, not on its edge.
	bool insideBlock(const StreetDistrict& district, Point centre, Point point) {
		const double dx = point.x - centre.x;
		const double dy = point.y - centre.y;
		const double along = dx * district.ux + dy * district.uy;
		const double across = -dx * district.uy + dy * district.ux;
		return std::abs(along) < district.spacing / 2 - 1e-6 && std::abs(across) < district.spacing / 2 - 1e-6;
	}

	TEST(StreetGrids, LaysEveryRuinsBlocksInsideItsRaggedEdgeOnDryWholeGroundAndOffTheRoads) {
		const MapParams& params = fixtures::mixed();
		const Ground&	 ground = fixtures::groundFor(params);
		const Grids		 grids = gridsFor(params, 0.7, 1, 4);
		ASSERT_FALSE(grids.districts.empty());
		EXPECT_EQ(grids.districts.front().kind, DistrictKind::Metro);
		int metro = 0;
		for (const StreetDistrict& district : grids.districts) {
			const auto ruin = std::ranges::find(grids.ruins, district.place, &Ruin::place);
			ASSERT_NE(ruin, grids.ruins.end());
			EXPECT_EQ(district.kind, ruin->kind);
			EXPECT_NEAR(district.spacing, 9.8, 1e-9);
			EXPECT_NEAR(std::hypot(district.ux, district.uy), 1, 1e-9);
			metro += district.kind == DistrictKind::Metro ? 1 : 0;
			for (const std::vector<Point>* blocks : {&district.blocks, &district.rubble}) {
				for (const Point centre : *blocks) {
					EXPECT_LE(std::hypot(centre.x - ruin->at.x, centre.y - ruin->at.y), 1.15 * ruin->radius + 1e-9);
					EXPECT_EQ(ground.obstacle(centre.x, centre.y), Obstacle::None);
					EXPECT_EQ(ground.waterAt(centre.x, centre.y), WaterKind::None);
					EXPECT_FALSE(ground.rivers().near(centre.x, centre.y, district.spacing / 2));
					for (double along = 0; along <= 1; along += 1.0 / 800) {
						const Point on{
							.x = kAcross[0].x + (kAcross[1].x - kAcross[0].x) * along,
							.y = kAcross[0].y + (kAcross[1].y - kAcross[0].y) * along
						};
						ASSERT_FALSE(insideBlock(district, centre, on)) << "a block stands on the road at " << on.x << ", " << on.y;
					}
				}
			}
		}
		// The default metro covers 90 units: two districts and one for each 50 units of it.
		EXPECT_EQ(metro, 3);
	}

	TEST(StreetGrids, TurnsTheMetrosDistrictsApartStandsMoreAsStreetGridsRisesAndLaysNoneWithoutCover) {
		const Grids			built = gridsFor(fixtures::mixed(), 1, 1, 4);
		std::vector<double> angles;
		for (const StreetDistrict& district : built.districts) {
			if (district.kind == DistrictKind::Metro) {
				angles.push_back(std::fmod(std::atan2(district.uy, district.ux) * 180 / 3.141592653589793 + 360, 90));
			}
		}
		ASSERT_EQ(angles.size(), 3U);
		for (size_t a = 0; a < angles.size(); ++a) {
			for (size_t b = a + 1; b < angles.size(); ++b) {
				const double apart = std::abs(angles[a] - angles[b]);
				// Spread over a quarter turn, each jittered a quarter step: half a step apart at least.
				EXPECT_GE(std::min(apart, 90 - apart), 90.0 / 3 / 2 - 1e-6);
			}
		}
		const auto standing = [](const Grids& grids) {
			double blocks = 0;
			double all = 0;
			for (const StreetDistrict& district : grids.districts) {
				blocks += static_cast<double>(district.blocks.size());
				all += static_cast<double>(district.blocks.size() + district.rubble.size());
			}
			return blocks / all;
		};
		EXPECT_GT(standing(built), standing(gridsFor(fixtures::mixed(), 0, 1, 4)) + 0.3);
		EXPECT_TRUE(gridsFor(fixtures::mixed(), 0.7, 0, 4).districts.empty());
		const Grids again = gridsFor(fixtures::mixed(), 1, 1, 4);
		ASSERT_EQ(again.districts.size(), built.districts.size());
		EXPECT_EQ(again.districts.back().blocks, built.districts.back().blocks);
	}

} // namespace
