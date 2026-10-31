#include "RunReport.h"

#include "Report.h"
#include "ReportText.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <format>
#include <map>
#include <ostream>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

namespace sim {

	namespace {

		using Json = nlohmann::ordered_json;

		// Runs and Encounters, Just hard enough, Per run: every starting pair, fresh and on default decks, played by the
		// floor over real routes. Tier 4's 75% is for a grown deck at stage 2 or later, which a fresh crew doesn't have.
		struct RunTarget {
			int	   tier{1};
			double home{0};
			double lostLeast{0};
			double lostMost{0};
		};

		constexpr std::array<RunTarget, 4> kRunTargets{{
			{.tier = 1, .home = 0.95, .lostLeast = 0.20, .lostMost = 0.35},
			{.tier = 2, .home = 0.88, .lostLeast = 0.30, .lostMost = 0.45},
			{.tier = 3, .home = 0.75, .lostLeast = 0.40, .lostMost = 0.55},
			{.tier = 4, .home = 0.60, .lostLeast = 0.45, .lostMost = 0.60},
		}};

		// Fairness: points of home between the best and worst pair on the same runs and between a pair's two seatings,
		// and the least a crew should lose from tier 2 on.
		constexpr double kMostPairSpread = 0.15;
		constexpr double kMostSeatSpread = 0.10;
		constexpr double kLeastLost = 0.05;

		// The routes a summary lists that pairs came home from least.
		constexpr size_t kWorstRoutes = 10;

		const RunTarget* targetFor(int tier) {
			const auto found = std::ranges::find(kRunTargets, tier, &RunTarget::tier);
			return found == kRunTargets.end() ? nullptr : &*found;
		}

		void putRow(Json& json, const RunRow& row) {
			json["runs"] = row.runs;
			json["home"] = rateJson(row.home);
			json["failed"] = rateJson(row.failed);
			json["abandoned"] = rateJson(row.abandoned);
			json["brokenOff"] = rateJson(row.brokenOff);
			json["ambushed"] = rateJson(row.ambushed);
			json["bySeat"] = row.bySeat ? Json::array({rateJson((*row.bySeat)[0]), rateJson((*row.bySeat)[1])}) : Json(nullptr);
			json["hitpointsLost"] = numberJson(row.hitpointsLost);
			json["structureLost"] = numberJson(row.structureLost);
			json["crewLost"] = numberJson(row.crewLost);
			json["driverDown"] = rateJson(row.driverDown);
			json["injuryDays"] = numberJson(row.injuryDays);
			json["turns"] = numberJson(row.turns);
			json["stopsMet"] = numberJson(row.stopsMet);
			json["fights"] = numberJson(row.fights);
			json["fuel"] = numberJson(row.fuel);
			if (row.cargo) {
				const Supplies& cargo = *row.cargo;
				json["cargo"] = Json{
					{"food", cargo.food},
					{"water", cargo.water},
					{"fuel", cargo.fuel},
					{"meds", cargo.meds},
					{"scrap", cargo.scrap},
					{"people", cargo.people},
				};
			} else {
				json["cargo"] = nullptr;
			}
			json["cardsWon"] = numberJson(row.cardsWon);
			json["drivers"] = numberJson(row.drivers);
		}

		Json rowJson(const RunRow& row) {
			Json json;
			putRow(json, row);
			return json;
		}

		Json cellJson(const RunCellRow& row) {
			Json json;
			json["cell"] = row.cell;
			json["crew"] = Json(crewJson(row.crew));
			json["map"] = row.map;
			json["poi"] = row.poi;
			json["route"] = row.route;
			json["routeName"] = row.routeName;
			json["tier"] = row.tier;
			json["risk"] = row.risk;
			json["stage"] = row.stage;
			json["behind"] =
				row.behind ? Json{{"poi", row.behind->poi}, {"route", row.behind->route}, {"cleared", row.behind->cleared}} : Json(nullptr);
			json["stops"] = row.stops;
			putRow(json, row.measured);
			return json;
		}

		Json groupJson(const GroupRow& row) {
			Json json;
			json["stage"] = row.stage;
			json["seats"] = row.seats;
			if (row.tier > 0) {
				json["tier"] = row.tier;
			}
			if (row.risk > 0) {
				json["risk"] = row.risk;
			}
			json["crew"] = row.crew.empty() ? Json(nullptr) : Json(row.crew);
			json["behind"] = row.behind;
			json["cells"] = row.cells;
			putRow(json, row.measured);
			return json;
		}

		Json stopJson(const StopRow& row) {
			Json json;
			json["stage"] = row.stage;
			json["seats"] = row.seats;
			json["kind"] = row.kind;
			json["skulls"] = row.skulls;
			json["met"] = row.met;
			json["fought"] = rateJson(row.fought);
			json["fights"] = fightRowJson(row.fights);
			Json choices = Json::object();
			for (const auto& [choice, count] : row.choices) {
				choices[choice] = count;
			}
			json["choices"] = std::move(choices);
			return json;
		}

		Json neighborJson(const NeighborRow& row) {
			Json json;
			json["stage"] = row.stage;
			json["seats"] = row.seats;
			json["tier"] = row.tier;
			json["routes"] = row.routes;
			json["of"] = row.of;
			json["cleared"] = numberJson(row.cleared);
			json["fresh"] = rowJson(row.fresh);
			json["behind"] = rowJson(row.behind);
			return json;
		}

		std::string listed(const std::vector<int>& values) {
			std::string text;
			for (const int value : values) {
				text += (text.empty() ? "" : ", ") + std::to_string(value);
			}
			return text;
		}

		std::string pointsApart(double high, double low) {
			return std::to_string(std::lround((high - low) * 100));
		}

		std::string bySeat(const RunRow& row) {
			if (!row.bySeat) {
				return "";
			}
			const auto rounded = [](const Rate& rate) {
				return rate.rate ? std::to_string(std::lround(*rate.rate * 100)) : std::string("-");
			};
			return std::format("{}/{}", rounded((*row.bySeat)[0]), rounded((*row.bySeat)[1]));
		}

		// The crews' own rows beside a pooled one: the same stage, seats, tier, and variant.
		std::vector<const GroupRow*> crewsOf(const RunsReport& report, const GroupRow& pooled) {
			std::vector<const GroupRow*> crews;
			for (const GroupRow& row : report.tiers) {
				if (!row.crew.empty() && row.stage == pooled.stage && row.seats == pooled.seats && row.tier == pooled.tier &&
					row.behind == pooled.behind) {
					crews.push_back(&row);
				}
			}
			return crews;
		}

		const GroupRow* worstOf(std::span<const GroupRow* const> crews) {
			const GroupRow* worst = nullptr;
			for (const GroupRow* row : crews) {
				if (row->measured.home.rate && (worst == nullptr || *row->measured.home.rate < *worst->measured.home.rate)) {
					worst = row;
				}
			}
			return worst;
		}

		void printTargets(std::ostream& out, const RunsReport& report) {
			out << "\nruns by destination tier against the per-run targets (Runs and Encounters, Just hard enough), fresh: every "
				   "pair should meet them, lone drivers have none; lost and down are over the runs home, lost the crew's HP and "
				   "structure shares averaged (call 442)\n";
			out << std::format(
				"{:>5}{:>6}{:>5}{:>6}{:>6}{:>17}{:>10}{:>7}{:>7}{:>7}{:>6}{:>6}{:>5}{:>8}{:>6}{:>9}{:>7}{:>7}{:>7}  {}\n",
				"stage",
				"seats",
				"tier",
				"cells",
				"runs",
				"home [90%]",
				"target",
				"failed",
				"aband",
				"broke",
				"lost",
				"band",
				"HP",
				"struct",
				"down",
				"inj days",
				"stops",
				"fights",
				"ambush",
				"worst crew"
			);
			for (const GroupRow& row : report.tiers) {
				if (!row.crew.empty() || row.behind) {
					continue;
				}
				const RunRow&					   measured = row.measured;
				const std::vector<const GroupRow*> crews = crewsOf(report, row);
				const GroupRow*					   worst = worstOf(crews);
				const RunTarget*				   target = row.seats == 2 ? targetFor(row.tier) : nullptr;
				std::string						   wanted = "-";
				std::string						   band = "-";
				if (target != nullptr) {
					const bool missed = worst != nullptr && *worst->measured.home.rate < target->home;
					wanted = std::format("{}%{}", std::lround(target->home * 100), missed ? " miss" : "");
					if (measured.crewLost) {
						band = *measured.crewLost < target->lostLeast ? "low" : *measured.crewLost > target->lostMost ? "high" : "in";
					}
				}
				out << std::format(
					"{:>5}{:>6}{:>5}{:>6}{:>6}{:>17}{:>10}{:>7}{:>7}{:>7}{:>6}{:>6}{:>5}{:>8}{:>6}{:>9}{:>7}{:>7}{:>7}  {}\n",
					row.stage,
					row.seats == 2 ? "pairs" : "solo",
					row.tier,
					row.cells,
					measured.runs,
					interval(measured.home),
					wanted,
					percent(measured.failed),
					percent(measured.abandoned),
					percent(measured.brokenOff),
					percent(measured.crewLost),
					band,
					percent(measured.hitpointsLost),
					percent(measured.structureLost),
					percent(measured.driverDown),
					fixed(measured.injuryDays),
					fixed(measured.stopsMet),
					fixed(measured.fights),
					percent(measured.ambushed),
					worst == nullptr ? "" : std::format("{} {}", worst->crew, percent(worst->measured.home))
				);
			}
			out << "  target: tier 1 95%, 2 88%, 3 75%, 4 60% home; band, the crew's lost against 20-35%, 30-45%, 40-55%, 45-60%; "
				   "miss when the worst pair is under it\n";
		}

		void printCrews(std::ostream& out, const RunsReport& report) {
			out << "\neach crew by tier, fresh: by seat is home in the crew's seat order, then swapped; lost over the runs home\n";
			out << std::format(
				"{:>5}{:>5}  {:<30}{:>17}{:>9}{:>7}{:>7}{:>6}{:>5}{:>8}{:>9}\n",
				"stage",
				"tier",
				"crew",
				"home [90%]",
				"by seat",
				"failed",
				"aband",
				"lost",
				"HP",
				"struct",
				"inj days"
			);
			for (const GroupRow& row : report.tiers) {
				if (row.crew.empty() || row.behind) {
					continue;
				}
				const RunRow& measured = row.measured;
				out << std::format(
					"{:>5}{:>5}  {:<30}{:>17}{:>9}{:>7}{:>7}{:>6}{:>5}{:>8}{:>9}\n",
					row.stage,
					row.tier,
					row.crew,
					interval(measured.home),
					bySeat(measured),
					percent(measured.failed),
					percent(measured.abandoned),
					percent(measured.crewLost),
					percent(measured.hitpointsLost),
					percent(measured.structureLost),
					fixed(measured.injuryDays)
				);
			}
		}

		void printSupplies(std::ostream& out, const RunsReport& report) {
			out << "\nwhat runs paid and brought home by tier, fresh: fuel paid at departure over every run, the cargo over the "
				   "runs home, drivers found riding home with it\n";
			out << std::format(
				"{:>5}{:>6}{:>5}{:>11}{:>7}{:>7}{:>7}{:>7}{:>7}{:>8}{:>7}{:>9}\n",
				"stage",
				"seats",
				"tier",
				"fuel paid",
				"fuel",
				"food",
				"water",
				"meds",
				"scrap",
				"people",
				"cards",
				"drivers"
			);
			for (const GroupRow& row : report.tiers) {
				if (!row.crew.empty() || row.behind) {
					continue;
				}
				const RunRow& measured = row.measured;
				const auto	  cargo = [&](double Supplies::* resource) {
					   return measured.cargo ? std::optional((*measured.cargo).*resource) : std::nullopt;
				};
				out << std::format(
					"{:>5}{:>6}{:>5}{:>11}{:>7}{:>7}{:>7}{:>7}{:>7}{:>8}{:>7}{:>9}\n",
					row.stage,
					row.seats == 2 ? "pairs" : "solo",
					row.tier,
					fixed(measured.fuel),
					fixed(cargo(&Supplies::fuel)),
					fixed(cargo(&Supplies::food)),
					fixed(cargo(&Supplies::water)),
					fixed(cargo(&Supplies::meds)),
					fixed(cargo(&Supplies::scrap)),
					fixed(cargo(&Supplies::people)),
					fixed(measured.cardsWon),
					fixed(measured.drivers, 2)
				);
			}
		}

		void printRisks(std::ostream& out, const RunsReport& report) {
			out << "\nruns by route risk, the most skulls among the fights a route meets, 1 with none, fresh\n";
			out << std::format(
				"{:>5}{:>6}{:>5}{:>6}{:>6}{:>17}{:>7}{:>7}{:>7}{:>6}{:>5}{:>8}{:>6}{:>9}{:>7}{:>7}{:>7}\n",
				"stage",
				"seats",
				"risk",
				"cells",
				"runs",
				"home [90%]",
				"failed",
				"aband",
				"broke",
				"lost",
				"HP",
				"struct",
				"down",
				"inj days",
				"stops",
				"fights",
				"ambush"
			);
			for (const GroupRow& row : report.risks) {
				const RunRow& measured = row.measured;
				out << std::format(
					"{:>5}{:>6}{:>5}{:>6}{:>6}{:>17}{:>7}{:>7}{:>7}{:>6}{:>5}{:>8}{:>6}{:>9}{:>7}{:>7}{:>7}\n",
					row.stage,
					row.seats == 2 ? "pairs" : "solo",
					row.risk,
					row.cells,
					measured.runs,
					interval(measured.home),
					percent(measured.failed),
					percent(measured.abandoned),
					percent(measured.brokenOff),
					percent(measured.crewLost),
					percent(measured.hitpointsLost),
					percent(measured.structureLost),
					percent(measured.driverDown),
					fixed(measured.injuryDays),
					fixed(measured.stopsMet),
					fixed(measured.fights),
					percent(measured.ambushed)
				);
			}
		}

		void printStops(std::ostream& out, const RunsReport& report) {
			out << "\neach kind of stop over the fresh runs that met it, a fight stop and the return ambush by skulls: fought is how "
				   "often it came to a fight, won to stalled are over those fights, and what was lost and turns over the fights won; "
				   "the stand-in's choices at an event, most taken first\n";
			out << std::format(
				"{:>5}{:>6}  {:<14}{:>6}{:>8}{:>6}{:>6}{:>7}{:>7}{:>9}{:>13}{:>7}  {}\n",
				"stage",
				"seats",
				"stop",
				"met",
				"fought",
				"won",
				"lost",
				"broke",
				"stall",
				"HP lost",
				"struct lost",
				"turns",
				"choices"
			);
			for (const StopRow& row : report.stops) {
				std::vector<std::pair<std::string, int>> choices(row.choices.begin(), row.choices.end());
				std::ranges::stable_sort(choices, [](const auto& left, const auto& right) { return left.second > right.second; });
				std::string taken;
				for (const auto& [choice, count] : choices) {
					taken += std::format("{}{} {}", taken.empty() ? "" : ", ", choice, count);
				}
				const bool fought = row.fought.count > 0;
				out << std::format(
					"{:>5}{:>6}  {:<14}{:>6}{:>8}{:>6}{:>6}{:>7}{:>7}{:>9}{:>13}{:>7}  {}\n",
					row.stage,
					row.seats == 2 ? "pairs" : "solo",
					row.skulls > 0 ? std::format("{} {}", row.kind, row.skulls) : row.kind,
					row.met,
					percent(row.fought),
					fought ? percent(row.fights.won) : "-",
					fought ? percent(row.fights.lost) : "-",
					fought ? percent(row.fights.brokenOff) : "-",
					fought ? percent(row.fights.stalled) : "-",
					percent(row.fights.hitpointsLost),
					percent(row.fights.structureLost),
					fixed(row.fights.turns),
					taken
				);
			}
		}

		void printFairness(std::ostream& out, const RunsReport& report) {
			bool any = false;
			for (const GroupRow& row : report.tiers) {
				if (!row.crew.empty() || row.behind || row.seats != 2) {
					continue;
				}
				const std::vector<const GroupRow*> crews = crewsOf(report, row);
				if (crews.size() < 2) {
					continue;
				}
				if (!any) {
					out << "\nfairness by tier, fresh pairs, points of home: best pair less worst on the same runs (15 or less), the "
						   "widest gap between a pair's two seatings (10 or less), and the crew losing least (5% or more from tier 2)\n";
					any = true;
				}
				const GroupRow* best = nullptr;
				const GroupRow* widest = nullptr;
				const GroupRow* least = nullptr;
				double			gap = -1;
				for (const GroupRow* crew : crews) {
					const RunRow& measured = crew->measured;
					if (best == nullptr || measured.home.rate.value_or(0) > best->measured.home.rate.value_or(0)) {
						best = crew;
					}
					const double seats = std::abs((*measured.bySeat)[0].rate.value_or(0) - (*measured.bySeat)[1].rate.value_or(0));
					if (seats > gap) {
						gap = seats;
						widest = crew;
					}
					if (measured.crewLost && (least == nullptr || *measured.crewLost < *least->measured.crewLost)) {
						least = crew;
					}
				}
				const GroupRow* worst = worstOf(crews);
				const double	spread = best->measured.home.rate.value_or(0) - worst->measured.home.rate.value_or(0);
				const bool		under = least != nullptr && row.tier >= 2 && *least->measured.crewLost < kLeastLost;
				out << std::format(
					"{:>5}{:>5}  pairs {:>3}{} ({} {}, {} {})  seats {:>3}{} ({})  least lost {}{}\n",
					row.stage,
					row.tier,
					pointsApart(spread, 0),
					spread > kMostPairSpread ? " over" : "",
					best->crew,
					percent(best->measured.home),
					worst->crew,
					percent(worst->measured.home),
					pointsApart(gap, 0),
					gap > kMostSeatSpread ? " over" : "",
					widest->crew,
					least == nullptr ? "-" : std::format("{} {}", percent(least->measured.crewLost), least->crew),
					under ? " under" : ""
				);
			}
		}

		void printNeighbors(std::ostream& out, const RunsReport& report) {
			if (report.neighbors.empty()) {
				return;
			}
			out << "\nbehind a neighbor's run, the day after, its stops still cleared: the routes of a tier it clears any of, the "
				   "share of their stops it clears, and those routes fresh, then behind it\n";
			out << std::format(
				"{:>5}{:>6}{:>5}{:>9}{:>9}{:>15}{:>13}{:>13}{:>14}\n",
				"stage",
				"seats",
				"tier",
				"routes",
				"cleared",
				"home",
				"lost",
				"stops",
				"fights"
			);
			for (const NeighborRow& row : report.neighbors) {
				out << std::format(
					"{:>5}{:>6}{:>5}{:>9}{:>9}{:>15}{:>13}{:>13}{:>14}\n",
					row.stage,
					row.seats == 2 ? "pairs" : "solo",
					row.tier,
					std::format("{}/{}", row.routes, row.of),
					percent(row.cleared),
					std::format("{} > {}", percent(row.fresh.home), percent(row.behind.home)),
					std::format("{} > {}", percent(row.fresh.crewLost), percent(row.behind.crewLost)),
					std::format("{} > {}", fixed(row.fresh.stopsMet), fixed(row.behind.stopsMet)),
					std::format("{} > {}", fixed(row.fresh.fights), fixed(row.behind.fights))
				);
			}
		}

		void printWorstRoutes(std::ostream& out, const RunsReport& report) {
			struct Pooled {
				std::string						name;
				int								tier{1};
				int								risk{1};
				const std::vector<std::string>* stops{nullptr};
				int								home{0};
				int								of{0};
			};
			std::map<std::tuple<int, uint32_t, int, int>, Pooled> routes;
			for (const RunCellRow& row : report.cells) {
				if (row.crew.size() != 2 || row.behind) {
					continue;
				}
				Pooled& pooled = routes[{row.stage, row.map, row.poi, row.route}];
				pooled.name = row.cell.substr(row.cell.find(':') + 1);
				pooled.tier = row.tier;
				pooled.risk = row.risk;
				pooled.stops = &row.stops;
				pooled.home += row.measured.home.count;
				pooled.of += row.measured.home.of;
			}
			std::vector<const Pooled*> sorted;
			for (const auto& [key, pooled] : routes) {
				sorted.push_back(&pooled);
			}
			std::ranges::stable_sort(sorted, [](const Pooled* left, const Pooled* right) {
				return share(left->home, left->of) < share(right->home, right->of);
			});
			if (sorted.empty()) {
				return;
			}
			out << "\nthe routes pairs came home from least, fresh, every pair pooled\n";
			out << std::format("{:<18}{:>5}{:>5}{:>7}  {}\n", "route", "tier", "risk", "home", "stops");
			for (size_t index = 0; index < std::min(kWorstRoutes, sorted.size()); ++index) {
				const Pooled& pooled = *sorted[index];
				std::string	  stops;
				for (const std::string& stop : *pooled.stops) {
					stops += (stops.empty() ? "" : ", ") + stop;
				}
				out << std::format(
					"{:<18}{:>5}{:>5}{:>7}  {}\n", pooled.name, pooled.tier, pooled.risk, percent(share(pooled.home, pooled.of)), stops
				);
			}
		}

	} // namespace

	nlohmann::ordered_json runReportJson(const RunsReport& report, std::span<const rules::PackManifest> packs) {
		Json json;
		json["mode"] = "runs";
		json["packs"] = packsJson(packs);
		json["config"] = Json(runsConfigJson(report.config));
		Json maps = Json::array();
		for (const MapSummary& map : report.maps) {
			maps.push_back(
				Json{
					{"seed", map.seed},
					{"settled", map.settled},
					{"fingerprint", std::format("{:016x}", map.fingerprint)},
					{"routes", map.routes},
					{"run", map.run},
				}
			);
		}
		json["maps"] = std::move(maps);
		const auto listOf = [](const auto& rows, auto&& write) {
			Json list = Json::array();
			for (const auto& row : rows) {
				list.push_back(write(row));
			}
			return list;
		};
		json["cells"] = listOf(report.cells, cellJson);
		json["tiers"] = listOf(report.tiers, groupJson);
		json["risks"] = listOf(report.risks, groupJson);
		json["stops"] = listOf(report.stops, stopJson);
		json["neighbors"] = listOf(report.neighbors, neighborJson);
		return json;
	}

	void printRunReport(std::ostream& out, const RunsReport& report, std::span<const rules::PackManifest> packs) {
		const RunsConfig& config = report.config;
		out << std::format(
			"runs: {} runs a cell, stand-in {}, stalled after turn {}, stages {}, tiers {}, {}, {}; packs {}\n",
			config.runs,
			config.standIn.policy,
			config.turns,
			listed(config.stages),
			listed(config.tiers),
			config.routes ? std::format("{} routes a map", *config.routes) : "every route",
			config.neighbor ? "each again behind its neighbor's run" : "fresh only",
			packsText(packs)
		);
		for (const MapSummary& map : report.maps) {
			out << std::format(
				"  map {}: params seed {}, fingerprint {:016x}, {} routes in its tiers, {} run\n",
				map.seed,
				map.settled,
				map.fingerprint,
				map.routes,
				map.run
			);
		}
		printTargets(out, report);
		printCrews(out, report);
		printSupplies(out, report);
		printRisks(out, report);
		printStops(out, report);
		printFairness(out, report);
		printNeighbors(out, report);
		printWorstRoutes(out, report);

		int runs = 0;
		for (const RunCellRow& row : report.cells) {
			runs += row.measured.runs;
		}
		out << std::format(
			"\n{} runs, {} fights, and {} stand-in decisions in {:.1f} s on {} workers: {:.2f} ms of a worker's time a decision, "
			"the raiders' planning and the rest of the run included\n",
			runs,
			report.fights,
			report.decisions,
			report.seconds,
			report.workers,
			report.decisions == 0 ? 0.0 : report.seconds * report.workers * 1000 / report.decisions
		);
	}

} // namespace sim
