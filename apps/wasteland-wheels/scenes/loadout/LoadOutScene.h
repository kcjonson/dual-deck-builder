#pragma once

#include "scenes/GameScene.h"

#include <rules/campaign/Campaign.h>
#include <rules/campaign/SupplyRun.h>

#include <optional>
#include <string>
#include <vector>

namespace game {

	struct LoadOutArgs {
		rules::campaign::RouteChoice route;
	};

	// Load out (Game Flow 1.2, load-out-screen.md), in the atlas: the route along the top with Back to the route, two seats
	// each with its driver card, Clear seat and Customize, and the deck they'll take as minis; the pool below as driver
	// cards with Seat, faded with the rules' reason where they can't go; the convoy's escorts to bring or leave, marked in
	// highlighter while they're coming; and Start run, the highway, with why it can't go yet under it.
	//
	// It opens on the crew the quick load out would send and every escort (calls 177 and 67). The run decks are dealt the
	// first time they're needed, by Customize or Start run; a seat change after that gives them up (call 178), an escort
	// brought or left moves only its card, and Back gives them up (call 179). Start run checks the departure on a copy of
	// the campaign, so its reason is the rules', and seats one driver only when nobody else can go beside them.
	class LoadOutScene final : public GameScene<LoadOutArgs> {
	  public:
		explicit LoadOutScene(LoadOutArgs args);

		const char* name() const override { return "load_out"; }
		std::string exportState() const override;

	  protected:
		const ui::Theme& sceneTheme() const override;
		void			 enter() override;

	  private:
		void build();
		void heading(const rules::campaign::Campaign& campaign);
		void seatsRow(ui::Ref<ui::Component> body, const rules::campaign::Campaign& campaign);
		void seatBox(ui::Ref<ui::Component> row, const rules::campaign::Campaign& campaign, size_t place);
		void pool(ui::Ref<ui::Component> row, const rules::campaign::Campaign& campaign);
		void convoy(ui::Ref<ui::Component> row, const rules::campaign::Campaign& campaign);
		void foot(const rules::campaign::Campaign& campaign);
		void keys(ui::KeyEvent& event);

		// The run decks are out: a run dealt at the compound that hasn't left.
		[[nodiscard]] bool decksOut() const;
		// Who sits where and who comes along: the run's once its decks are out, the plan's before.
		[[nodiscard]] std::vector<rules::campaign::CrewId>	 seated() const;
		[[nodiscard]] std::vector<rules::campaign::ConvoyId> along() const;
		// The seats a run takes now: two, or one when nobody else can be seated beside the first (call 35).
		[[nodiscard]] size_t seatsNeeded() const;
		// Why the crew can't go as seated, or none; Customize is live without it.
		[[nodiscard]] std::optional<std::string> crewBlocker() const;
		// Why the run can't leave as it's loaded out now, or none.
		[[nodiscard]] std::optional<std::string> startBlocker() const;

		void seat(const rules::campaign::CrewId& driver);
		void clearSeat(size_t place);
		void swapSeats();
		void toggleEscort(const rules::campaign::ConvoyId& escort);
		void customize(size_t place);
		void startRun();
		void back();
		// The run decks given up, back to the plan, before a seat changes.
		void unwind();
		// The run decks dealt from the plan, if they aren't out yet.
		void deal();
		void save();

		rules::campaign::RouteChoice		   route;
		std::vector<rules::campaign::CrewId>   seats;
		std::vector<rules::campaign::ConvoyId> escorts;
		ui::Ref<ui::Component>				   sheet;
		std::string							   notice;
	};

} // namespace game
