#include <rules/map/AreaMapPipeline.h>
#include <rules/map/Ground.h>
#include <rules/map/Hazards.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace {

	using namespace rules::map;

	Ground groundFor(const MapParams& params) {
		return {fixtures::terrainFor(params), fixtures::waterFor(params), fixtures::hazardsFor(params)};
	}

	class EveryHazards : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		Hazards,
		EveryHazards,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::basin(), &fixtures::badlands())
	);

	TEST_P(EveryHazards, PlacesTheHotspotsAskedForAQuarterOfTheRadiusApartPastTheStart) {
		const MapParams&			params = *GetParam();
		const Terrain&				terrain = fixtures::terrainFor(params);
		const std::vector<Hotspot>& hotspots = fixtures::hazardsFor(params).hotspots();
		ASSERT_EQ(hotspots.size(), static_cast<size_t>(params.hotspots));
		for (size_t index = 0; index < hotspots.size(); ++index) {
			const Hotspot& site = hotspots[index];
			const double   away = std::hypot(site.x, site.y);
			EXPECT_GE(away, terrain.start().blend + 26);
			EXPECT_LE(away, 0.9 * params.radius);
			EXPECT_GE(site.craterRadius, 14);
			EXPECT_LE(site.craterRadius, 26);
			EXPECT_GE(site.plumeRadius, 5 * site.craterRadius);
			EXPECT_LE(site.plumeRadius, 8 * site.craterRadius);
			EXPECT_GE(site.strength, 0.75);
			EXPECT_LE(site.strength, 1);
			for (size_t other = 0; other < index; ++other) {
				EXPECT_GE(std::hypot(site.x - hotspots[other].x, site.y - hotspots[other].y), 0.25 * params.radius);
			}
		}
	}

	TEST_P(EveryHazards, KeepsEveryCraterOffTheDrainageTheRiversAndTheLakes) {
		const MapParams&   params = *GetParam();
		const LandSurface& land = fixtures::terrainFor(params).surface();
		const Water&	   water = fixtures::waterFor(params);
		const LandGrid&	   grid = land.grid;
		for (const Hotspot& site : fixtures::hazardsFor(params).hotspots()) {
			for (int row = 0; row < grid.size; ++row) {
				for (int column = 0; column < grid.size; ++column) {
					const double away = std::hypot(cellCentre(grid, column) - site.x, cellCentre(grid, row) - site.y);
					const auto	 cell = static_cast<size_t>(row * grid.size + column);
					if (away <= site.craterRadius + 2 * grid.cellSize) {
						EXPECT_LT(land.drainage.area[cell], 40) << "a crater sits on drainage";
					}
					if (away <= site.craterRadius + 20 + grid.cellSize) {
						EXPECT_LT(water.lakeOf()[cell], 0) << "a crater sits by a lake";
					}
				}
			}
			for (const River& river : water.rivers()) {
				for (const RiverPoint& point : river.line) {
					EXPECT_GE(std::hypot(point.x - site.x, point.y - site.y), site.craterRadius + 0.5 * point.width)
						<< "a river runs through a crater";
				}
			}
		}
	}

	TEST_P(EveryHazards, RaisesContaminationOnlyUnderAPlumeAndNeverInTheMetro) {
		const MapParams&			params = *GetParam();
		const Ground				plain(fixtures::terrainFor(params), fixtures::waterFor(params));
		const Ground				spilled = groundFor(params);
		const std::vector<Hotspot>& hotspots = fixtures::hazardsFor(params).hotspots();
		const double				metro = plain.terrain().start().metro;
		for (double x = -params.radius; x <= params.radius; x += params.radius / 20.0) {
			for (double y = -params.radius; y <= params.radius; y += params.radius / 20.0) {
				const double before = plain.contamination(x, y);
				const double after = spilled.contamination(x, y);
				ASSERT_GE(after, before);
				ASSERT_LE(after, 1);
				bool underAPlume = false;
				for (const Hotspot& site : hotspots) {
					underAPlume = underAPlume || std::hypot(x - site.x, y - site.y) < site.plumeRadius;
				}
				if (!underAPlume) {
					EXPECT_EQ(after, before);
				}
				if (std::hypot(x, y) <= metro) {
					EXPECT_EQ(after, 0);
				}
			}
		}
		for (const Hotspot& site : hotspots) {
			EXPECT_GE(spilled.contamination(site.x, site.y), site.strength);
		}
	}

	TEST_P(EveryHazards, MakesCratersOnlyInsideTheirRadius) {
		const MapParams& params = *GetParam();
		const Ground	 plain(fixtures::terrainFor(params), fixtures::waterFor(params));
		const Ground	 spilled = groundFor(params);
		for (const Hotspot& site : fixtures::hazardsFor(params).hotspots()) {
			EXPECT_TRUE(spilled.crater(site.x, site.y));
			EXPECT_TRUE(spilled.crater(site.x + 0.99 * site.craterRadius, site.y));
			EXPECT_FALSE(spilled.crater(site.x + site.craterRadius + 0.01, site.y));
			EXPECT_FALSE(plain.crater(site.x, site.y));
		}
	}

	TEST(Hazards, PlacesNoneWhenAskedForNone) {
		const MapParams& land = fixtures::mixed();
		MapParams		 none = land;
		none.hotspots = 0;
		const Hazards hazards(none, fixtures::terrainFor(land), fixtures::waterFor(land), fixtures::hazardsStream(land));
		EXPECT_TRUE(hazards.hotspots().empty());
		EXPECT_FALSE(hazards.crater(0, 0));
		EXPECT_EQ(hazards.plumes(100, 100, 0.25, 1), 0.25);
	}

	TEST(AreaMapPipeline, RetriesTheHazardsAloneLeavingTheTerrainAndTheWaterAsTheyWere) {
		const MapParams&			  params = fixtures::mixed();
		const PipelineResult<AreaMap> result =
			generateAreaMap(params, fixtures::placeNames(), {.accept = [](const AreaMap&, const StageAttempt& attempt) {
								return attempt.stage == "hazards" && attempt.attempt == 0 ? Problems{"no craters there"} : Problems{};
							}});
		EXPECT_EQ(result.mapAttempt, 0U);
		ASSERT_EQ(result.stages.size(), 5U);
		EXPECT_EQ(result.stages[0].attempt, 0U);
		EXPECT_EQ(result.stages[0].stream, fixtures::terrainStream(params).seed());
		EXPECT_EQ(result.stages[1].attempt, 0U);
		EXPECT_EQ(result.stages[1].stream, fixtures::waterStream(params).seed());
		EXPECT_EQ(result.stages[2].attempt, 1U);
		EXPECT_EQ(result.stages[2].stream, fixtures::hazardsStream(params, 1).seed());
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].stage, "hazards");

		EXPECT_EQ(result.products.terrain->surface().elevation, fixtures::terrainFor(params).surface().elevation);
		EXPECT_TRUE(std::ranges::equal(result.products.water->moisture(), fixtures::waterFor(params).moisture()));
		const Hazards retried(params, fixtures::terrainFor(params), fixtures::waterFor(params), fixtures::hazardsStream(params, 1));
		const auto&	  hotspots = result.products.hazards->hotspots();
		ASSERT_EQ(hotspots.size(), retried.hotspots().size());
		for (size_t index = 0; index < hotspots.size(); ++index) {
			EXPECT_EQ(hotspots[index].x, retried.hotspots()[index].x);
			EXPECT_EQ(hotspots[index].y, retried.hotspots()[index].y);
		}
		EXPECT_NE(hotspots.front().x, fixtures::hazardsFor(params).hotspots().front().x);
	}

} // namespace
