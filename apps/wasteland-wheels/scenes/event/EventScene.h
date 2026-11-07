#pragma once

#include "atlas/Sheet.h"
#include "scenes/GameScene.h"

#include <rules/campaign/EventStops.h>

#include <optional>
#include <string>

namespace game {

	struct EventArgs {
		// Beside the kicker: "stop 2 of 5".
		std::string where;
	};

	// Where the run goes once the event scene's done: back to the road with nothing taken, or on after a choice, into the
	// fight it turned into, or to the card it opened.
	enum class EventNext : uint8_t { Back, DriveOn, Fight, PickCard };

	// The event at the stop the run is at (Game Flow 5; event-screen.md), pushed over the run: a storybook page on the
	// atlas sheet, the plate on the left, the title and the journal beside it (the setup, then the situation), and the
	// choices along the foot as cards, each with what it risks and can give, the ones the party can't take saying why.
	// Taking one, by a press, Enter, or its number key, is the rules' takeEventChoice, saved at once; the cards give way
	// to what happened, what it gave and took, the cards it gave drawn as cards, and the highway on.
	class EventScene final : public GameScene<EventArgs, EventNext> {
	  public:
		explicit EventScene(EventArgs args);

		const char* name() const override { return "event"; }
		std::string exportState() const override;

	  protected:
		const ui::Theme& sceneTheme() const override;
		void			 enter() override;

	  private:
		void build();
		void choices(ui::Ref<ui::Component> foot);
		void outcome(ui::Ref<ui::Component> foot);
		// Takes the choice, as a press does; nothing for one the party can't take, or once one is taken.
		void take(const std::string& choice);
		void keys(ui::KeyEvent& event);

		std::string								   where;
		const rules::campaign::EventDefinition*	   definition = nullptr;
		std::optional<rules::campaign::EventTaken> taken;
		std::string								   chosen;
		std::string								   notice;
		ui::Ref<atlas::Sheet>					   sheet;
	};

} // namespace game
