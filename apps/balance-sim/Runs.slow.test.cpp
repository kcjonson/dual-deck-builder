#include "Runs.h"
#include "RunReport.h"
#include "SimMapTesting.h"
#include "SimTesting.h"

#include <rules/campaign/Events.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <span>
#include <string_view>
#include <vector>

// Whole runs on the map tests' fixture map, which takes the map stages to build: the slow lane.
namespace {

	using namespace sim;
	using namespace sim::tests;
	using rules::map::StopType;

	RunsConfig read(std::string_view json) {
		return readRunsConfig(nlohmann::json::parse(json), "runs.json", baseContent());
	}

	StopType typeOf(int stop) {
		return fixtureMaps().front().layers.stops.stops[static_cast<size_t>(stop)].type;
	}

	bool meets(const RunCell& cell, auto&& kind) {
		return std::ranges::any_of(cell.stops, [&](int stop) { return kind(typeOf(stop)); });
	}

	bool isFind(StopType type) {
		return type == StopType::FindCards || type == StopType::FindSupplies || type == StopType::FindDriver;
	}

	TEST(Runs, ARunPlaysEveryStopInOrderAndComesOutTheSameEveryTime) {
		const RunsConfig		   config = read(R"({"crews": [["interceptor", "road_warrior"]], "neighbor": false})");
		const std::vector<RunCell> cells = runCells(config, baseRules(), fixtureMaps());
		const auto				   chosen = std::ranges::find_if(cells, [](const RunCell& cell) {
			return meets(cell, rules::map::isFight) && meets(cell, rules::campaign::resolvesAsEvent) && meets(cell, isFind);
		});
		ASSERT_NE(chosen, cells.end()) << "a route on the fixture map meets a fight, an event, and a find";
		const RunCell& cell = *chosen;
		EXPECT_TRUE(cell.name.starts_with("interceptor+road_warrior:" + std::to_string(fixtureMaps().front().seed) + "/"));

		const RouteRunRecord run = playRouteRun(config, baseRules(), fixtureMaps(), cell, 1);
		EXPECT_EQ(playRouteRun(config, baseRules(), fixtureMaps(), cell, 1), run);
		EXPECT_FALSE(run.swapped);
		EXPECT_TRUE(playRouteRun(config, baseRules(), fixtureMaps(), cell, 2).swapped);
		EXPECT_GT(run.fuel, 0);

		// A record for each stop met, in driving order, each fight stop fought and each event's choice taken.
		ASSERT_GE(run.stops.size(), run.end == RouteEnd::Home ? cell.stops.size() : 1);
		for (size_t place = 0; place < std::min(run.stops.size(), cell.stops.size()); ++place) {
			const StopRecord& stop = run.stops[place];
			ASSERT_EQ(stop.type, typeOf(cell.stops[place]));
			if (rules::map::isFight(*stop.type)) {
				EXPECT_TRUE(stop.fight.has_value()) << place;
			}
			if (isFind(*stop.type)) {
				EXPECT_FALSE(stop.fight.has_value()) << place;
			}
			if (rules::campaign::resolvesAsEvent(*stop.type)) {
				ASSERT_TRUE(stop.event.has_value());
				const rules::campaign::EventDefinition& event = baseRules().events.at(*stop.event);
				EXPECT_EQ(event.stopType, *stop.type);
				EXPECT_NO_THROW((void)rules::campaign::choiceOf(event, stop.choice));
			}
		}
		if (run.end == RouteEnd::Home) {
			EXPECT_TRUE(run.objective);
			// At stage 0 the return ambush never comes.
			EXPECT_FALSE(run.ambush);
			EXPECT_EQ(run.stops.size(), cell.stops.size());
			EXPECT_GT(run.mostHitpoints, 0);
			EXPECT_LE(run.hitpointsLost, run.mostHitpoints);
			EXPECT_LE(run.structureLost, run.mostStructure);
		} else {
			EXPECT_TRUE(run.stops.back().fight.has_value()) << "a run ends short of home at a fight";
		}
	}

	TEST(Runs, BehindItsNeighborsRunARouteMeetsOnlyTheStopsThatRunLeft) {
		const RunsConfig		   config = read(R"({"crews": [["interceptor", "mechanic"]]})");
		const std::vector<RunCell> cells = runCells(config, baseRules(), fixtureMaps());
		const auto				   behind = std::ranges::find_if(cells, [](const RunCell& cell) { return cell.behind.has_value(); });
		ASSERT_NE(behind, cells.end()) << "a neighbor's run clears some route's stops on the fixture map";
		// Its fresh run comes just before it.
		const RunCell& fresh = *(behind - 1);
		ASSERT_FALSE(fresh.behind.has_value());
		EXPECT_EQ(fresh.poi, behind->poi);
		EXPECT_EQ(fresh.route, behind->route);
		EXPECT_NE(behind->behind->poi, behind->poi);
		EXPECT_TRUE(behind->name.find('>') != std::string::npos);

		std::vector<int> left = fresh.stops;
		std::erase_if(left, [&](int stop) { return std::ranges::find(behind->behind->cleared, stop) != behind->behind->cleared.end(); });
		EXPECT_EQ(behind->stops, left);
		EXPECT_LT(behind->stops.size(), fresh.stops.size());
		EXPECT_LE(behind->risk, fresh.risk);

		const RouteRunRecord run = playRouteRun(config, baseRules(), fixtureMaps(), *behind, 1);
		for (size_t place = 0; place < std::min(run.stops.size(), behind->stops.size()); ++place) {
			EXPECT_EQ(run.stops[place].type, typeOf(behind->stops[place]));
		}
	}

	TEST(Runs, TheReportIsTheSameWhateverTheWorkers) {
		const RunsConfig config = read(R"({"crews": [["interceptor", "mechanic"]], "runs": 2, "routes": 2})");
		const RunsReport one = playRuns(config, baseRules(), fixtureMaps(), 1);
		const RunsReport three = playRuns(config, baseRules(), fixtureMaps(), 3);
		EXPECT_EQ(one.cells, three.cells);
		EXPECT_EQ(runReportJson(one, baseContent().packs).dump(), runReportJson(three, baseContent().packs).dump());

		ASSERT_EQ(one.maps.size(), 1U);
		EXPECT_EQ(one.maps.front().run, 2);
		EXPECT_GE(one.cells.size(), 2U);
		EXPECT_FALSE(one.tiers.empty());
		EXPECT_FALSE(one.stops.empty());
		EXPECT_GT(one.fights, 0);
	}

} // namespace
