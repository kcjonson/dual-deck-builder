#include <rules/map/PoiTesting.h>
#include <rules/map/StopChecks.h>
#include <rules/map/StopContents.h>
#include <rules/map/StopRules.h>
#include <rules/map/StopTesting.h>
#include <rules/map/Stops.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <set>
#include <string>
#include <vector>

// The stops stage on random meshes with POIs seated on them, quicker than any map and with more legs.
namespace {

	using namespace rules::map;

	const StopTuning& tuning() {
		return fixtures::baseContent().stops;
	}

	const StopTables& tables() {
		return fixtures::baseContent().stopTables;
	}

	StopLayer stopsOn(const fixtures::SeatedMesh& seated, const MapParams& params, uint32_t stream = 0) {
		return placeStops({
			.network = seated.network,
			.pois = seated.layer,
			.biomeAt = seated.ground.biome,
			.params = params,
			.tuning = tuning(),
			.tables = tables(),
			.stream = foundation::Rng(stream).fork("stops"),
		});
	}

	StopLayer stopsOn(const fixtures::SeatedMesh& seated) {
		return stopsOn(seated, seated.params);
	}

	TEST(Stops, KeepEveryRuleOnRandomMeshesTheSoftOnesOnlyAsTheLayerReports) {
		for (const uint32_t seed : {500U, 501U}) {
			const fixtures::SeatedMesh& seated = fixtures::seatedMesh(seed);
			const StopLayer				layer = stopsOn(seated);
			fixtures::expectEveryHardRule({
				.network = seated.network,
				.pois = seated.layer,
				.stops = layer,
				.params = seated.params,
				.tuning = tuning(),
				.tables = tables(),
			});
			fixtures::expectStopsOnTheirLegs(seated.network, seated.layer, layer, tuning());
			fixtures::expectFloorsOnOwnRoad(seated.layer, layer, tuning());
			fixtures::expectHomeByDark(seated.layer, layer, tuning(), seated.params.daylightHours);
			std::set<int> lastLegs;
			for (const std::vector<int>& last : seated.layer.legs.lastLegs) {
				lastLegs.insert(last.begin(), last.end());
			}
			int extras = 0;
			for (size_t leg = 0; leg < layer.legs.size(); ++leg) {
				for (const int id : layer.legs[leg].extras) {
					const Stop& stop = layer.stops[static_cast<size_t>(id)];
					EXPECT_TRUE(isCalm(stop.type));
					EXPECT_TRUE(lastLegs.contains(static_cast<int>(leg)));
					EXPECT_TRUE(stop.stage == 2 || stop.stage == 4) << stop.stage;
					extras += 1;
				}
			}
			EXPECT_GT(extras, 0) << "seed " << seed;
			EXPECT_GT(layer.stops.size(), 3 * seated.layer.pois.size()) << "seed " << seed;
			for (const Stop& stop : layer.stops) {
				EXPECT_TRUE(isResolvable(stop.type));
			}
		}
	}

	TEST(Stops, PlaceNothingAndPassWhereThereAreNoPois) {
		const fixtures::SeatedMesh& seated = fixtures::seatedMesh(500);
		const PoiLayer				none;
		const StopLayer				layer = placeStops({
						.network = seated.network,
						.pois = none,
						.biomeAt = seated.ground.biome,
						.params = seated.params,
						.tuning = tuning(),
						.tables = tables(),
						.stream = foundation::Rng(0).fork("stops"),
		});
		EXPECT_TRUE(layer.stops.empty());
		EXPECT_TRUE(layer.legs.empty());
		EXPECT_TRUE(layer.failures.empty());
		EXPECT_TRUE(checkStopLayer({
									   .network = seated.network,
									   .pois = none,
									   .stops = layer,
									   .params = seated.params,
									   .tuning = tuning(),
									   .tables = tables(),
								   })
						.empty());
	}

	TEST(Stops, DrawTheSameLayerFromTheSameStreamAndAnotherFromAnother) {
		const fixtures::SeatedMesh& seated = fixtures::seatedMesh(500);
		const StopLayer				first = stopsOn(seated);
		EXPECT_TRUE(fixtures::sameStops(first, stopsOn(seated)));
		EXPECT_FALSE(fixtures::sameStops(first, stopsOn(seated, seated.params, 1)));
	}

	// At ten hours of daylight the near POIs' full bands run past dark, so their quickest routes shed stops, never below a
	// fight floor.
	TEST(Stops, ThinAQuickestRouteUntilItsRunIsHomeByDark) {
		MapParams params = fixtures::meshParams(fixtures::kMeshRadius);
		params.daylightHours = 10;
		const fixtures::SeatedMesh seated(500, params);
		const StopLayer			   layer = stopsOn(seated);
		EXPECT_GT(layer.thinned, 0);
		fixtures::expectHomeByDark(seated.layer, layer, tuning(), params.daylightHours);
		fixtures::expectFloorsOnOwnRoad(seated.layer, layer, tuning());
		fixtures::expectEveryHardRule({
			.network = seated.network,
			.pois = seated.layer,
			.stops = layer,
			.params = params,
			.tuning = tuning(),
			.tables = tables(),
		});
	}

	TEST(Stops, MeetTheFindDriverFloorInTiersOneAndTwo) {
		const fixtures::SeatedMesh& seated = fixtures::seatedMesh(501);
		MapParams					params = seated.params;
		params.driverFinds = 4;
		const StopLayer layer = stopsOn(seated, params);
		int				finds = 0;
		for (const LegStops& leg : layer.legs) {
			for (const int id : leg.stops) {
				finds += leg.tier <= tuning().driverFinds.floorTiers && layer.stops[static_cast<size_t>(id)].type == StopType::FindDriver
							 ? 1
							 : 0;
			}
		}
		EXPECT_GE(finds, 4);
		// Turning a calm stop takes no fight from any route.
		fixtures::expectFloorsOnOwnRoad(seated.layer, layer, tuning());
	}

	TEST(Stops, GiveAFightSkullsByItsTierAndDangerCurveAWarbandOneMore) {
		const fixtures::SeatedMesh& seated = fixtures::seatedMesh(500);
		for (const double danger : {0.5, 2.0}) {
			MapParams params = seated.params;
			params.dangerCurve = danger;
			const StopLayer layer = stopsOn(seated, params);
			int				fights = 0;
			for (const Stop& stop : layer.stops) {
				if (!isFight(stop.type)) {
					EXPECT_EQ(stop.skulls, 0);
					continue;
				}
				fights += 1;
				const double level = 1 + (layer.legs[static_cast<size_t>(stop.leg)].tier - 1) * tuning().skulls.step * danger;
				const int	 bonus = stop.type == StopType::Warband ? tuning().skulls.warband : 0;
				EXPECT_GE(stop.skulls, std::min(3, static_cast<int>(std::floor(level)) + bonus));
				EXPECT_LE(stop.skulls, std::min(3, static_cast<int>(std::floor(level)) + 1 + bonus));
			}
			EXPECT_GT(fights, 0);
		}
	}

	TEST(StopRules, NeverThreeFightsInARowNorThreeStopsWithoutANonFight) {
		using enum StopType;
		EXPECT_TRUE(keepsRules(std::vector{Ambush, Ambush, Wreck, Warband, Ambush}));
		EXPECT_FALSE(keepsRules(std::vector{Wreck, Ambush, Warband, Ambush}));
		// A checkpoint can turn into a fight, so it isn't a non-fight (call 4).
		EXPECT_FALSE(keepsRules(std::vector{Ambush, Checkpoint, Ambush}));
		EXPECT_TRUE(keepsRules(std::vector{Checkpoint, FindDriver, Checkpoint}));
	}

	TEST(StopRules, ArrangeALegsFightsAfterTheStopsBehindItEndingOnAsFewAsTheyCan) {
		using enum StopType;
		// Two fights behind: the leg can't open on a third, and ends calm where it can.
		EXPECT_EQ(
			arrange({.behind = std::vector{Ambush, Ambush}, .count = 3, .fights = 1, .shared = false}), (std::vector{false, true, false})
		);
		// Spread as evenly as they go, round the middles of five stops' halves.
		EXPECT_EQ(arrange({.behind = {}, .count = 5, .fights = 2, .shared = false}), (std::vector{false, true, false, true, false}));
		// Four fights in four stops break the rules after any start, so it takes a fight fewer.
		const std::vector<bool> fewer = arrange({.behind = {}, .count = 4, .fights = 4, .shared = false});
		EXPECT_EQ(std::ranges::count(fewer, true), 3);
		// Past the limit, a pattern: evenly spread, the last stop calm.
		const std::vector<bool> spread = arrange({.behind = {}, .count = kArrangeLimit + 1, .fights = 4, .shared = true});
		EXPECT_EQ(std::ranges::count(spread, true), 4);
		EXPECT_FALSE(spread.back());
		EXPECT_TRUE(arrange({.behind = {}, .count = 0, .fights = 0, .shared = false}).empty());
	}

	TEST(RollStop, IsAPureFunctionOfTheStopsIdAndItsRoll) {
		const StopLayer layer = stopsOn(fixtures::seatedMesh(500));
		ASSERT_GT(layer.stops.size(), 10U);
		const StopContents first = rollStop(layer, 3, 0, tuning());
		EXPECT_EQ(first, rollStop(layer, 3, 0, tuning()));
		EXPECT_EQ(first.stop, 3);
		EXPECT_EQ(first.type, layer.stops[3].type);
		EXPECT_EQ(first.hours, tuning().types[static_cast<size_t>(first.type)].hours);
		// The next roll, and another stop, draw afresh.
		EXPECT_NE(rollStop(layer, 3, 1, tuning()).seed, first.seed);
		EXPECT_NE(rollStop(layer, 4, 0, tuning()).seed, first.seed);
		// Nothing else on the map moves a stop's contents.
		StopLayer moved = layer;
		for (size_t id = 0; id < moved.stops.size(); ++id) {
			if (id != 3) {
				moved.stops[id].type = StopType::Ambush;
				moved.stops[id].along += 1;
			}
		}
		moved.stops.resize(8);
		EXPECT_EQ(rollStop(moved, 3, 0, tuning()), first);
	}

	TEST(RollStop, RollsAHazardsKindAndHoursAndASuppliesFindsHaulInsideTheTuning) {
		StopLayer			  layer = stopsOn(fixtures::seatedMesh(500));
		const StopTuning&	  stops = tuning();
		std::set<std::string> hazards;
		std::set<Resource>	  resources;
		for (int roll = 0; roll < 40; ++roll) {
			layer.stops[0].type = StopType::Hazard;
			const StopContents hazard = rollStop(layer, 0, roll, stops);
			EXPECT_GE(hazard.hours, stops.contents.hazardHours.min);
			EXPECT_LE(hazard.hours, stops.contents.hazardHours.max);
			EXPECT_DOUBLE_EQ(std::fmod(hazard.hours - stops.contents.hazardHours.min, stops.contents.hazardHours.step), 0);
			EXPECT_NE(std::ranges::find(stops.contents.hazards, hazard.hazard), stops.contents.hazards.end());
			EXPECT_FALSE(hazard.supplies.has_value());
			hazards.insert(hazard.hazard);
			layer.stops[0].type = StopType::FindSupplies;
			const StopContents find = rollStop(layer, 0, roll, stops);
			ASSERT_TRUE(find.supplies.has_value());
			const IntRange& range = stops.contents.supplies[static_cast<size_t>(find.supplies->resource)];
			EXPECT_GE(find.supplies->amount, range.min);
			EXPECT_LE(find.supplies->amount, range.max);
			EXPECT_TRUE(find.hazard.empty());
			resources.insert(find.supplies->resource);
		}
		EXPECT_GT(hazards.size(), 1U);
		EXPECT_GT(resources.size(), 1U);
	}

	// A layer whose route lost a fight, or whose fight sits off its own road, fails the floor, the one rule a kept
	// attempt may never break; one outside its band is only reported.
	TEST(StopChecks, FailARouteUnderItsFloorAndOnlyReportOneOutsideItsBand) {
		const fixtures::SeatedMesh& seated = fixtures::seatedMesh(500);
		const StopLayer				placed = stopsOn(seated);
		const auto					problems = [&](const StopLayer& layer) {
			 return stopProblems(checkStopLayer({
								 .network = seated.network,
								 .pois = seated.layer,
								 .stops = layer,
								 .params = seated.params,
								 .tuning = tuning(),
								 .tables = tables(),
			 }));
		};
		ASSERT_TRUE(problems(placed).empty());
		EXPECT_TRUE(keepableStops(problems(placed)));
		StopLayer calmed = placed;
		for (Stop& stop : calmed.stops) {
			if (isFight(stop.type)) {
				stop.type = StopType::Wreck;
				stop.skulls = 0;
			}
		}
		const std::vector<std::string> floor = problems(calmed);
		ASSERT_FALSE(floor.empty());
		EXPECT_TRUE(std::ranges::all_of(floor, [](const std::string& problem) { return problem.starts_with("floor: "); }));
		EXPECT_FALSE(keepableStops(floor));
		// Bands four stops longer leave every route short of its band, and most short on their own road, which the check
		// reports and the stage doesn't fail.
		StopTuning longer = tuning();
		for (StopBand& band : longer.bands) {
			band.stops.min += 4;
			band.stops.max += 4;
		}
		const std::vector<StopViolation> soft = checkStopLayer({
			.network = seated.network,
			.pois = seated.layer,
			.stops = placed,
			.params = seated.params,
			.tuning = longer,
			.tables = tables(),
		});
		EXPECT_GT(std::ranges::count(soft, StopRule::Band, &StopViolation::rule), 0);
		EXPECT_TRUE(std::ranges::none_of(soft, [](const StopViolation& violation) { return isHard(violation.rule); }));
		EXPECT_TRUE(stopProblems(soft).empty());
	}

} // namespace
