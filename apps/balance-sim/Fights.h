#pragma once

#include "FightsConfig.h"
#include "Measures.h"

#include <ai/OpponentPolicies.h>

#include <rules/battle/BattleState.h>
#include <rules/battle/Policy.h>
#include <rules/campaign/CampaignRules.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/Events.h>
#include <rules/core/Ids.h>
#include <rules/packs/Pack.h>

#include <array>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace sim {

	// The balance sim's fights (Balance Simulation, fights): a crew, fresh and on its decks, through a route's fights in
	// order, each fielded, played, and written back by the game's own code, the combat bridge carrying damage and revival
	// from one fight to the next (call 198). The raiders play their own policies and every seat the config's stand-in.

	// A crew over a route at a game stage, named `road_warrior+interceptor:1+2@0`: the crew's archetypes in seat order, a
	// crew listed twice adding `#` and its place in the crews, then the route's fights, then the stage.
	struct FightCell {
		std::string name;
		size_t		crew{0};
		size_t		route{0};
		int			stage{0};
	};

	// Crew by crew, then route by route, then stage by stage.
	[[nodiscard]] std::vector<FightCell> fightCells(const FightsConfig& config);

	// What every run plays with, read once from the loaded packs and shared, read-only, by the runs on every worker.
	struct SimRules {
		explicit SimRules(const rules::Content& loaded);

		const rules::Content&		   content;
		rules::campaign::CampaignRules campaign;
		rules::campaign::Events		   events;
		ai::OpponentPolicies		   raiders;
		// What a find or an event turns someone new up from.
		std::vector<rules::DriverId> unlocked;
	};

	// The stand-in on every seat of the crew, as makePolicy builds it for the player's side, counting its choices, which
	// is what a decision's cost is measured over.
	class StandIn final : public rules::Policy {
	  public:
		explicit StandIn(const rules::Behavior& behavior);

		[[nodiscard]] rules::Action choose(
			const rules::BattleState&	   board,
			const rules::Content&		   content,
			std::span<const rules::Action> actions,
			foundation::Rng&			   rng
		) const override;

		[[nodiscard]] int decisions() const { return made; }

	  private:
		std::unique_ptr<rules::Policy> inner;
		mutable int					   made{0};
	};

	struct CardPlays {
		int played{0};
		int fizzled{0};

		bool operator==(const CardPlays&) const = default;
	};

	// One fight of a run, as it ended.
	struct FightRecord {
		int				   skulls{1};
		rules::EncounterId encounter;
		// None for a fight still on at the turn cap, which stalled.
		std::optional<rules::Outcome>	outcome;
		std::optional<rules::RoutCause> rout;
		// Player turns played.
		int turns{0};
		// The crew's HP and driven vehicles' structure as the fight opened and closed, and at most.
		int	 hitpointsAtStart{0};
		int	 hitpointsAtEnd{0};
		int	 mostHitpoints{0};
		int	 structureAtStart{0};
		int	 structureAtEnd{0};
		int	 mostStructure{0};
		bool driverDown{false};
		// Raider vehicles taken out of the fight, wrecked or left with nobody at the wheel; raiders that fled don't count.
		int raidersKilled{0};
		// The waves that pulled in, the first counted.
		int wavesSeen{0};
		// The stand-in's choices, each play and each end of a seat's part of a turn.
		int																decisions{0};
		std::map<rules::CardId, int>									playerPlays;
		std::map<rules::OpponentId, std::map<rules::CardId, CardPlays>> raiderPlays;

		bool operator==(const FightRecord&) const = default;
	};

	// A fight the combat bridge built, played by the stand-in on each of the crew's seats and each raider on its own
	// policy, to its end or until it opens a player turn past `turns`, unfinished, which has stalled it. It's recorded as
	// it ended, before the bridge writes it back.
	[[nodiscard]] FightRecord
	playCampaignFight(rules::campaign::CampaignFight& fight, const SimRules& shared, const StandIn& standIn, int skulls, int turns);

	// How a run came out: through every fight, each won or broken off; a fight lost; or a fight stalled.
	enum class RunEnd { Home, Lost, Stalled };

	struct RunRecord {
		RunEnd end{RunEnd::Home};
		// A pair seated the other way round from its crew's order, which every even run is.
		bool					 swapped{false};
		std::vector<FightRecord> fights;
		// What the crew brings home, off its records after the last write-back: a run home only.
		int hitpointsLost{0};
		int mostHitpoints{0};
		int structureLost{0};
		int mostStructure{0};
		int injuryDays{0};

		bool operator==(const RunRecord&) const = default;
	};

	// Run `run`, counting from 1, of a cell: the crew recruited into a campaign of their own on the config's seed, their
	// decks as the config gives them, sent out at the cell's stage as that campaign's run `run`, so the bridge's
	// nextFightSeed is the seed's fork("run", run).fork("fight", f). Each fight's encounter is the one its step names or
	// pickEncounter's on that seed, and a run home is unloaded for the injury days it brings.
	[[nodiscard]] RunRecord playRun(const FightsConfig& config, const SimRules& shared, const FightCell& cell, int run);

	// A raider card's plays a fight, averaged over every fight of every run.
	struct PlaysAFight {
		double played{0};
		double fizzled{0};

		bool operator==(const PlaysAFight&) const = default;
	};

	// One place in a route, over the runs that got to it. Turns and what was lost are over the fights won.
	struct FightRow {
		int								  skulls{1};
		std::map<rules::EncounterId, int> encounters;
		Rate							  won;
		Rate							  lost;
		Rate							  brokenOff;
		Rate							  stalled;
		Rate							  routed;
		Rate							  driverDown;
		std::optional<double>			  turns;
		std::optional<double>			  hitpointsLost;
		std::optional<double>			  structureLost;
		std::optional<double>			  cardsPlayed;
		std::optional<double>			  raidersKilled;
		std::optional<double>			  wavesSeen;
		std::optional<double>			  decisions;

		bool operator==(const FightRow&) const = default;
	};

	// Fights measured together: their outcomes over every one, and turns, what was lost, and drivers down over those won.
	// The skulls are the first's.
	[[nodiscard]] FightRow measureFights(std::span<const FightRecord> fights);

	// A cell's measures (Balance Simulation, Measures). What was lost, turns, injury days, and drivers down are over the
	// runs home; the rest over every run.
	struct CellRow {
		std::string cell;
		CrewConfig	crew;
		RouteConfig route;
		int			stage{0};
		int			runs{0};
		Rate		home;
		Rate		lost;
		Rate		stalled;
		Rate		brokenOff;
		Rate		routed;
		// For a pair, home as seated in the crew's order, then swapped.
		std::optional<std::array<Rate, 2>> bySeat;
		std::optional<double>			   hitpointsLost;
		std::optional<double>			   structureLost;
		Rate							   driverDown;
		std::optional<double>			   turns;
		std::optional<double>			   injuryDays;
		std::optional<double>			   raidersKilled;
		std::vector<FightRow>			   fights;
		// Over every fight of every run.
		std::map<rules::OpponentId, std::map<rules::CardId, PlaysAFight>> raiderPlays;
		std::map<rules::CardId, double>									  playerPlays;
		int																  decisions{0};

		bool operator==(const CellRow&) const = default;
	};

	[[nodiscard]] CellRow measureCell(const FightsConfig& config, const FightCell& cell, std::span<const RunRecord> runs);

	// Every fight of one skull count a fresh crew opened a route with, at a stage, pairs and lone drivers apart: the
	// per-fight targets' measure. Two routes opening with the same fight play the same draws, so a crew's are counted once.
	struct SkullRow {
		int					  stage{0};
		int					  skulls{1};
		int					  seats{2};
		int					  fights{0};
		Rate				  won;
		Rate				  lost;
		Rate				  brokenOff;
		Rate				  stalled;
		Rate				  routed;
		std::optional<double> turns;
		std::optional<double> hitpointsLost;
		std::optional<double> structureLost;
		std::optional<double> cardsPlayed;
		// The crew that won least, and its rate.
		std::string worstCrew;
		Rate		worstWon;

		bool operator==(const SkullRow&) const = default;
	};

	struct FightsReport {
		FightsConfig		  config;
		std::vector<CellRow>  cells;
		std::vector<SkullRow> skulls;
		// Wall time, which no measure depends on, for what a stand-in's decision costs.
		double seconds{0};
		int	   workers{1};
	};

	// Every cell's runs, spread over `workers` threads, the caller's among them, by salal's TaskPool. Each run is a pure
	// function of the config, its cell, and its number, and the measures are taken in cell and run order afterwards, so
	// the report is the same whatever the workers.
	[[nodiscard]] FightsReport playFights(const FightsConfig& config, const SimRules& shared, int workers);

} // namespace sim
