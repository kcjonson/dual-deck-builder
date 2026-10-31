#include "Report.h"

#include "ReportText.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <format>
#include <map>
#include <ostream>
#include <string>
#include <utility>
#include <vector>

namespace sim {

	namespace {

		using Json = nlohmann::ordered_json;

		// Runs and Encounters, Just hard enough: one fight's starting targets for every starting pair, fresh and on
		// default decks, met by the floor. Only one skull has a band for what's lost.
		struct FightTarget {
			int					  skulls{1};
			double				  won{0};
			std::optional<double> lostLeast;
			std::optional<double> lostMost;
		};

		constexpr std::array<FightTarget, 3> kFightTargets{{
			{.skulls = 1, .won = 0.98, .lostLeast = 0.12, .lostMost = 0.20},
			{.skulls = 2, .won = 0.93},
			{.skulls = 3, .won = 0.85},
		}};

		// A fight should take 4 to 8 turns.
		constexpr double kFewestTurns = 4;
		constexpr double kMostTurns = 8;

		Json cellJson(const CellRow& row) {
			Json json;
			json["cell"] = row.cell;
			json["crew"] = crewJson(row.crew);
			json["route"] = routeJson(row.route);
			json["stage"] = row.stage;
			json["runs"] = row.runs;
			json["home"] = rateJson(row.home);
			json["lost"] = rateJson(row.lost);
			json["stalled"] = rateJson(row.stalled);
			json["brokenOff"] = rateJson(row.brokenOff);
			json["routed"] = rateJson(row.routed);
			json["bySeat"] = row.bySeat ? Json::array({rateJson((*row.bySeat)[0]), rateJson((*row.bySeat)[1])}) : Json(nullptr);
			json["hitpointsLost"] = numberJson(row.hitpointsLost);
			json["structureLost"] = numberJson(row.structureLost);
			json["driverDown"] = rateJson(row.driverDown);
			json["turns"] = numberJson(row.turns);
			json["injuryDays"] = numberJson(row.injuryDays);
			json["raidersKilled"] = numberJson(row.raidersKilled);
			Json fights = Json::array();
			for (const FightRow& fight : row.fights) {
				fights.push_back(fightRowJson(fight));
			}
			json["fights"] = std::move(fights);
			Json raiders = Json::object();
			for (const auto& [raider, cards] : row.raiderPlays) {
				Json plays = Json::object();
				for (const auto& [card, played] : cards) {
					plays[card.value] = Json{{"played", played.played}, {"fizzled", played.fizzled}};
				}
				raiders[raider.value] = std::move(plays);
			}
			json["raiderPlays"] = std::move(raiders);
			Json players = Json::object();
			for (const auto& [card, played] : row.playerPlays) {
				players[card.value] = played;
			}
			json["playerPlays"] = std::move(players);
			json["decisions"] = row.decisions;
			if (!row.cards.empty()) {
				Json cards = Json::object();
				for (const auto& [card, measured] : row.cards) {
					Json one;
					one["drawn"] = measured.drawn;
					one["played"] = measured.played;
					one["fizzled"] = numberJson(measured.fizzled);
					one["blanked"] = numberJson(measured.blanked);
					one["wonWhenPlayed"] = rateJson(measured.wonWhenPlayed);
					cards[card.value] = std::move(one);
				}
				json["cards"] = std::move(cards);
			}
			return json;
		}

		Json skullJson(const SkullRow& row) {
			Json json;
			json["stage"] = row.stage;
			json["skulls"] = row.skulls;
			json["seats"] = row.seats;
			json["fights"] = row.fights;
			json["won"] = rateJson(row.won);
			json["lost"] = rateJson(row.lost);
			json["brokenOff"] = rateJson(row.brokenOff);
			json["stalled"] = rateJson(row.stalled);
			json["routed"] = rateJson(row.routed);
			json["turns"] = numberJson(row.turns);
			json["hitpointsLost"] = numberJson(row.hitpointsLost);
			json["structureLost"] = numberJson(row.structureLost);
			json["cardsPlayed"] = numberJson(row.cardsPlayed);
			json["worstCrew"] = row.worstCrew;
			json["worstWon"] = rateJson(row.worstWon);
			return json;
		}

		std::string routeLabel(const RouteConfig& route) {
			std::string label;
			for (const FightStep& step : route) {
				label += (label.empty() ? "" : "+") + (step.encounter ? step.encounter->value : std::to_string(step.skulls));
			}
			return label;
		}

		size_t cellWidth(const FightsReport& report) {
			size_t width = 24;
			for (const CellRow& row : report.cells) {
				width = std::max(width, row.cell.size() + 2);
			}
			return width;
		}

		void printRuns(std::ostream& out, const FightsReport& report, size_t width) {
			out << "\nruns: home, lost, stalled, broken off, and routed over every run; lost, down, turns, and injury days over runs "
				   "home; a pair alternates seats run by run\n";
			out << std::format(
				"{:<{}}{:>6}{:>9}{:>6}{:>7}{:>7}{:>6}{:>9}{:>13}{:>6}{:>7}{:>10}{:>8}\n",
				"cell",
				width,
				"home",
				"by seat",
				"lost",
				"stall",
				"broke",
				"rout",
				"HP lost",
				"struct lost",
				"down",
				"turns",
				"inj days",
				"killed"
			);
			for (const CellRow& row : report.cells) {
				const std::string bySeat =
					row.bySeat ? std::format(
									 "{}/{}",
									 (*row.bySeat)[0].rate ? std::to_string(std::lround(*(*row.bySeat)[0].rate * 100)) : "-",
									 (*row.bySeat)[1].rate ? std::to_string(std::lround(*(*row.bySeat)[1].rate * 100)) : "-"
								 )
							   : "";
				out << std::format(
					"{:<{}}{:>6}{:>9}{:>6}{:>7}{:>7}{:>6}{:>9}{:>13}{:>6}{:>7}{:>10}{:>8}\n",
					row.cell,
					width,
					percent(row.home),
					bySeat,
					percent(row.lost),
					percent(row.stalled),
					percent(row.brokenOff),
					percent(row.routed),
					percent(row.hitpointsLost),
					percent(row.structureLost),
					percent(row.driverDown),
					fixed(row.turns),
					fixed(row.injuryDays),
					fixed(row.raidersKilled)
				);
			}
		}

		void printFights(std::ostream& out, const FightsReport& report, size_t width) {
			out << "\nfights by place on the route: turns, HP and structure lost, and drivers down over the fights won; cards are the "
				   "crew's plays\n";
			out << std::format(
				"{:<{}}{:>3}{:>7}{:>6}{:>6}{:>7}{:>7}{:>6}{:>7}{:>9}{:>13}{:>6}{:>7}{:>7}{:>8}\n",
				"cell",
				width,
				"#",
				"skulls",
				"won",
				"lost",
				"broke",
				"stall",
				"rout",
				"turns",
				"HP lost",
				"struct lost",
				"down",
				"cards",
				"waves",
				"killed"
			);
			for (const CellRow& row : report.cells) {
				for (size_t place = 0; place < row.fights.size(); ++place) {
					const FightRow& fight = row.fights[place];
					out << std::format(
						"{:<{}}{:>3}{:>7}{:>6}{:>6}{:>7}{:>7}{:>6}{:>7}{:>9}{:>13}{:>6}{:>7}{:>7}{:>8}\n",
						place == 0 ? row.cell : "",
						width,
						place + 1,
						fight.skulls,
						percent(fight.won),
						percent(fight.lost),
						percent(fight.brokenOff),
						percent(fight.stalled),
						percent(fight.routed),
						fixed(fight.turns),
						percent(fight.hitpointsLost),
						percent(fight.structureLost),
						percent(fight.driverDown),
						fixed(fight.cardsPlayed),
						fixed(fight.wavesSeen),
						fixed(fight.raidersKilled)
					);
				}
			}
		}

		void printTargets(std::ostream& out, const FightsReport& report) {
			if (report.skulls.empty()) {
				return;
			}
			out << "\nopening fights by skull count against the per-fight targets (Runs and Encounters, Just hard enough): every pair "
				   "should meet them; lone drivers have none\n";
			out << std::format(
				"{:>5}{:>7}{:>7}{:>8}{:>17}{:>11}  {:<30}{:>5}{:>9}{:>13}{:>6}{:>7}{:>7}\n",
				"stage",
				"skulls",
				"crews",
				"fights",
				"won [90%]",
				"target",
				"worst crew",
				"won",
				"HP lost",
				"struct lost",
				"band",
				"turns",
				"stall"
			);
			for (const SkullRow& row : report.skulls) {
				const auto	target = std::ranges::find(kFightTargets, row.skulls, &FightTarget::skulls);
				const bool	pairs = row.seats == 2;
				std::string wonTarget = "-";
				std::string band = "-";
				if (pairs && target != kFightTargets.end()) {
					wonTarget = std::format("{}%{}", std::lround(target->won * 100), *row.worstWon.rate >= target->won ? "" : " miss");
					if (target->lostLeast && row.hitpointsLost) {
						const double lost = *row.hitpointsLost;
						band = lost < *target->lostLeast ? "low" : lost > *target->lostMost ? "high" : "in";
					}
				}
				out << std::format(
					"{:>5}{:>7}{:>7}{:>8}{:>17}{:>11}  {:<30}{:>5}{:>9}{:>13}{:>6}{:>7}{:>7}\n",
					row.stage,
					row.skulls,
					pairs ? "pairs" : "solo",
					row.fights,
					interval(row.won),
					wonTarget,
					row.worstCrew,
					percent(row.worstWon),
					percent(row.hitpointsLost),
					percent(row.structureLost),
					band,
					fixed(row.turns) + (row.turns && (*row.turns < kFewestTurns || *row.turns > kMostTurns) ? "*" : ""),
					percent(row.stalled)
				);
			}
			out << "  band: 1 skull's HP lost against its 12-20%; * turns outside a fight's 4 to 8; no fight should stall\n";
		}

		void printFairness(std::ostream& out, const FightsReport& report) {
			std::map<std::pair<std::string, int>, std::vector<const CellRow*>> byRoute;
			for (const CellRow& row : report.cells) {
				if (row.bySeat) {
					byRoute[{routeLabel(row.route), row.stage}].push_back(&row);
				}
			}
			if (byRoute.empty()) {
				return;
			}
			out << "\nfairness, points of home: best pair less worst on each route (15 or less); the widest gap between a pair's two "
				   "seatings (10 or less)\n";
			for (const auto& [key, rows] : byRoute) {
				double		   best = 0;
				double		   worst = 1;
				double		   widest = -1;
				const CellRow* widestRow = rows.front();
				for (const CellRow* row : rows) {
					best = std::max(best, row->home.rate.value_or(0));
					worst = std::min(worst, row->home.rate.value_or(0));
					const double gap = std::abs((*row->bySeat)[0].rate.value_or(0) - (*row->bySeat)[1].rate.value_or(0));
					if (gap > widest) {
						widest = gap;
						widestRow = row;
					}
				}
				out << std::format(
					"{:>12}@{}  pairs {:>3}  seats {:>3} ({})\n",
					key.first,
					key.second,
					std::lround((best - worst) * 100),
					std::lround(widest * 100),
					widestRow->cell
				);
			}
		}

		// The crew whose seats are this one's archetypes in its order on their starting decks, if the config has it.
		// Each place's fights won, in route order: `83%`, or `95/71%` for two.
		std::string wonByPlace(const CellRow& row) {
			std::string won;
			for (const FightRow& place : row.fights) {
				won += (won.empty() ? "" : "/") + (place.won.rate ? std::to_string(std::lround(*place.won.rate * 100)) : std::string("-"));
			}
			return won + "%";
		}

		const CellRow* startingDecksOf(const FightsReport& report, const CellRow& row) {
			for (const CellRow& other : report.cells) {
				const bool same = other.crew.size() == row.crew.size() && other.route == row.route && other.stage == row.stage &&
								  std::ranges::equal(other.crew, row.crew, {}, &SeatConfig::archetype, &SeatConfig::archetype);
				if (same && std::ranges::all_of(other.crew, [](const SeatConfig& seat) { return !seat.deck && seat.add.empty(); })) {
					return &other;
				}
			}
			return nullptr;
		}

		void printCards(std::ostream& out, const FightsReport& report, size_t width) {
			if (!report.config.cards) {
				return;
			}
			out << "\ncards by cell, the crew's, most played first: draws and plays a fight; over the plays, the raiders' planned "
				   "intents each made fizzle and the planned damage each took off the crew; and the fights it was played in, won\n";
			out << std::format(
				"{:<{}}  {:<22}{:>7}{:>8}{:>10}{:>10}{:>17}\n",
				"cell",
				width,
				"card",
				"drawn",
				"played",
				"fizzled",
				"blanked",
				"won when played"
			);
			for (const CellRow& row : report.cells) {
				std::vector<std::pair<rules::CardId, CardRow>> sorted(row.cards.begin(), row.cards.end());
				std::ranges::stable_sort(sorted, [](const auto& left, const auto& right) {
					return left.second.played > right.second.played;
				});
				bool first = true;
				for (const auto& [card, measured] : sorted) {
					out << std::format(
						"{:<{}}  {:<22}{:>7.2f}{:>8.2f}{:>10}{:>10}{:>17}\n",
						first ? row.cell : "",
						width,
						card.value,
						measured.drawn,
						measured.played,
						fixed(measured.fizzled, 2),
						fixed(measured.blanked, 2),
						interval(measured.wonWhenPlayed)
					);
					first = false;
				}
			}
			std::string added;
			for (const CellRow& row : report.cells) {
				const CellRow* starting = startingDecksOf(report, row);
				if (starting == nullptr || starting == &row) {
					continue;
				}
				for (const SeatConfig& seat : row.crew) {
					rules::campaign::CardCounts changed = seat.add;
					if (seat.deck) {
						changed = *seat.deck;
					}
					for (const auto& [card, count] : changed) {
						const auto played = row.cards.find(card);
						added += std::format(
							"{:<{}}  {:<22}{:>3}  won {} against {}, HP lost {} against {}, played {} a fight\n",
							row.cell,
							width,
							card.value,
							count,
							wonByPlace(row),
							wonByPlace(*starting),
							percent(row.hitpointsLost),
							percent(starting->hitpointsLost),
							played == row.cards.end() ? "0" : std::format("{:.2f}", played->second.played)
						);
					}
				}
			}
			if (!added.empty()) {
				out << "\ncards a crew adds or decks it's given, against the same crew on its starting decks on the same route: "
					   "fights won, a place on the route at a time, then HP lost over the runs home, the cell's then theirs\n"
					<< added;
			}
		}

		void printRaiderPlays(std::ostream& out, const FightsReport& report, size_t width) {
			out << "\nraider plays a fight, by raider and card, played and fizzled together; of those, fizzled in brackets\n";
			for (const CellRow& row : report.cells) {
				std::string line;
				for (const auto& [raider, cards] : row.raiderPlays) {
					std::vector<std::pair<std::string, PlaysAFight>> sorted;
					for (const auto& [card, plays] : cards) {
						sorted.emplace_back(card.value, plays);
					}
					std::ranges::stable_sort(sorted, [](const auto& left, const auto& right) {
						return left.second.played + left.second.fizzled > right.second.played + right.second.fizzled;
					});
					std::string plays;
					for (const auto& [card, played] : sorted) {
						plays += std::format(
							"{}{} {:.2f}{}",
							plays.empty() ? "" : ", ",
							card,
							played.played + played.fizzled,
							played.fizzled > 0 ? std::format(" ({:.2f})", played.fizzled) : ""
						);
					}
					line += std::format("{}{}: {}", line.empty() ? "" : " | ", raider.value, plays);
				}
				out << std::format("{:<{}}{}\n", row.cell, width, line);
			}
		}

	} // namespace

	nlohmann::ordered_json fightRowJson(const FightRow& row) {
		Json encounters = Json::object();
		for (const auto& [encounter, count] : row.encounters) {
			encounters[encounter.value] = count;
		}
		Json json;
		json["skulls"] = row.skulls;
		json["encounters"] = std::move(encounters);
		json["won"] = rateJson(row.won);
		json["lost"] = rateJson(row.lost);
		json["brokenOff"] = rateJson(row.brokenOff);
		json["stalled"] = rateJson(row.stalled);
		json["routed"] = rateJson(row.routed);
		json["driverDown"] = rateJson(row.driverDown);
		json["turns"] = numberJson(row.turns);
		json["hitpointsLost"] = numberJson(row.hitpointsLost);
		json["structureLost"] = numberJson(row.structureLost);
		json["cardsPlayed"] = numberJson(row.cardsPlayed);
		json["raidersKilled"] = numberJson(row.raidersKilled);
		json["wavesSeen"] = numberJson(row.wavesSeen);
		json["decisions"] = numberJson(row.decisions);
		return json;
	}

	nlohmann::ordered_json packsJson(std::span<const rules::PackManifest> packs) {
		Json loaded = Json::array();
		for (const rules::PackManifest& pack : packs) {
			loaded.push_back(Json{{"id", pack.id.value}, {"version", pack.version}});
		}
		return loaded;
	}

	std::string packsText(std::span<const rules::PackManifest> packs) {
		std::string loaded;
		for (const rules::PackManifest& pack : packs) {
			loaded += std::format("{}{} {}", loaded.empty() ? "" : ", ", pack.id.value, pack.version);
		}
		return loaded;
	}

	nlohmann::ordered_json reportJson(const FightsReport& report, std::span<const rules::PackManifest> packs) {
		Json json;
		json["mode"] = "fights";
		json["packs"] = packsJson(packs);
		json["config"] = Json(fightsConfigJson(report.config));
		Json cells = Json::array();
		for (const CellRow& row : report.cells) {
			cells.push_back(cellJson(row));
		}
		json["cells"] = std::move(cells);
		Json skulls = Json::array();
		for (const SkullRow& row : report.skulls) {
			skulls.push_back(skullJson(row));
		}
		json["skulls"] = std::move(skulls);
		return json;
	}

	void printReport(std::ostream& out, const FightsReport& report, std::span<const rules::PackManifest> packs) {
		const FightsConfig& config = report.config;
		std::string			stages;
		for (const int stage : config.stages) {
			stages += (stages.empty() ? "" : ",") + std::to_string(stage);
		}
		out << std::format(
			"fights: {} runs a cell, seed {}, stand-in {}, stalled after turn {}, tier {}, stage {}; packs {}\n",
			config.runs,
			config.seed,
			config.standIn.policy,
			config.turns,
			config.tier,
			stages,
			packsText(packs)
		);
		const size_t width = cellWidth(report);
		printRuns(out, report, width);
		printFights(out, report, width);
		printTargets(out, report);
		printFairness(out, report);
		printRaiderPlays(out, report, width);
		printCards(out, report, width);

		int decisions = 0;
		int fights = 0;
		for (const CellRow& row : report.cells) {
			decisions += row.decisions;
			for (const FightRow& fight : row.fights) {
				fights += fight.won.of;
			}
		}
		out << std::format(
			"\n{} fights and {} stand-in decisions in {:.1f} s on {} workers: {:.2f} ms of a worker's time a decision, the raiders' "
			"planning included\n",
			fights,
			decisions,
			report.seconds,
			report.workers,
			decisions == 0 ? 0.0 : report.seconds * report.workers * 1000 / decisions
		);
	}

} // namespace sim
