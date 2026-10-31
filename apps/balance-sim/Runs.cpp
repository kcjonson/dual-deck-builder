#include "Runs.h"

#include "Workers.h"

#include <rules/battle/BattleState.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/EventStops.h>
#include <rules/campaign/Founding.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>
#include <rules/core/Encounter.h>
#include <rules/map/RouteOffers.h>
#include <rules/map/RouteOutlook.h>
#include <rules/map/Stops.h>

#include <random/Rng.h>

#include <algorithm>
#include <chrono>
#include <format>
#include <functional>
#include <ostream>
#include <set>
#include <stdexcept>
#include <tuple>
#include <utility>

namespace sim {

	using namespace rules;
	using namespace rules::campaign;

	namespace {

		// Steps a run takes at most for each stop it meets, and on top: a stop is a fight, a find, or an event, then a
		// reward or a fight an event turned into and its reward; the objective, the ambush, and its reward come after.
		constexpr int kStepsAStop = 4;
		constexpr int kStepsBeyond = 8;

		Campaign foundOn(const RunMap& map, const SimRules& shared) {
			return foundCampaign(shared.content, shared.campaign, Founding{.map = map.origin, .unlocked = shared.unlocked});
		}

		int riskOf(const RunMap& map, std::span<const int> stops) {
			int risk = 1;
			for (const int stop : stops) {
				const map::Stop& met = map.layers.stops.stops[static_cast<size_t>(stop)];
				risk = map::isFight(met.type) ? std::max(risk, met.skulls) : risk;
			}
			return risk;
		}

		std::string routeLabel(int poi, int route) {
			return std::to_string(poi) + "." + std::to_string(route);
		}

		// A map's routes to POIs a run can leave for, as offersToday lists them on a fresh campaign, and which of them the
		// config runs.
		struct MapRoutes {
			std::vector<map::RouteOffer> offers;
			std::vector<size_t>			 run;
			int							 routes{0};
		};

		MapRoutes mapRoutes(const RunsConfig& config, const SimRules& shared, const RunMap& map) {
			MapRoutes routes{.offers = offersToday(foundOn(map, shared), map.layers)};
			std::erase_if(routes.offers, [](const map::RouteOffer& offer) { return offer.destination.stronghold; });
			for (size_t index = 0; index < routes.offers.size(); ++index) {
				if (std::ranges::find(config.tiers, routes.offers[index].destination.tier) != config.tiers.end()) {
					routes.run.push_back(index);
				}
			}
			routes.routes = static_cast<int>(routes.run.size());
			if (config.routes && static_cast<size_t>(*config.routes) < routes.run.size()) {
				foundation::Rng sample = foundation::Rng(map.seed).fork("routes");
				sample.shuffle(routes.run);
				routes.run.resize(static_cast<size_t>(*config.routes));
				std::ranges::sort(routes.run);
			}
			return routes;
		}

		// A map's cells for no crew yet, named from the map on, and what the map offered.
		struct MapCells {
			std::vector<RunCell> cells;
			MapSummary			 summary;
		};

		MapCells mapCells(const RunsConfig& config, const SimRules& shared, const RunMap& map, size_t index) {
			const MapRoutes				  routes = mapRoutes(config, shared, map);
			const std::map<int, Neighbor> nearest = nearestNeighbors(routes.offers);
			const std::string			  seed = std::to_string(map.seed) + "/";
			MapCells					  planned{
									 .summary = MapSummary{
										 .seed = map.seed,
										 .settled = map.origin.params.seed,
										 .fingerprint = map.origin.fingerprint,
										 .routes = routes.routes,
										 .run = static_cast<int>(routes.run.size()),
				 },
			 };
			std::vector<RunCell>& cells = planned.cells;
			for (const size_t chosen : routes.run) {
				const map::RouteOffer& offer = routes.offers[chosen];
				const int			   poi = offer.destination.poi;
				const int			   route = offer.route.route;
				for (const int stage : config.stages) {
					RunCell fresh{
						.name = seed + routeLabel(poi, route) + "@" + std::to_string(stage),
						.map = index,
						.poi = poi,
						.route = route,
						.routeName = offer.route.name,
						.tier = offer.destination.tier,
						.stage = stage,
						.stops = stopsMet(map.layers, offer.route.legs, stage),
					};
					fresh.risk = riskOf(map, fresh.stops);
					cells.push_back(fresh);
					if (!config.neighbor) {
						continue;
					}
					const auto near = nearest.find(poi);
					if (near == nearest.end()) {
						continue;
					}
					if (std::optional<NeighborRun> behind = neighborRun(map.layers, routes.offers, near->second.poi, fresh.stops, stage)) {
						RunCell after = fresh;
						after.name =
							seed + routeLabel(behind->poi, behind->route) + ">" + routeLabel(poi, route) + "@" + std::to_string(stage);
						after.stops = stopsMet(map.layers, offer.route.legs, stage, behind->cleared);
						after.risk = riskOf(map, after.stops);
						after.behind = std::move(behind);
						cells.push_back(std::move(after));
					}
				}
			}
			return planned;
		}

		// Every map's cells, crew by crew, and what each map offered.
		std::pair<std::vector<RunCell>, std::vector<MapSummary>>
		planRuns(const RunsConfig& config, const SimRules& shared, std::span<const RunMap> maps) {
			std::vector<MapCells> byMap;
			for (size_t index = 0; index < maps.size(); ++index) {
				byMap.push_back(mapCells(config, shared, maps[index], index));
			}
			const std::vector<std::string>							 labels = crewLabels(config.crews);
			std::pair<std::vector<RunCell>, std::vector<MapSummary>> planned;
			for (size_t crew = 0; crew < config.crews.size(); ++crew) {
				for (const MapCells& mapped : byMap) {
					for (RunCell cell : mapped.cells) {
						cell.crew = crew;
						cell.name = labels[crew] + ":" + cell.name;
						planned.first.push_back(std::move(cell));
					}
				}
			}
			for (MapCells& mapped : byMap) {
				planned.second.push_back(mapped.summary);
			}
			return planned;
		}

		// The first ready driver of the seat's archetype the pool has, not seated yet, or one recruited, on the seat's deck.
		CrewId seatFor(Campaign& campaign, const Content& content, const SeatConfig& seat, std::span<const CrewId> seated) {
			const auto	 found = std::ranges::find_if(campaign.drivers, [&](const DriverRecord& driver) {
				  return driver.archetype == seat.archetype && driver.status == DriverStatus::Ready &&
						 std::ranges::find(seated, driver.id) == seated.end();
			  });
			const CrewId id = found != campaign.drivers.end() ? found->id : recruitDriver(campaign, content, seat.archetype);
			campaign.driver(id).defaultDeck = deckOf(seat, content);
			return id;
		}

		// The event's first choice the party can take: every event has a free one (call 254).
		const EventChoice& firstOpenChoice(const Campaign& campaign, const SimRules& shared, const MapLayers& layers) {
			const EventDefinition& event = stopEvent(campaign, shared.events, layers);
			const auto			   open = std::ranges::find_if(event.choices, [&](const EventChoice& choice) {
				return !choiceBlocker(campaign, shared.events, layers, choice.id);
			});
			if (open == event.choices.end()) {
				throw std::logic_error("playRouteRun: the party can take none of " + event.id.value + "'s choices");
			}
			return *open;
		}

		bool home(const RouteRunRecord* run) {
			return run->end == RouteEnd::Home;
		}

		bool every(const RouteRunRecord*) {
			return true;
		}

		template <typename Count>
		int countStops(const RouteRunRecord* run, Count&& counted) {
			return static_cast<int>(std::ranges::count_if(run->stops, counted));
		}

		// What a report's runs played: its cells, and their runs, the config's runs a cell, in cell order.
		struct Played {
			const RunsConfig&				config;
			std::span<const RunMap>			maps;
			std::span<const RunCell>		cells;
			std::span<const RouteRunRecord> records;

			[[nodiscard]] size_t runs() const { return static_cast<size_t>(config.runs); }

			[[nodiscard]] int seatsOf(const RunCell& cell) const { return static_cast<int>(config.crews[cell.crew].size()); }

			// The runs of the cells `keep` keeps, in cell and run order, and how many cells.
			[[nodiscard]] std::pair<int, std::vector<const RouteRunRecord*>> gather(auto&& keep) const {
				std::pair<int, std::vector<const RouteRunRecord*>> gathered;
				for (size_t index = 0; index < cells.size(); ++index) {
					if (keep(cells[index])) {
						++gathered.first;
						for (size_t run = 0; run < runs(); ++run) {
							gathered.second.push_back(&records[index * runs() + run]);
						}
					}
				}
				return gathered;
			}
		};

		// A stage, and pairs or lone drivers, which every group is taken within.
		struct Slice {
			int stage{0};
			int seats{2};

			[[nodiscard]] bool holds(const Played& played, const RunCell& cell) const {
				return cell.stage == stage && played.seatsOf(cell) == seats;
			}
		};

		RunCellRow cellRow(const Played& played, size_t index) {
			const RunCell&					   cell = played.cells[index];
			std::vector<const RouteRunRecord*> runs;
			for (size_t run = 0; run < played.runs(); ++run) {
				runs.push_back(&played.records[index * played.runs() + run]);
			}
			std::vector<std::string> stops;
			for (const int stop : cell.stops) {
				const map::Stop& met = played.maps[cell.map].layers.stops.stops[static_cast<size_t>(stop)];
				stops.push_back(stopTypeName(met.type) + (map::isFight(met.type) ? ":" + std::to_string(met.skulls) : ""));
			}
			return RunCellRow{
				.cell = cell.name,
				.crew = played.config.crews[cell.crew],
				.map = played.maps[cell.map].seed,
				.poi = cell.poi,
				.route = cell.route,
				.routeName = cell.routeName,
				.tier = cell.tier,
				.risk = cell.risk,
				.stage = cell.stage,
				.behind = cell.behind,
				.stops = std::move(stops),
				.measured = measureRuns(runs, played.seatsOf(cell) == 2),
			};
		}

		// By destination tier, fresh and behind a neighbor's run, every crew pooled and then each crew.
		void tierRows(const Played& played, const Slice& slice, std::span<const int> tiers, std::vector<GroupRow>& rows) {
			const std::vector<std::string> labels = crewLabels(played.config.crews);
			for (const int tier : tiers) {
				for (const bool behind : {false, true}) {
					const auto inGroup = [&](const RunCell& cell) {
						return slice.holds(played, cell) && cell.tier == tier && cell.behind.has_value() == behind;
					};
					const auto [count, grouped] = played.gather(inGroup);
					if (count == 0) {
						continue;
					}
					GroupRow pooled{.stage = slice.stage, .seats = slice.seats, .tier = tier, .behind = behind, .cells = count};
					pooled.measured = measureRuns(grouped, slice.seats == 2);
					rows.push_back(pooled);
					for (size_t crew = 0; crew < played.config.crews.size(); ++crew) {
						const auto [crewCells, crewRuns] =
							played.gather([&](const RunCell& cell) { return inGroup(cell) && cell.crew == crew; });
						if (crewCells > 0) {
							GroupRow own = pooled;
							own.crew = labels[crew];
							own.cells = crewCells;
							own.measured = measureRuns(crewRuns, slice.seats == 2);
							rows.push_back(std::move(own));
						}
					}
				}
			}
		}

		// By route risk, fresh, every crew pooled.
		void riskRows(const Played& played, const Slice& slice, std::vector<GroupRow>& rows) {
			for (int risk = 1; risk <= kMostSkulls; ++risk) {
				const auto [count, grouped] =
					played.gather([&](const RunCell& cell) { return slice.holds(played, cell) && cell.risk == risk && !cell.behind; });
				if (count > 0) {
					rows.push_back(
						GroupRow{
							.stage = slice.stage,
							.seats = slice.seats,
							.risk = risk,
							.cells = count,
							.measured = measureRuns(grouped, slice.seats == 2),
						}
					);
				}
			}
		}

		// Each kind of stop over the fresh runs, the stop types in the map's order and the ambush last, a fight's by its
		// skulls.
		void stopRows(const Played& played, const Slice& slice, std::vector<StopRow>& rows) {
			struct Kind {
				StopRow					 row;
				std::vector<FightRecord> fights;
				int						 fought{0};
			};
			std::map<std::pair<size_t, int>, Kind>	 kinds;
			const std::vector<const RouteRunRecord*> fresh =
				played.gather([&](const RunCell& cell) { return slice.holds(played, cell) && !cell.behind; }).second;
			for (const RouteRunRecord* run : fresh) {
				for (const StopRecord& stop : run->stops) {
					const bool	 fightStop = !stop.type || map::isFight(*stop.type);
					const int	 skulls = fightStop ? stop.fight->skulls : 0;
					const size_t order = stop.type ? static_cast<size_t>(*stop.type) : map::kStopTypeCount;
					Kind&		 kind = kinds[{order, skulls}];
					kind.row.kind = stop.type ? stopTypeName(*stop.type) : "return";
					kind.row.skulls = skulls;
					++kind.row.met;
					if (stop.fight) {
						++kind.fought;
						kind.fights.push_back(*stop.fight);
					}
					if (stop.event) {
						++kind.row.choices[stop.event->value + "/" + stop.choice];
					}
				}
			}
			for (auto& [order, kind] : kinds) {
				kind.row.stage = slice.stage;
				kind.row.seats = slice.seats;
				kind.row.fought = rateOf(kind.fought, kind.row.met);
				kind.row.fights = measureFights(kind.fights);
				rows.push_back(std::move(kind.row));
			}
		}

		// By tier, the routes a neighbor's run clears any of, fresh and then behind it.
		void neighborRows(const Played& played, const Slice& slice, std::span<const int> tiers, std::vector<NeighborRow>& rows) {
			std::map<std::tuple<size_t, size_t, int, int>, const RunCell*> freshCells;
			for (const RunCell& cell : played.cells) {
				if (slice.holds(played, cell) && !cell.behind) {
					freshCells.emplace(std::tuple{cell.crew, cell.map, cell.poi, cell.route}, &cell);
				}
			}
			for (const int tier : tiers) {
				std::set<std::tuple<size_t, int, int>> routesRun;
				std::set<std::tuple<size_t, int, int>> routesBehind;
				std::set<const RunCell*>			   twins;
				std::vector<double>					   cleared;
				for (const RunCell& cell : played.cells) {
					if (!slice.holds(played, cell) || cell.tier != tier) {
						continue;
					}
					routesRun.emplace(cell.map, cell.poi, cell.route);
					if (cell.behind) {
						routesBehind.emplace(cell.map, cell.poi, cell.route);
						const RunCell& twin = *freshCells.at(std::tuple{cell.crew, cell.map, cell.poi, cell.route});
						twins.insert(&twin);
						const auto met = static_cast<int>(twin.stops.size());
						cleared.push_back(share(met - static_cast<int>(cell.stops.size()), met));
					}
				}
				if (routesBehind.empty()) {
					continue;
				}
				const auto behind = [&](const RunCell& cell) {
					return slice.holds(played, cell) && cell.tier == tier && cell.behind.has_value();
				};
				rows.push_back(
					NeighborRow{
						.stage = slice.stage,
						.seats = slice.seats,
						.tier = tier,
						.routes = static_cast<int>(routesBehind.size()),
						.of = static_cast<int>(routesRun.size()),
						.cleared = meanOf(cleared),
						.fresh =
							measureRuns(played.gather([&](const RunCell& cell) { return twins.contains(&cell); }).second, slice.seats == 2),
						.behind = measureRuns(played.gather(behind).second, slice.seats == 2),
					}
				);
			}
		}

	} // namespace

	MadeMaps makeRunMaps(std::span<const uint32_t> seeds, const map::MapContent& content, const map::RouteTuning& routes, int workers) {
		MadeMaps made;
		made.made.resize(seeds.size());
		inParallel(seeds.size(), workers, [&](size_t begin, size_t end) {
			for (size_t index = begin; index < end; ++index) {
				made.made[index] = std::make_unique<CampaignMap>(makeCampaignMap(seeds[index], content, MapMaking{.debug = false}));
			}
		});
		for (size_t index = 0; index < seeds.size(); ++index) {
			const CampaignMap& map = *made.made[index];
			made.maps.push_back(
				RunMap{.seed = seeds[index], .origin = map.origin, .layers = layersOf(map.map, map.origin, content, routes)}
			);
		}
		return made;
	}

	std::vector<RunCell> runCells(const RunsConfig& config, const SimRules& shared, std::span<const RunMap> maps) {
		return planRuns(config, shared, maps).first;
	}

	RouteRunRecord playRouteRun(
		const RunsConfig&		config,
		const SimRules&			shared,
		std::span<const RunMap> maps,
		const RunCell&			cell,
		int						run,
		std::ostream*			log
	) {
		if (run < 1) {
			throw std::invalid_argument("playRouteRun: runs count from 1");
		}
		const Content&		 content = shared.content;
		const CampaignRules& rules = shared.campaign;
		const RunMap&		 map = maps[cell.map];
		const MapLayers&	 layers = map.layers;
		const CrewConfig&	 crew = config.crews[cell.crew];
		RouteRunRecord		 record{.swapped = crew.size() == 2 && run % 2 == 0};
		CrewConfig			 seated = crew;
		if (record.swapped) {
			std::ranges::reverse(seated);
		}

		Campaign campaign = foundOn(map, shared);
		if (cell.behind) {
			for (const int stop : cell.behind->cleared) {
				clearStop(campaign.mapState, stop, campaign.day);
			}
			(void)endDay(campaign, content, rules);
		}
		campaign.nextRunNumber = run;
		std::vector<CrewId> seats;
		for (const SeatConfig& seat : seated) {
			seats.push_back(seatFor(campaign, content, seat, seats));
		}
		startRun(campaign, content, RunStart{.seats = seats, .escorts = {}, .stage = cell.stage});
		const RouteChoice choice{.poi = cell.poi, .route = cell.route};
		if (const std::optional<DepartBlocker> blocker = departBlocker(campaign, layers, choice)) {
			if (blocker->reason != DepartRefusal::Fuel) {
				throw std::logic_error("playRouteRun: no run leaves on " + cell.name);
			}
			campaign.stores.fuel = blocker->fuel;
		}
		const int fuel = campaign.stores.fuel;
		depart(campaign, layers, choice);
		record.fuel = fuel - campaign.stores.fuel;
		if (campaign.run->route->stops != cell.stops) {
			throw std::logic_error("playRouteRun: " + cell.name + " left meeting other stops than the map gave the cell");
		}

		const StandIn standIn(config.standIn);
		const int	  mostSteps = kStepsAStop * static_cast<int>(cell.stops.size()) + kStepsBeyond;
		for (int step = 0;; ++step) {
			if (step > mostSteps) {
				throw std::logic_error("playRouteRun: " + cell.name + " is still on the road after " + std::to_string(step) + " steps");
			}
			const Ahead next = ahead(campaign, layers);
			if (next == Ahead::Home) {
				break;
			}
			// A record for each stop met and for the ambush past them, at its place among them.
			const RunRoute& route = *campaign.run->route;
			const auto		place = static_cast<size_t>(route.next);
			if (next != Ahead::Objective && next != Ahead::Reward && record.stops.size() <= place) {
				StopRecord met;
				if (place < route.stops.size()) {
					met.type = layers.stops.stops[static_cast<size_t>(route.stops[place])].type;
				}
				if (log) {
					*log << (met.type ? std::format("stop {}: {}\n", place + 1, stopTypeName(*met.type)) : "the road home\n");
				}
				record.stops.push_back(std::move(met));
			}
			switch (next) {
				case Ahead::Fight: {
					CampaignFightStart started = startRunFight(campaign, content, layers);
					CampaignFight&	   fight = started.fight;
					const int		   skulls = content.encounters.at(fight.encounter).skulls;
					if (log) {
						*log << std::format("  fight: {}, {} skull{}\n", fight.encounter.value, skulls, skulls == 1 ? "" : "s");
					}
					record.stops[place].fight = playCampaignFight(
						fight, shared, standIn, FightPlay{.skulls = skulls, .turns = config.turns, .opening = started.events, .log = log}
					);
					if (fight.state.phase != Phase::Over) {
						record.end = RouteEnd::Abandoned;
						return record;
					}
					if (endRunFight(campaign, content, rules, layers, fight).outcome == Outcome::Lost) {
						record.end = RouteEnd::Failed;
						return record;
					}
					break;
				}
				case Ahead::Event: {
					const std::string chosen = firstOpenChoice(campaign, shared, layers).id;
					const EventTaken  taken = takeEventChoice(campaign, content, rules, shared.events, layers, shared.unlocked, chosen);
					StopRecord&		  at = record.stops[place];
					at.event = taken.event;
					at.choice = chosen;
					at.outcome = taken.outcome;
					if (log) {
						*log << std::format(
							"  {}: {}, outcome {}{}\n", taken.event.value, chosen, taken.outcome + 1, taken.fight ? ", a fight" : ""
						);
					}
					break;
				}
				case Ahead::Find: {
					const TakenFind found = takeFind(campaign, content, rules, layers, shared.unlocked);
					if (log) {
						*log
							<< (found.haul	   ? std::format("  a haul of {}\n", found.haul->amount)
								: found.driver ? std::string("  a driver\n")
											   : std::format("  {} cards on offer\n", found.reward.size()));
					}
					break;
				}
				case Ahead::Reward:
					if (log) {
						*log << "  takes " << route.reward.front().value << "\n";
					}
					takeReward(campaign, content, layers, route.reward.front());
					break;
				case Ahead::Objective:
					record.objective = true;
					record.ambush = takeObjective(campaign, rules, layers).ambush;
					if (log) {
						*log << (record.ambush ? "the objective, and an ambush waits on the road home\n" : "the objective\n");
					}
					break;
				case Ahead::Home:
					break;
			}
		}

		for (const CrewId& seat : seats) {
			const DriverRecord&		driver = campaign.driver(seat);
			const DriverDefinition& archetype = content.drivers.at(driver.archetype);
			record.hitpointsLost += archetype.maxHitpoints - driver.hitpoints;
			record.mostHitpoints += archetype.maxHitpoints;
			record.structureLost += archetype.vehicle.maxStructure - driver.vehicle.structure;
			record.mostStructure += archetype.vehicle.maxStructure;
		}
		const Run& out = *campaign.run;
		record.cargo = out.cargo;
		record.cardsWon = totalCards(out.cargoCards);
		record.drivers = static_cast<int>(out.found.size() + out.recruits.size());
		for (const Injury& injury : unloadRun(campaign, content, rules).injuries) {
			record.injuryDays += injury.days;
		}
		return record;
	}

	RunRow measureRuns(std::span<const RouteRunRecord* const> runs, bool pair) {
		const auto fightAt = [](const StopRecord& stop) {
			return stop.fight.has_value();
		};
		const auto hitpoints = [](const RouteRunRecord* run) {
			return share(run->hitpointsLost, run->mostHitpoints);
		};
		const auto structure = [](const RouteRunRecord* run) {
			return share(run->structureLost, run->mostStructure);
		};
		RunRow row{.runs = static_cast<int>(runs.size())};
		row.home = rateWhere(runs, every, home);
		row.failed = rateWhere(runs, every, [](const RouteRunRecord* run) { return run->end == RouteEnd::Failed; });
		row.abandoned = rateWhere(runs, every, [](const RouteRunRecord* run) { return run->end == RouteEnd::Abandoned; });
		row.brokenOff = rateWhere(runs, every, [&](const RouteRunRecord* run) {
			return countStops(run, [](const StopRecord& stop) { return stop.fight && stop.fight->outcome == Outcome::BrokenOff; }) > 0;
		});
		row.ambushed = rateWhere(
			runs, [](const RouteRunRecord* run) { return run->objective; }, [](const RouteRunRecord* run) { return run->ambush; }
		);
		if (pair) {
			row.bySeat = std::array{
				rateWhere(
					runs, [](const RouteRunRecord* run) { return !run->swapped; }, home
				),
				rateWhere(runs, [](const RouteRunRecord* run) { return run->swapped; }, home),
			};
		}
		row.hitpointsLost = meanWhere(runs, home, hitpoints);
		row.structureLost = meanWhere(runs, home, structure);
		row.crewLost = meanWhere(runs, home, [&](const RouteRunRecord* run) { return (hitpoints(run) + structure(run)) / 2; });
		row.driverDown = rateWhere(runs, home, [&](const RouteRunRecord* run) {
			return countStops(run, [](const StopRecord& stop) { return stop.fight && stop.fight->driverDown; }) > 0;
		});
		row.injuryDays = meanWhere(runs, home, [](const RouteRunRecord* run) { return run->injuryDays; });
		row.turns = meanWhere(runs, home, [](const RouteRunRecord* run) {
			int turns = 0;
			for (const StopRecord& stop : run->stops) {
				turns += stop.fight ? stop.fight->turns : 0;
			}
			return turns;
		});
		row.stopsMet = meanWhere(runs, every, [&](const RouteRunRecord* run) {
			return countStops(run, [](const StopRecord& stop) { return stop.type.has_value(); });
		});
		row.fights = meanWhere(runs, every, [&](const RouteRunRecord* run) { return countStops(run, fightAt); });
		row.fuel = meanWhere(runs, every, [](const RouteRunRecord* run) { return run->fuel; });
		if (std::ranges::any_of(runs, home)) {
			const auto mean = [&](int Resources::* resource) {
				return *meanWhere(runs, home, [&](const RouteRunRecord* run) { return run->cargo.*resource; });
			};
			row.cargo = Supplies{
				.food = mean(&Resources::food),
				.water = mean(&Resources::water),
				.fuel = mean(&Resources::fuel),
				.meds = mean(&Resources::meds),
				.scrap = mean(&Resources::scrap),
				.people = mean(&Resources::people),
			};
		}
		row.cardsWon = meanWhere(runs, home, [](const RouteRunRecord* run) { return run->cardsWon; });
		row.drivers = meanWhere(runs, home, [](const RouteRunRecord* run) { return run->drivers; });
		return row;
	}

	std::string_view routeEndName(RouteEnd end) {
		switch (end) {
			case RouteEnd::Home:
				return "home";
			case RouteEnd::Failed:
				return "failed";
			case RouteEnd::Abandoned:
				return "abandoned";
		}
		return "?";
	}

	std::string stopTypeName(map::StopType type) {
		const auto named = std::ranges::find(map::kStopTypeNames, type, &std::pair<std::string_view, map::StopType>::second);
		return std::string(named->first);
	}

	RunsReport playRuns(const RunsConfig& config, const SimRules& shared, std::span<const RunMap> maps, int workers) {
		std::pair<std::vector<RunCell>, std::vector<MapSummary>> planned = planRuns(config, shared, maps);
		const std::vector<RunCell>&								 cells = planned.first;
		const auto												 runs = static_cast<size_t>(config.runs);
		std::vector<RouteRunRecord>								 records(cells.size() * runs);
		const auto												 started = std::chrono::steady_clock::now();
		inParallel(records.size(), workers, [&](size_t begin, size_t end) {
			for (size_t item = begin; item < end; ++item) {
				records[item] = playRouteRun(config, shared, maps, cells[item / runs], static_cast<int>(item % runs) + 1);
			}
		});
		RunsReport report{.config = config, .maps = std::move(planned.second), .workers = workers};
		report.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
		for (const RouteRunRecord& record : records) {
			for (const StopRecord& stop : record.stops) {
				report.fights += stop.fight ? 1 : 0;
				report.decisions += stop.fight ? stop.fight->decisions : 0;
			}
		}

		const Played played{.config = config, .maps = maps, .cells = cells, .records = records};
		for (size_t index = 0; index < cells.size(); ++index) {
			report.cells.push_back(cellRow(played, index));
		}
		std::vector<int> tiers = config.tiers;
		std::ranges::sort(tiers);
		for (const int stage : config.stages) {
			for (const int seats : {2, 1}) {
				const Slice slice{.stage = stage, .seats = seats};
				tierRows(played, slice, tiers, report.tiers);
				riskRows(played, slice, report.risks);
				stopRows(played, slice, report.stops);
				neighborRows(played, slice, tiers, report.neighbors);
			}
		}
		return report;
	}

} // namespace sim
