#pragma once

// The dock (Battle Screen Design 4 and 6, split-dock.md): each driver owns half, a tab above their cards (mark, name, a
// PASSENGER or CRASHED OUT tag, adrenaline pips, draw and discard counts) and their hand fanned within the half, cards.Card
// at face size. End Turn is a 148 px column at the stage's right end: the turn above it, the button, and the "N adrenaline
// unspent" warning under it.
//
// A playable card is a drag source (salal's ui/Drag.h) of kind battle::kCardDrag carrying its HandCard: the pointer
// drags it past 6 px, and activate on a focused card picks it up for the keys, which move it among the road's accepting
// targets and drop it with activate again. Hover or focus on a card presents it for the road's target preview.
// A card that can't be played dims, with its blocked strip when it has one, and takes no drag.
//
// Locked for the enemy turn and once the fight is over: the hands drop 60 and grey under the scrim, nothing takes input,
// and End Turn reads WAIT.

#include "cards/Card.h"
#include "scenes/battle/BattleAim.h"
#include "scenes/battle/Targeting.h"

#include <rules/battle/BattleState.h>
#include <rules/core/Content.h>

#include <ui/Component.h>

#include <functional>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace game::battle {

	struct DockCard {
		HandCard					 card;
		const rules::CardDefinition* definition = nullptr;
		bool						 upgraded = false;
		bool						 playable = false;
		bool						 affordable = true;
		std::optional<std::string>	 blockLabel;

		bool operator==(const DockCard&) const = default;
	};

	struct DockHalf {
		rules::DriverIndex		   driver;
		int						   seat = 0; // 0 or 1: the mark, the colour, the half
		std::string				   name;
		std::optional<std::string> tag; // PASSENGER, CRASHED OUT
		int						   adrenaline = 0;
		int						   maxAdrenaline = 0;
		int						   draw = 0;
		int						   discard = 0;
		bool					   crashedOut = false;
		std::vector<DockCard>	   hand;

		bool operator==(const DockHalf&) const = default;
	};

	struct DockPicture {
		std::vector<DockHalf> halves; // the player's drivers in seat order, one or two
		int					  turn = 1;
		int					  unspent = 0; // adrenaline left across both drivers who can still play
		bool				  canEndTurn = false;

		bool operator==(const DockPicture&) const = default;
	};

	// The dock as the fight stands, its cards judged by `targeting`.
	[[nodiscard]] DockPicture dockPicture(
		const rules::BattleState&	 state,
		const rules::Content&		 content,
		const Targeting&			 targeting,
		std::span<const std::string> seats
	);

	class Dock : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::function<void()>						 onEndTurn;
			std::function<void(bool)>					 onEndTurnPreview; // End Turn pointed at or focused, and no longer
			std::function<void(std::optional<HandCard>)> onPresented;	   // the playable card pointed at or focused, or none
			std::function<void(const HandCard&)>		 onDragStart;
			std::function<void(const HandCard&, bool)>	 onDragEnd; // dropped on a target that took it, or not
		};

		explicit Dock(const Args& args);

		// Card ids are "hand_<driver>_<place>", End Turn's "end_turn".
		void							 show(const DockPicture& picture);
		[[nodiscard]] const DockPicture& picture() const { return shown; }
		void							 setLocked(bool locked);
		[[nodiscard]] bool				 locked() const { return isLocked; }
		// The card component for a card in hand, or null.
		[[nodiscard]] cards::Card* card(HandCard card) const;

		[[nodiscard]] const char* typeName() const override { return "Dock"; }
		void					  describe(nlohmann::json& node) const override;

		// Everything below is the implementer's to change; the public API above is what the scene uses.
	  protected:
		void onMount() override;
		void render() override;

	  private:
		Args		args;
		DockPicture shown;
		bool		isLocked = false;
	};

} // namespace game::battle
