#include "Fights.h"

#include <ai/PlayFight.h>

#include <rules/battle/Battle.h>
#include <rules/battle/BattleEvent.h>
#include <rules/battle/Encounters.h>
#include <rules/battle/Waves.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/Founding.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <threading/TaskPool.h>

#include <algorithm>
#include <chrono>
#include <memory>
#include <stdexcept>

namespace sim {

	using namespace rules;
	using namespace rules::campaign;

	namespace {

		std::string routeName(const RouteConfig& route) {
			std::string name;
			for (const FightStep& step : route) {
				name += (name.empty() ? "" : "+") + (step.encounter ? step.encounter->value : std::to_string(step.skulls));
			}
			return name;
		}

		// The player's seats come first among the drivers.
		size_t seatsIn(const BattleState& state) {
			return static_cast<size_t>(std::ranges::count(state.drivers, Side::Player, &BattleDriver::side));
		}

		int crewHitpoints(const BattleState& state, int BattleDriver::* field) {
			int hitpoints = 0;
			for (size_t seat = 0; seat < seatsIn(state); ++seat) {
				hitpoints += state.drivers[seat].*field;
			}
			return hitpoints;
		}

		// The driven vehicles, whoever is at the wheel; the convoy's escorts aren't the crew's.
		int crewStructure(const BattleState& state, int BattleVehicle::* field) {
			int structure = 0;
			for (const BattleVehicle& vehicle : state.vehicles) {
				if (vehicle.side == Side::Player && vehicle.owner) {
					structure += vehicle.*field;
				}
			}
			return structure;
		}

		void finishFight(FightRecord& record, const BattleState& state) {
			record.outcome = state.phase == Phase::Over ? state.outcome : std::nullopt;
			record.rout = state.rout;
			record.turns = state.phase == Phase::Over ? state.turn : state.turn - 1;
			record.hitpointsAtEnd = crewHitpoints(state, &BattleDriver::hitpoints);
			record.structureAtEnd = crewStructure(state, &BattleVehicle::structure);
			for (size_t seat = 0; seat < seatsIn(state); ++seat) {
				record.driverDown = record.driverDown || !state.drivers[seat].isAlive();
			}
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const bool raider = state.vehicles[static_cast<size_t>(index)].side == Side::Raiders;
				record.raidersKilled += raider && !vehicleInFight(state, VehicleIndex{index}) ? 1 : 0;
			}
			record.wavesSeen = waveOnRoad(state);
		}

		// The plays an action's events show: the crew's cards, and the raiders' planned steps as each plays or fizzles.
		void tallyPlays(FightRecord& record, const BattleState& after, const std::vector<Event>& events) {
			const auto raiderOf = [&](DriverIndex raider) {
				return std::get<OpponentId>(after.driver(raider).profile);
			};
			for (const Event& event : events) {
				if (const auto* played = std::get_if<event::CardPlayed>(&event)) {
					if (after.driver(played->driver).side == Side::Player) {
						++record.playerPlays[played->card.card];
					} else {
						++record.raiderPlays[raiderOf(played->driver)][played->card.card].played;
					}
				} else if (const auto* fizzled = std::get_if<event::PlannedStepFizzled>(&event)) {
					++record.raiderPlays[raiderOf(fizzled->raider)][fizzled->card.card].fizzled;
				}
			}
		}

		int cardsPlayed(const FightRecord& fight) {
			int cards = 0;
			for (const auto& [card, plays] : fight.playerPlays) {
				cards += plays;
			}
			return cards;
		}

		bool won(const FightRecord& fight) {
			return fight.outcome == Outcome::Won;
		}

		// The fights a route opened with, a fresh crew's, from each of `cells`' runs.
		std::vector<FightRecord> openingFights(std::span<const std::span<const RunRecord>> cells) {
			std::vector<FightRecord> fights;
			for (const std::span<const RunRecord>& runs : cells) {
				for (const RunRecord& run : runs) {
					fights.push_back(run.fights.front());
				}
			}
			return fights;
		}

		std::vector<SkullRow>
		measureSkulls(const FightsConfig& config, std::span<const FightCell> cells, const std::vector<std::span<const RunRecord>>& runsOf) {
			std::vector<SkullRow> rows;
			for (const int stage : config.stages) {
				for (const int seats : {2, 1}) {
					for (int skulls = 1; skulls <= kMostSkulls; ++skulls) {
						// By crew, each opening fight once.
						std::map<size_t, std::vector<std::span<const RunRecord>>> byCrew;
						std::vector<std::pair<size_t, FightStep>>				  seen;
						for (size_t index = 0; index < cells.size(); ++index) {
							const FightCell&  cell = cells[index];
							const FightStep&  opening = config.routes[cell.route].front();
							const CrewConfig& crew = config.crews[cell.crew];
							const std::pair	  key{cell.crew, opening};
							const bool		  counted = std::ranges::find(seen, key) != seen.end();
							if (cell.stage != stage || static_cast<int>(crew.size()) != seats || opening.skulls != skulls || counted) {
								continue;
							}
							seen.push_back(key);
							byCrew[cell.crew].push_back(runsOf[index]);
						}
						if (byCrew.empty()) {
							continue;
						}
						std::vector<std::span<const RunRecord>> all;
						SkullRow								row{.stage = stage, .skulls = skulls, .seats = seats};
						for (const auto& [crew, crewRuns] : byCrew) {
							all.insert(all.end(), crewRuns.begin(), crewRuns.end());
							const std::vector<FightRecord> fights = openingFights(crewRuns);
							const Rate					   crewWon =
								rateWhere(std::span<const FightRecord>(fights), [](const FightRecord&) { return true; }, won);
							if (row.worstCrew.empty() || *crewWon.rate < *row.worstWon.rate) {
								row.worstCrew = crewName(config.crews[crew]);
								row.worstWon = crewWon;
							}
						}
						const std::vector<FightRecord> fights = openingFights(all);
						const FightRow				   measured = measureFights(fights);
						row.fights = static_cast<int>(fights.size());
						row.won = measured.won;
						row.lost = measured.lost;
						row.brokenOff = measured.brokenOff;
						row.stalled = measured.stalled;
						row.routed = measured.routed;
						row.turns = measured.turns;
						row.hitpointsLost = measured.hitpointsLost;
						row.structureLost = measured.structureLost;
						row.cardsPlayed = measured.cardsPlayed;
						rows.push_back(std::move(row));
					}
				}
			}
			return rows;
		}

	} // namespace

	std::vector<FightCell> fightCells(const FightsConfig& config) {
		const std::vector<std::string> names = crewLabels(config.crews);
		std::vector<FightCell>		   cells;
		for (size_t crew = 0; crew < config.crews.size(); ++crew) {
			for (size_t route = 0; route < config.routes.size(); ++route) {
				for (const int stage : config.stages) {
					cells.push_back(
						FightCell{
							.name = names[crew] + ":" + routeName(config.routes[route]) + "@" + std::to_string(stage),
							.crew = crew,
							.route = route,
							.stage = stage,
						}
					);
				}
			}
		}
		return cells;
	}

	SimRules::SimRules(const Content& loaded)
		: content(loaded),
		  campaign(loadCampaignRules(loaded)),
		  events(loadEvents(loaded)),
		  raiders(loaded),
		  unlocked(unlockedAtStart(loaded)) {}

	StandIn::StandIn(const Behavior& behavior)
		: inner(ai::makePolicy(behavior, Side::Player)) {}

	Action StandIn::choose(const BattleState& board, const Content& content, std::span<const Action> actions, foundation::Rng& rng) const {
		++made;
		return inner->choose(board, content, actions, rng);
	}

	FightRecord playCampaignFight(CampaignFight& fight, const SimRules& shared, const StandIn& standIn, int skulls, int turns) {
		FightRecord record{
			.skulls = skulls,
			.encounter = fight.encounter,
			.hitpointsAtStart = crewHitpoints(fight.state, &BattleDriver::hitpoints),
			.mostHitpoints = crewHitpoints(fight.state, &BattleDriver::maxHitpoints),
			.structureAtStart = crewStructure(fight.state, &BattleVehicle::structure),
			.mostStructure = crewStructure(fight.state, &BattleVehicle::maxStructure),
		};
		const PolicyFor standIns = [&](const BattleState&, DriverIndex) -> const Policy& {
			return standIn;
		};
		const int decisionsBefore = standIn.decisions();
		ai::playFight(
			fight.state,
			shared.content,
			standIns,
			shared.raiders.forRaiders(),
			ai::PlayFightOptions{
				.mostTurns = turns,
				.onApplied = [&](const BattleState& after, const Action&, const std::vector<Event>& events) {
					tallyPlays(record, after, events);
				},
			}
		);
		record.decisions = standIn.decisions() - decisionsBefore;
		finishFight(record, fight.state);
		return record;
	}

	FightRow measureFights(std::span<const FightRecord> fights) {
		const auto every = [](const FightRecord&) {
			return true;
		};
		FightRow row{.skulls = fights.empty() ? 1 : fights.front().skulls};
		for (const FightRecord& fight : fights) {
			++row.encounters[fight.encounter];
		}
		row.won = rateWhere(fights, every, won);
		row.lost = rateWhere(fights, every, [](const FightRecord& fight) { return fight.outcome == Outcome::Lost; });
		row.brokenOff = rateWhere(fights, every, [](const FightRecord& fight) { return fight.outcome == Outcome::BrokenOff; });
		row.stalled = rateWhere(fights, every, [](const FightRecord& fight) { return !fight.outcome; });
		row.routed = rateWhere(fights, every, [](const FightRecord& fight) { return fight.rout.has_value(); });
		row.driverDown = rateWhere(fights, won, [](const FightRecord& fight) { return fight.driverDown; });
		row.turns = meanWhere(fights, won, [](const FightRecord& fight) { return fight.turns; });
		row.hitpointsLost = meanWhere(fights, won, [](const FightRecord& fight) {
			return share(fight.hitpointsAtStart - fight.hitpointsAtEnd, fight.mostHitpoints);
		});
		row.structureLost = meanWhere(fights, won, [](const FightRecord& fight) {
			return share(fight.structureAtStart - fight.structureAtEnd, fight.mostStructure);
		});
		row.cardsPlayed = meanWhere(fights, every, cardsPlayed);
		row.raidersKilled = meanWhere(fights, every, [](const FightRecord& fight) { return fight.raidersKilled; });
		row.wavesSeen = meanWhere(fights, every, [](const FightRecord& fight) { return fight.wavesSeen; });
		row.decisions = meanWhere(fights, every, [](const FightRecord& fight) { return fight.decisions; });
		return row;
	}

	RunRecord playRun(const FightsConfig& config, const SimRules& shared, const FightCell& cell, int run) {
		if (run < 1) {
			throw std::invalid_argument("playRun: runs count from 1");
		}
		const Content&	  content = shared.content;
		const CrewConfig& crew = config.crews[cell.crew];
		RunRecord		  record{.swapped = crew.size() == 2 && run % 2 == 0};
		CrewConfig		  seated = crew;
		if (record.swapped) {
			std::ranges::reverse(seated);
		}

		Campaign			campaign{.seed = config.seed, .nextRunNumber = run};
		std::vector<CrewId> seats;
		for (const SeatConfig& seat : seated) {
			const CrewId id = recruitDriver(campaign, content, seat.archetype);
			campaign.driver(id).defaultDeck = deckOf(seat, content);
			seats.push_back(id);
		}
		startRun(campaign, content, RunStart{.seats = seats, .escorts = {}, .stage = cell.stage});

		const StandIn standIn(config.standIn);
		for (const FightStep& step : config.routes[cell.route]) {
			const EncounterId encounter =
				step.encounter ? *step.encounter : pickEncounter(content, step.skulls, config.tier, nextFightSeed(campaign));
			CampaignFight fight = startCampaignFight(campaign, content, encounter).fight;
			FightRecord	  fought = playCampaignFight(fight, shared, standIn, step.skulls, config.turns);
			record.fights.push_back(std::move(fought));
			if (fight.state.phase != Phase::Over) {
				record.end = RunEnd::Stalled;
				return record;
			}
			if (writeBackFight(campaign, content, shared.campaign, fight).outcome == Outcome::Lost) {
				record.end = RunEnd::Lost;
				return record;
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
		for (const Injury& injury : unloadRun(campaign, content, shared.campaign).injuries) {
			record.injuryDays += injury.days;
		}
		return record;
	}

	CellRow measureCell(const FightsConfig& config, const FightCell& cell, std::span<const RunRecord> runs) {
		const auto every = [](const RunRecord&) {
			return true;
		};
		const auto home = [](const RunRecord& run) {
			return run.end == RunEnd::Home;
		};
		const CrewConfig& crew = config.crews[cell.crew];
		CellRow			  row{
					  .cell = cell.name,
					  .crew = crew,
					  .route = config.routes[cell.route],
					  .stage = cell.stage,
					  .runs = static_cast<int>(runs.size()),
		  };
		row.home = rateWhere(runs, every, home);
		row.lost = rateWhere(runs, every, [](const RunRecord& run) { return run.end == RunEnd::Lost; });
		row.stalled = rateWhere(runs, every, [](const RunRecord& run) { return run.end == RunEnd::Stalled; });
		row.brokenOff = rateWhere(runs, every, [](const RunRecord& run) {
			return std::ranges::any_of(run.fights, [](const FightRecord& fight) { return fight.outcome == Outcome::BrokenOff; });
		});
		row.routed = rateWhere(runs, every, [](const RunRecord& run) {
			return std::ranges::any_of(run.fights, [](const FightRecord& fight) { return fight.rout.has_value(); });
		});
		if (crew.size() == 2) {
			row.bySeat = std::array{
				rateWhere(
					runs, [](const RunRecord& run) { return !run.swapped; }, home
				),
				rateWhere(runs, [](const RunRecord& run) { return run.swapped; }, home),
			};
		}
		row.hitpointsLost = meanWhere(runs, home, [](const RunRecord& run) { return share(run.hitpointsLost, run.mostHitpoints); });
		row.structureLost = meanWhere(runs, home, [](const RunRecord& run) { return share(run.structureLost, run.mostStructure); });
		row.driverDown = rateWhere(runs, home, [](const RunRecord& run) {
			return std::ranges::any_of(run.fights, [](const FightRecord& fight) { return fight.driverDown; });
		});
		row.turns = meanWhere(runs, home, [](const RunRecord& run) {
			int turns = 0;
			for (const FightRecord& fight : run.fights) {
				turns += fight.turns;
			}
			return turns;
		});
		row.injuryDays = meanWhere(runs, home, [](const RunRecord& run) { return run.injuryDays; });
		row.raidersKilled = meanWhere(runs, every, [](const RunRecord& run) {
			int killed = 0;
			for (const FightRecord& fight : run.fights) {
				killed += fight.raidersKilled;
			}
			return killed;
		});

		for (size_t place = 0; place < row.route.size(); ++place) {
			std::vector<FightRecord> fights;
			for (const RunRecord& run : runs) {
				if (place < run.fights.size()) {
					fights.push_back(run.fights[place]);
				}
			}
			FightRow fightRow = measureFights(fights);
			fightRow.skulls = row.route[place].skulls;
			row.fights.push_back(std::move(fightRow));
		}

		int fought = 0;
		for (const RunRecord& run : runs) {
			for (const FightRecord& fight : run.fights) {
				++fought;
				row.decisions += fight.decisions;
				for (const auto& [card, plays] : fight.playerPlays) {
					row.playerPlays[card] += plays;
				}
				for (const auto& [raider, cards] : fight.raiderPlays) {
					for (const auto& [card, plays] : cards) {
						PlaysAFight& total = row.raiderPlays[raider][card];
						total.played += plays.played;
						total.fizzled += plays.fizzled;
					}
				}
			}
		}
		for (auto& [card, plays] : row.playerPlays) {
			plays /= fought;
		}
		for (auto& [raider, cards] : row.raiderPlays) {
			for (auto& [card, plays] : cards) {
				plays.played /= fought;
				plays.fizzled /= fought;
			}
		}
		return row;
	}

	FightsReport playFights(const FightsConfig& config, const SimRules& shared, int workers) {
		if (workers < 1) {
			throw std::invalid_argument("playFights: one worker or more");
		}
		const std::vector<FightCell> cells = fightCells(config);
		const auto					 runs = static_cast<size_t>(config.runs);
		std::vector<RunRecord>		 records(cells.size() * runs);
		const auto					 play = [&](size_t begin, size_t end) {
			  for (size_t item = begin; item < end; ++item) {
				  records[item] = playRun(config, shared, cells[item / runs], static_cast<int>(item % runs) + 1);
			  }
		};
		const auto started = std::chrono::steady_clock::now();
		if (workers == 1) {
			play(0, records.size());
		} else {
			foundation::TaskPool pool(static_cast<unsigned>(workers - 1));
			pool.parallelFor(0, records.size(), 1, play);
		}
		FightsReport report{.config = config, .workers = workers};
		report.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();

		std::vector<std::span<const RunRecord>> runsOf;
		for (size_t index = 0; index < cells.size(); ++index) {
			runsOf.emplace_back(records.data() + index * runs, runs);
			report.cells.push_back(measureCell(config, cells[index], runsOf.back()));
		}
		report.skulls = measureSkulls(config, cells, runsOf);
		return report;
	}

} // namespace sim
