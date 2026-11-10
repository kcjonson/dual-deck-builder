#pragma once

// The combat log (Battle Screen Design 6 and 8, combat-log-content.md): the player's lines for what happened, worded from
// the events apply returns, each tagged with its turn, and the drawer that shows them, 320 px over the right of the road,
// never over the dock or End Turn. Lines wrap and scroll, newest at the foot, the last 100 kept.

#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>
#include <rules/packs/Pack.h>

#include <ui/Component.h>

#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace game::battle {

	enum class LogTone : uint8_t { Plain, Player, Raider, Hit, Miss, Turn, Outcome };

	struct LogLine {
		int			turn = 1;
		std::string text;
		LogTone		tone = LogTone::Plain;

		bool operator==(const LogLine&) const = default;
	};

	// The lines for `events`, which start in `turn`, worded off `after`, the fight once they'd all happened, whose indices
	// still name everyone: card plays by driver for yours and by vehicle for a raider's, hit checks, hits and where they
	// went, misses, fizzles, moves, statuses on and off, who went down, jumped aboard, crashed out or took the wheel,
	// wrecks, waves, the turns and the fight's end. Each line carries the turn it happened in, which a TurnStarted moves
	// on; an enemy turn shares its player turn's number. Record-only events (draws, shuffles, a plan committed, adrenaline
	// refilled) say nothing. Names come from Words (fighterName, vehicleName) with the run's seats.
	[[nodiscard]] std::vector<LogLine> logLines(
		const rules::BattleState&	  after,
		const rules::Content&		  content,
		std::span<const rules::Event> events,
		int							  turn,
		std::span<const std::string>  seats
	);

	// The line the log opens on, the matchup: "Road Warrior 1 and Interceptor 2 vs Scavenger, Scavenger, Spike Raider.",
	// each side named as fighterName names it.
	[[nodiscard]] LogLine matchupLine(const rules::BattleState& state, const rules::Content& content, std::span<const std::string> seats);

	class LogDrawer : public ui::Component {
	  public:
		static constexpr float kWidth = 320.0F;
		static constexpr int   kKept = 100;

		struct Args {
			UI_COMMON_ARGS
		};

		explicit LogDrawer(const Args& args);

		void									  add(std::span<const LogLine> lines);
		[[nodiscard]] const std::vector<LogLine>& lines() const { return kept; }

		[[nodiscard]] const char* typeName() const override { return "LogDrawer"; }

		// Everything below is the implementer's to change; the public API above is what the scene uses.
	  protected:
		void							onMount() override;
		void							render() override;
		[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::Auto; }

	  private:
		void			   addRow(const LogLine& line);
		[[nodiscard]] bool atFoot() const;
		// Scrolls to the newest line after the layout that placed it, when the reader was at the foot.
		void followFoot();

		std::vector<LogLine>   kept;
		ui::Ref<ui::Component> scroller;
		ui::Ref<ui::Component> column;
		bool				   following = true;
	};

} // namespace game::battle
