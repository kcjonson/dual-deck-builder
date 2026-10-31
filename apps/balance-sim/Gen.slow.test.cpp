#include "Gen.h"
#include "GenReport.h"
#include "SimMapTesting.h"
#include "SimTesting.h"

#include <rules/map/StopRoom.h>

#include <gtest/gtest.h>

#include <span>
#include <string>

// The generator audit over the map tests' fixture map, which takes the map stages to build: the slow lane.
namespace {

	using namespace sim;
	using namespace sim::tests;

	// Balance Simulation, Tests: every route in its band, its fight floor met, and no stop type placed without a resolver.
	TEST(Gen, EveryRouteKeepsItsBandAndFightFloorAndMeetsOnlyStopsARunResolves) {
		const MapAudit				  audit = auditMap(baseRules(), fixtureRunMap());
		const rules::map::StopTuning& tuning = fixtureRunMap().layers.content.stops;
		ASSERT_FALSE(audit.routes.empty());
		for (const RouteAudit& route : audit.routes) {
			const rules::map::StopBand& band = rules::map::bandFor(route.tier, tuning);
			const std::string			where = std::to_string(route.poi) + "." + std::to_string(route.route);
			EXPECT_GE(route.fights(), band.fights.min) << where;
			EXPECT_EQ(route.unresolved, 0) << where;
			EXPECT_GE(route.ownFights, band.fights.min) << where << ": the floor's fights are on its own road";
			if (audit.stopFailures.empty()) {
				EXPECT_GE(static_cast<int>(route.stops.size()), band.stops.min) << where;
				EXPECT_LE(static_cast<int>(route.stops.size()), band.stops.max) << where;
			}
			EXPECT_LE(route.cleared, static_cast<int>(route.stops.size()));
			EXPECT_LE(route.ownStops, route.ownRoom) << where << ": own road holds no more than it has room for";
		}

		const GenReport report = auditMaps(GenConfig{.maps = {fixtureRunMap().seed}}, baseRules(), fixtureMaps(), 1);
		ASSERT_FALSE(report.tiers.empty());
		int routes = 0;
		for (const GenTierRow& row : report.tiers) {
			routes += row.routes;
			EXPECT_EQ(row.floorMet.count, row.routes);
		}
		EXPECT_EQ(routes, static_cast<int>(audit.routes.size()));
		EXPECT_TRUE(report.unresolved.empty());
		EXPECT_EQ(genReportJson(report, baseContent().packs)["maps"][0]["routes"].size(), audit.routes.size());
	}

} // namespace
