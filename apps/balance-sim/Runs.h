#pragma once

#include "ConfigFields.h"
#include "Fights.h"
#include "Measures.h"
#include "Neighbors.h"
#include "RunsConfig.h"

#include <rules/campaign/Campaign.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/campaign/Events.h>
#include <rules/map/AreaMapPipeline.h>
#include <rules/map/RouteDescriptors.h>
#include <rules/map/StopData.h>

#include <array>
#include <cstdint>
#include <iosfwd>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace sim {

	// The balance sim's runs (Balance Simulation, runs): a crew, fresh and on its decks, out on a route of a generated
	// map and home, each stop in order through the campaign's own run code, as a supply run plays it. Its fights are
	// played as fights mode plays them; its finds, events, and rewards by the stand-in's rules (calls 440 and 441).

	// A map runs are played on: the seed asked for, what made it, and its layers as a run reads them, which reference a
	// map held elsewhere.
	struct RunMap {
		uint32_t				   seed{0};
		rules::campaign::MapOrigin origin;
		rules::campaign::MapLayers layers;
	};

	// Maps made from their rollParams seeds as founding makes one, the release build's way, going on to the next seed
	// past one whose attempts all fail. Each stays where it was made, since its layers point into it.
	struct MadeMaps {
		std::vector<std::unique_ptr<rules::campaign::CampaignMap>> made;
		std::vector<RunMap>										   maps;
	};

	// Spread over `workers` threads, the caller's among them. Each map is its seed's whatever the workers; the content
	// and the route tuning outlive the layers.
	[[nodiscard]] MadeMaps
	makeRunMaps(std::span<const uint32_t> seeds, const rules::map::MapContent& content, const rules::map::RouteTuning& routes, int workers);

	// A crew over a route at a game stage, fresh or behind its neighbor's run, named `road_warrior+interceptor:3/12.0@0`:
	// the crew, as fights mode names it, then the map's seed, the POI, and the route's place among the POI's, then the
	// stage. Behind a neighbor's run the route reads `3/7.1>12.0`.
	struct RunCell {
		std::string name;
		size_t		crew{0};
		size_t		map{0};
		int			poi{0};
		int			route{0};
		std::string routeName;
		int			tier{1};
		int			stage{0};
		// The stops it meets, by id, in driving order, and its risk as it leaves: the most skulls among their fights, 1
		// with none (call 13), which the return ambush fields (call 411).
		std::vector<int>		   stops;
		int						   risk{1};
		std::optional<NeighborRun> behind;
	};

	// Crew by crew, then map by map, then each map's routes in the config's tiers as offersToday lists them, or the
	// config's sample of them, then stage by stage, each fresh and then behind its neighbor's run where that run clears
	// any of its stops. A route a neighbor's run clears nothing of runs only fresh, since behind it would be the same run.
	[[nodiscard]] std::vector<RunCell> runCells(const RunsConfig& config, const SimRules& shared, std::span<const RunMap> maps);

	// How a run came out: home past its objective; failed, at a fight lost; or abandoned, at a fight still on at the turn
	// cap, which the sim leaves there unwritten.
	enum class RouteEnd { Home, Failed, Abandoned };

	[[nodiscard]] std::string_view routeEndName(RouteEnd end);

	// A stop a run met, or the return ambush on the road home, and what came of it.
	struct StopRecord {
		// The stop's type; none for the return ambush.
		std::optional<rules::map::StopType> type;
		// At an event: the event, the choice the stand-in took, and the outcome it landed on.
		std::optional<rules::campaign::EventId> event;
		std::string								choice;
		int										outcome{0};
		// The fight there: a fight stop's, the one an event turned into, or the ambush.
		std::optional<FightRecord> fight;

		bool operator==(const StopRecord&) const = default;
	};

	struct RouteRunRecord {
		RouteEnd end{RouteEnd::Home};
		// A pair seated the other way round from its crew's order, which every even run is.
		bool					swapped{false};
		std::vector<StopRecord> stops;
		// Paid at departure.
		int fuel{0};
		// Got to the POI and took its objective; the return ambush rolled there.
		bool objective{false};
		bool ambush{false};
		// A run home only: what the crew lost, off its records after the last stop against its archetypes' most, the
		// injury days it brings, and its cargo: resources, cards won, and drivers riding home.
		int						   hitpointsLost{0};
		int						   mostHitpoints{0};
		int						   structureLost{0};
		int						   mostStructure{0};
		int						   injuryDays{0};
		rules::campaign::Resources cargo;
		int						   cardsWon{0};
		int						   drivers{0};

		bool operator==(const RouteRunRecord&) const = default;
	};

	// Run `run`, counting from 1, of a cell: a campaign founded on the cell's map as the game founds one, its crew seated
	// from the pool on the decks the config gives them, sent out at the cell's stage as the campaign's run `run`, so
	// every stop draws on the map seed's fork("run", run). Behind a neighbor's run, that run's stops are cleared on day 1
	// and the day ends first. The stores are topped up to the route's fuel when they hold less. Then every stop in
	// order, the objective, the return ambush if it comes, and home: fights played by the stand-in and the raiders,
	// each find taken, an event's first choice the party can take (call 440), and each reward's first card (call 441).
	// With a `log`, each step and every fight's events are written to it in words.
	[[nodiscard]] RouteRunRecord playRouteRun(
		const RunsConfig&		config,
		const SimRules&			shared,
		std::span<const RunMap> maps,
		const RunCell&			cell,
		int						run,
		std::ostream*			log = nullptr
	);

	// Means of a run's cargo, a resource at a time.
	struct Supplies {
		double food{0};
		double water{0};
		double fuel{0};
		double meds{0};
		double scrap{0};
		double people{0};

		bool operator==(const Supplies&) const = default;
	};

	// Runs measured together, a cell's or a group's. Rates are over every run, what was lost and brought over the runs
	// home; a pair's by-seat home splits them by who sat in seat 1.
	struct RunRow {
		int	 runs{0};
		Rate home;
		Rate failed;
		Rate abandoned;
		// Runs that broke a fight off, and that met the return ambush, of those that took their objective.
		Rate							   brokenOff;
		Rate							   ambushed;
		std::optional<std::array<Rate, 2>> bySeat;
		std::optional<double>			   hitpointsLost;
		std::optional<double>			   structureLost;
		// HP and structure together, the mean of the two shares, as the per-run targets read them (call 442).
		std::optional<double> crewLost;
		Rate				  driverDown;
		std::optional<double> injuryDays;
		std::optional<double> turns;
		// Over every run: the stops it met and the fights it fought, the ambush among them, and the fuel it paid.
		std::optional<double> stopsMet;
		std::optional<double> fights;
		std::optional<double> fuel;
		// Over the runs home.
		std::optional<Supplies> cargo;
		std::optional<double>	cardsWon;
		std::optional<double>	drivers;

		bool operator==(const RunRow&) const = default;
	};

	// The pointers keep a group's runs where they are.
	[[nodiscard]] RunRow measureRuns(std::span<const RouteRunRecord* const> runs, bool pair);

	struct RunCellRow {
		std::string				   cell;
		CrewConfig				   crew;
		uint32_t				   map{0};
		int						   poi{0};
		int						   route{0};
		std::string				   routeName;
		int						   tier{1};
		int						   risk{1};
		int						   stage{0};
		std::optional<NeighborRun> behind;
		// The stops it meets as it leaves, `ambush:2`, `wreck`.
		std::vector<std::string> stops;
		RunRow					 measured;

		bool operator==(const RunCellRow&) const = default;
	};

	// Cells measured together by stage, pairs or lone drivers, and destination tier or route risk, one of the two and the
	// other 0: every crew pooled, or one crew's; fresh, or behind a neighbor's run.
	struct GroupRow {
		int			stage{0};
		int			seats{2};
		int			tier{0};
		int			risk{0};
		std::string crew;
		bool		behind{false};
		int			cells{0};
		RunRow		measured;

		bool operator==(const GroupRow&) const = default;
	};

	// The routes of a tier a neighbor's run clears any of, at a stage, pairs or lone drivers apart: how many of the
	// routes run, the share of their stops it clears, and those routes' runs fresh and behind it.
	struct NeighborRow {
		int					  stage{0};
		int					  seats{2};
		int					  tier{1};
		int					  routes{0};
		int					  of{0};
		std::optional<double> cleared;
		RunRow				  fresh;
		RunRow				  behind;

		bool operator==(const NeighborRow&) const = default;
	};

	// A kind of stop over the fresh runs that met it, a stop type's name or `return` for the ambush, at a stage, pairs or
	// lone drivers apart, a fight stop's and the ambush's by skull count: how often it came to a fight, those fights, and
	// at an event the choices taken, `event/choice`.
	struct StopRow {
		int			stage{0};
		int			seats{2};
		std::string kind;
		// A fight stop's or the ambush's; 0 for the rest, whose fights an event turned into come at their own.
		int						   skulls{0};
		int						   met{0};
		Rate					   fought;
		FightRow				   fights;
		std::map<std::string, int> choices;

		bool operator==(const StopRow&) const = default;
	};

	struct MapSummary {
		uint32_t seed{0};
		// The params' seed it settled on, and its fingerprint.
		uint32_t settled{0};
		uint64_t fingerprint{0};
		// Routes on offer in the config's tiers, and of those, the routes run.
		int routes{0};
		int run{0};

		bool operator==(const MapSummary&) const = default;
	};

	struct RunsReport {
		RunsConfig				 config;
		std::vector<MapSummary>	 maps;
		std::vector<RunCellRow>	 cells;
		std::vector<GroupRow>	 tiers;
		std::vector<GroupRow>	 risks;
		std::vector<StopRow>	 stops;
		std::vector<NeighborRow> neighbors;
		// Wall time and the stand-in's decisions, which no measure depends on, for what a decision costs.
		double seconds{0};
		int	   workers{1};
		int	   decisions{0};
		int	   fights{0};
	};

	// Every cell's runs, spread over `workers` threads, the caller's among them, by salal's TaskPool. Each run is a pure
	// function of the config, its map, its cell, and its number, and the measures are taken in cell and run order
	// afterwards, so the report is the same whatever the workers.
	[[nodiscard]] RunsReport playRuns(const RunsConfig& config, const SimRules& shared, std::span<const RunMap> maps, int workers);

	// A stop type as the map's content names it, `findSupplies`.
	[[nodiscard]] std::string stopTypeName(rules::map::StopType type);

} // namespace sim
