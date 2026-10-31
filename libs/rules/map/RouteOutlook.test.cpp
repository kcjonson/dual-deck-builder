#include <rules/map/PoiTesting.h>
#include <rules/map/RouteDescriptors.h>
#include <rules/map/RouteOutlook.h>
#include <rules/map/RouteTesting.h>
#include <rules/map/Stops.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <vector>

namespace {

	using namespace rules::map;
	using fixtures::meshFrom;

	const BiomeAt kScrub = [](Point) {
		return Biome::Scrub;
	};

	const StopTuning& tuning() {
		return fixtures::baseContent().stops;
	}

	// A road out of the compound that forks at node 1, the fork's two ends joined: a POI halfway along the join has two
	// routes, which share the leg to the fork and then go their own ways. On every leg an ambush, whose skulls are its
	// leg's id plus one, and then a wreck; on each last leg a distress signal past them, on from game stage 2 on the
	// first and 4 on the second.
	struct Fork {
		RoadNetwork					 network;
		RouteTree					 tree;
		RouteLegs					 legs;
		StopLayer					 stops;
		std::vector<RouteDescriptor> routes;
		MapParams					 params = fixtures::meshParams(600);

		Fork()
			: network(meshFrom(
				  {{0, 0}, {100, 0}, {300, 200}, {300, -200}},
				  {{.from = 0, .to = 1}, {.from = 1, .to = 2}, {.from = 1, .to = 3}, {.from = 2, .to = 3}}
			  )),
			  tree(buildRouteTree({.network = network})) {
			const MeetingPoint&		 point = *std::ranges::find(tree.meetingPoints, 3, &MeetingPoint::stretch);
			std::vector<Destination> destinations{arrivalsAt(network, tree, point, network.stretches[3].length / 2)};
			legs = buildLegs({.network = network, .tree = tree, .destinations = destinations});
			int extras = 0;
			for (size_t leg = 0; leg < legs.legs.size(); ++leg) {
				const double length = legs.legs[leg].length;
				LegStops&	 held = stops.legs.emplace_back(LegStops{.stops = {}, .extras = {}, .tier = 1, .territory = "none"});
				const auto	 add = [&](StopType type, double share, int skulls, int stage) {
					  (stage == 0 ? held.stops : held.extras).push_back(static_cast<int>(stops.stops.size()));
					  stops.stops.push_back({
						  .leg = static_cast<int>(leg),
						  .along = share * length,
						  .at = share,
						  .point = {},
						  .type = type,
						  .skulls = skulls,
						  .roadClass = RoadClass::BackRoad,
						  .biome = Biome::Scrub,
						  .stage = stage,
					  });
				};
				add(StopType::Ambush, 0.3, static_cast<int>(leg) + 1, 0);
				add(StopType::Wreck, 0.6, 0, 0);
				if (legs.legs[leg].destination >= 0) {
					add(StopType::Distress, 0.9, 0, extras++ == 0 ? 2 : 4);
				}
			}
			routes = describeRoutes(
				{.network = network, .routeLegs = legs, .destination = 0, .biomeAt = kScrub, .tuning = fixtures::routeTuning()}
			);
		}

		[[nodiscard]] RouteOutlook outlook(size_t route, const MapToday& today = {}) const {
			return outlookOf({
				.network = network,
				.routeLegs = legs,
				.stops = stops,
				.route = routes[route],
				.objectiveHours = 1.5,
				.params = params,
				.tuning = tuning(),
				.today = today,
			});
		}

		[[nodiscard]] std::vector<int> shown(const RouteOutlook& outlook) const {
			std::vector<int> ids;
			for (const KnownStop& stop : outlook.stops) {
				ids.push_back(stop.stop);
			}
			return ids;
		}
	};

	TEST(RouteOutlook, ReadAChartedRoutesStopsItsHoursAndItsReturnAgainstDark) {
		const Fork fork;
		ASSERT_EQ(fork.legs.legs.size(), 3U);
		ASSERT_EQ(fork.routes.size(), 2U);
		ASSERT_EQ(fork.routes[0].legs, (std::vector<int>{0, 1}));
		const RouteOutlook outlook = fork.outlook(0);
		EXPECT_EQ(outlook.knowledge, LegKnowledge::Charted);
		EXPECT_EQ(fork.shown(outlook), (std::vector<int>{0, 1, 2, 3}));
		EXPECT_TRUE(std::ranges::all_of(outlook.stops, [](const KnownStop& stop) { return stop.type.has_value() && !stop.cleared; }));
		// Two ambushes at an hour each and two wrecks at half an hour, out; the objective; home down the same road.
		const double drive = fork.routes[0].hours;
		EXPECT_DOUBLE_EQ(outlook.hours.out, drive + 3);
		EXPECT_DOUBLE_EQ(outlook.hours.objective, 1.5);
		EXPECT_DOUBLE_EQ(outlook.hours.home, drive);
		EXPECT_DOUBLE_EQ(outlook.back, tuning().dawn + 2 * drive + 3 + 1.5);
		EXPECT_DOUBLE_EQ(outlook.dark, tuning().dawn + fork.params.daylightHours);
		EXPECT_DOUBLE_EQ(outlook.spare, outlook.dark - outlook.back);
		EXPECT_EQ(outlook.risk, 2);
		EXPECT_FALSE(outlook.estimated);
	}

	TEST(RouteOutlook, TurnARoutesDormantExtrasOnAtTheirGameStage) {
		const Fork fork;
		EXPECT_EQ(fork.shown(fork.outlook(0, {.gameStage = 1})), (std::vector<int>{0, 1, 2, 3}));
		const RouteOutlook second = fork.outlook(0, {.gameStage = 2});
		EXPECT_EQ(fork.shown(second), (std::vector<int>{0, 1, 2, 3, 4}));
		EXPECT_DOUBLE_EQ(second.hours.out, fork.outlook(0).hours.out + 0.5);
		EXPECT_EQ(fork.shown(fork.outlook(1, {.gameStage = 3})), (std::vector<int>{0, 1, 5, 6}));
		EXPECT_EQ(fork.shown(fork.outlook(1, {.gameStage = 4})), (std::vector<int>{0, 1, 5, 6, 7}));
	}

	TEST(RouteOutlook, ShowARumoredLegsStopsUntypedAndNothingPastTheFirstUnchartedLegButItsNextStop) {
		const Fork		   fork;
		const double	   unknown = tuning().unknownStopHours;
		const RouteOutlook rumored = fork.outlook(1, {.legs = {LegKnowledge::Rumored, LegKnowledge::Uncharted, LegKnowledge::Charted}});
		EXPECT_EQ(rumored.knowledge, LegKnowledge::Rumored);
		EXPECT_EQ(fork.shown(rumored), (std::vector<int>{0, 1, 5, 6}));
		EXPECT_FALSE(rumored.stops[0].type.has_value());
		EXPECT_EQ(rumored.stops[0].skulls, 0);
		EXPECT_EQ(rumored.stops[2].type, StopType::Ambush);
		EXPECT_DOUBLE_EQ(rumored.hours.out, fork.routes[1].hours + 2 * unknown + 1.5);
		// Only the charted leg's ambush is known.
		EXPECT_EQ(rumored.risk, 3);
		EXPECT_TRUE(rumored.estimated);
		// Past an uncharted leg, a charted one counts as uncharted: a direction, the next stop, and what its road earns.
		const RouteOutlook fogged = fork.outlook(0, {.legs = {LegKnowledge::Uncharted, LegKnowledge::Charted, LegKnowledge::Charted}});
		EXPECT_EQ(fogged.knowledge, LegKnowledge::Uncharted);
		EXPECT_EQ(fork.shown(fogged), (std::vector<int>{0}));
		EXPECT_FALSE(fogged.stops[0].type.has_value());
		double earned = 0;
		for (const int leg : fork.routes[0].legs) {
			earned += legEarns(fork.network, fork.legs.legs[static_cast<size_t>(leg)], fork.params.stopDensity, tuning());
		}
		EXPECT_DOUBLE_EQ(fogged.hours.out, fork.routes[0].hours + earned * unknown);
		EXPECT_EQ(fogged.risk, 0);
		EXPECT_TRUE(fogged.estimated);
	}

	TEST(RouteOutlook, ShowAClearedStopClearedTakingItsFightOutOfTheRiskAndKeepingItsHours) {
		const Fork		   fork;
		const RouteOutlook cleared = fork.outlook(0, {.cleared = {2}});
		EXPECT_TRUE(cleared.stops[2].cleared);
		EXPECT_FALSE(cleared.stops[0].cleared);
		EXPECT_EQ(cleared.risk, 1);
		EXPECT_DOUBLE_EQ(cleared.hours.out, fork.outlook(0).hours.out);
	}

} // namespace
