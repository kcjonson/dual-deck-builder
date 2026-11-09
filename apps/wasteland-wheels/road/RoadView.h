#pragma once

// The road (Battle Screen Design 1 and 6, road-view.md, targeting-preview.md, slot-targeting.md): one component drawing
// the ground through Primitives (shoulders and their hatch, lane tints, edge lines, lane dashes, the yellow centre line,
// faint dashed slots, the lane header and the row gutter) and owning a VehicleToken for every vehicle on it, placed in
// its slot by RoadGrid. A vehicle whose slot changes swerves there on the animator; under reduced motion it lands on
// the first tick.
//
// Aiming a card is drag and drop (salal's ui/Drag.h). Every token and every slot has a drop target whose `accepts`
// asks Aim: a token takes a card whose first step offers its vehicle, a slot a card whose first step offers it, and the
// road itself (and every token) a card that takes no pick, which plays wherever it's dropped. A release on anything
// else is refused, so it cancels. While a card is dragged, the targets that take it draw the dashed outline, the one
// under it the solid one with the damage ghost on each bar the hit takes from, and every raider shows its range chip;
// all of it read at paint time off the context's drag (Component::acceptsDrag, isDropActive) and Aim's answers, which the
// road caches per card and per pick, never per frame.
//
// A two-step play (Strafe, Fall In, Shoulder Check, an occupant pick) waits for its next pick after the drop: wait()
// offers that step's picks as pressable spots over the slots or tokens, focusable, the first focused, with the earlier
// picks held solid. A press on one is onPick.

#include "road/RoadLayout.h"
#include "road/RoadPicture.h"
#include "road/VehicleToken.h"
#include "scenes/battle/BattleAim.h"

#include <ui/Component.h>

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace game::road {

	// What the road asks while a card is aimed. The scene answers from battle::Targeting.
	struct Aim {
		// The picks a dragged card's first step offers on the road.
		std::function<std::vector<battle::AimPick>(const battle::HandCard&)> picks;
		// It takes no pick: a drop anywhere on the road plays it.
		std::function<bool(const battle::HandCard&)> anywhere;
		// What dropping it on a pick would do, for the ghost and the hit check.
		std::function<battle::AimPreview(const battle::HandCard&, const battle::AimPick&)> preview;
		// Each raider's range chip with the card aimed and, while one is under it, that pick.
		std::function<std::vector<battle::RangeChip>(const battle::HandCard&, std::optional<battle::AimPick>)> ranges;
		// Dropped on a pick, or with none on the road for a card that takes no pick.
		std::function<void(const battle::HandCard&, std::optional<battle::AimPick>)> onDrop;
	};

	// The step a two-step play waits on after its drop.
	struct WaitingPick {
		battle::HandCard			   card;
		std::vector<battle::AimPick>   chosen;	// drawn solid, taking no input
		std::vector<battle::AimPick>   options; // pressable spots, the first focused
		std::vector<battle::RangeChip> ranges;	// the chips to show while it waits
	};

	class RoadView : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			Aim											aim;
			std::function<void(const battle::AimPick&)> onPick; // a press on a waiting step's spot
		};

		explicit RoadView(const Args& args);

		// Lays the grid out for the road band's size; the scene calls it on enter and on every resize.
		void						  setBand(Foundation::Vec2 band, float bleed);
		[[nodiscard]] const RoadGrid& grid() const { return roadGridNow; }

		// What it shows: tokens come and go with the picture, a changed slot swerves, the rest updates in place.
		void							 show(const RoadPicture& picture);
		[[nodiscard]] const RoadPicture& picture() const { return shown; }

		void wait(std::optional<WaitingPick> waiting);

		// The hand's target preview while a playable card is pointed at or focused (hand-target-preview.md): an arrow
		// from the vehicle it acts from to each it lands on, and from each vehicle it moves to where it goes; solid when
		// `certain`, dotted when it hangs on a pick.
		void present(std::optional<battle::AimPreview> preview, bool certain);
		// The end-turn preview: each intent's line from the raider to the vehicle it hits, and the incoming total on the
		// player's plates.
		void showIntentLines(bool shown);

		// A beat's marks: a number off a vehicle's plate that rises and fades ("-6", "MISS"), and the raider whose step is
		// on screen, which glows.
		void popNumber(rules::VehicleIndex vehicle, std::string text, bool miss);
		void setActing(std::optional<rules::VehicleIndex> vehicle);

		// A token swerving to a new slot.
		[[nodiscard]] bool moving() const;
		// The token for a vehicle on the road, or null.
		[[nodiscard]] VehicleToken* token(rules::VehicleIndex vehicle) const;

		[[nodiscard]] const char* typeName() const override { return "RoadView"; }
		void					  describe(nlohmann::json& node) const override;

		// Everything below is the implementer's to change; the public API above is what the scene uses.
	  protected:
		void onMount() override;
		void render() override;

	  private:
		Aim											aim;
		std::function<void(const battle::AimPick&)> onPick;
		RoadGrid									roadGridNow;
		float										bleed = 0.0F;
		RoadPicture									shown;
	};

} // namespace game::road
