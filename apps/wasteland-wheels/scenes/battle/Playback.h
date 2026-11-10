#pragma once

// The fight played back from the events apply returns (Battle Screen Design 6, enemy-turn-pacing.md). The rules play a
// whole enemy turn inside the player's EndTurn and open the next turn, so the scene has the fight's end state at once;
// Playback paces what the screen shows of it. It keeps a picture of the fight, a copy of the state before, and moves it on
// one beat at a time by each event's own numbers (a hit takes what VehicleDamaged says off the bars, a move puts the
// vehicle where VehicleMoved says), re-running no rule, then settles on the real state once the last beat has landed.
//
// A player's play is one beat that lands at once. An end turn is: the player's turn closing, at once; the raiders' turn
// opening, with its banner; each raider's part a beat, the first kEnemyLeadIn after the banner and each after kEnemyBeat;
// the turn closing (drop-backs, close-up, wrecks off) and a wave pulling in, a beat of its own; and the player's next turn,
// one beat after the last, which settles. A fight that ends mid-turn settles on the beat that ends it. The beats are
// reading time, so reduced motion keeps them.

#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>

#include <cstddef>
#include <optional>
#include <vector>

namespace game::battle {

	inline constexpr double kEnemyLeadIn = 0.9;
	inline constexpr double kEnemyBeat = 0.7;

	// What lands together, for the scene to show: the events, the turn they happen in, whose they are, and a turn that opens
	// with them.
	struct Beat {
		std::vector<rules::Event>		  events;
		int								  turn = 1;		   // the picture's turn as the first event lands; a TurnStarted in them moves it on
		std::optional<rules::DriverIndex> acting;		   // the raider whose step it is: its token glows
		std::optional<rules::Side>		  opens;		   // a turn that opens on this beat: its banner
		bool							  settles = false; // the last: the picture is the fight itself from here
	};

	class Playback {
	  public:
		// Starts showing `events`, which took the fight from `before` to `after`. Anything still playing lands first. No
		// events make no beats: it isn't playing, and shows `after`.
		void			   start(const rules::BattleState& before, const rules::BattleState& after, std::vector<rules::Event> events);
		[[nodiscard]] bool playing() const;
		// What the screen shows: the picture as the beats so far have moved it, or the fight itself once they've landed.
		[[nodiscard]] const rules::BattleState& shown() const;
		// Moves the clock on by `seconds`, returning the beats that land, in order.
		std::vector<Beat> advance(double seconds);
		// Lands every beat left at once.
		std::vector<Beat> finish();

		// Everything below is the implementer's to change; the public API above is what the scene uses.
	  private:
		struct Timed {
			double at = 0.0;
			Beat   beat;
		};

		[[nodiscard]] Beat land(Timed& timed);

		rules::BattleState picture;
		rules::BattleState settled;
		std::vector<Timed> pending;
		size_t			   next = 0; // the first beat in `pending` still to land
		double			   clock = 0.0;
	};

	// One event's change to the picture, by the event's own numbers; `after` gives what an event doesn't carry (an
	// arrival's vehicle). No rule runs.
	void mirror(rules::BattleState& picture, const rules::Event& event, const rules::BattleState& after);

} // namespace game::battle
