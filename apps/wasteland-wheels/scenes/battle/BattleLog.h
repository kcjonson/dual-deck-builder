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

	// The lines for `events`, worded off `after`, the fight once they'd all happened, whose indices still name everyone:
	// card plays by driver for yours and by vehicle for a raider's, hit checks, hits and where they went, misses, fizzles,
	// moves, statuses on and off, who went down, jumped aboard, crashed out or took the wheel, wrecks, waves, the turns
	// and the fight's end. Record-only events (draws, shuffles, a plan committed, adrenaline refilled) say nothing.
	// Names come from Words (fighterName, vehicleName) with the run's seats.
	[[nodiscard]] std::vector<LogLine> logLines(
		const rules::BattleState&	  after,
		const rules::Content&		  content,
		std::span<const rules::Event> events,
		std::span<const std::string>  seats
	);

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
		void onMount() override;

	  private:
		std::vector<LogLine> kept;
	};

} // namespace game::battle
