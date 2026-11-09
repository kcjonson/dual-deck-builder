#pragma once

// The turn banner (Battle Screen Design 6, road-view.md): a band across the road's rows, never the dock, saying whose turn
// it is. YOUR TURN on the player's dark band, RAIDERS' TURN on the raiders' red one, and the fight's end. It slides and
// fades in, holds, and leaves on the animator; under reduced motion it shows and goes without moving, and its hold, which
// is reading time, stays.

#include <rules/battle/RoadGrid.h>

#include <graphics/Color.h>
#include <ui/Animator.h>
#include <ui/Component.h>

#include <optional>
#include <string>

namespace game::battle {

	class TurnBanner : public ui::Component {
	  public:
		// How long a banner holds before it starts to leave, and how long it takes to come and go.
		static constexpr float kHold = 1.0F;
		static constexpr float kMotion = 0.2F;

		struct Args {
			UI_COMMON_ARGS
		};

		explicit TurnBanner(const Args& args);

		// Shows the banner for a side's turn, replacing any up.
		void announce(rules::Side side);
		// Shows the fight's end ("FIGHT WON", "BROKEN OFF", "CONVOY LOST") and keeps it up.
		void					  announceEnd(std::string text);
		[[nodiscard]] bool		  showing() const;
		[[nodiscard]] std::string text() const;

		[[nodiscard]] const char* typeName() const override { return "TurnBanner"; }

		// Everything below is the implementer's to change; the public API above is what the scene uses.
		// The band's height, centred in the box the scene gives it.
		static constexpr float kBandHeight = 56.0F;

	  protected:
		void							onMount() override;
		void							render() override;
		[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::None; }

	  private:
		void bring(std::string words, Foundation::Color band, Foundation::Color ink, bool leaving);
		void enter();
		void leave();

		std::string		  shownText;
		Foundation::Color bandColor;
		Foundation::Color textColor;
		bool			  leaves = true; // a turn's banner leaves after its hold; the fight's end stays
		bool			  up = false;
		// 0 off to the left, 1 in place, 2 gone off to the right: the words slide by it and the band fades with it.
		float			 travel = 0.0F;
		ui::Tween<float> motion;
		ui::TimerId		 hold;
	};

} // namespace game::battle
