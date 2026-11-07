#pragma once

#include "scenes/GameScene.h"
#include "scenes/crew/DeckBuilder.h"

#include <rules/campaign/Campaign.h>
#include <rules/campaign/Locker.h>

#include <string>

namespace game {

	struct CustomizeArgs {
		rules::campaign::CrewId driver;
	};

	// Done, handed back to the scene that pushed it, which shows the campaign again.
	struct CustomizeDone {};

	// Customize (Game Flow 1.2, customize-screen.md): one seated driver's run deck, pushed over load out once the run decks
	// are out, in the atlas. The driver, Reset to default and the escort cards on the left; the run deck in the middle as
	// a card's own, borrowed (+N) and left-at-home (HOME) stacks, each with one fewer and one more; the locker after the
	// other seat's borrowing on the right, with Borrow. Every control is a moveCards the rules are asked about first, and
	// each change is saved as it's made. Done, or Escape, goes back.
	class CustomizeScene final : public GameScene<CustomizeArgs, CustomizeDone> {
	  public:
		explicit CustomizeScene(CustomizeArgs args);

		const char* name() const override { return "customize"; }
		std::string exportState() const override;

	  protected:
		const ui::Theme& sceneTheme() const override;
		void			 enter() override;

	  private:
		void build();
		void heading(const rules::campaign::Campaign& campaign);
		void driverColumn(ui::Ref<ui::Component> body, const rules::campaign::Campaign& campaign);
		void runDeck(ui::Ref<ui::Component> body, const rules::campaign::Campaign& campaign);
		void locker(ui::Ref<ui::Component> body, const rules::campaign::Campaign& campaign);
		void keys(ui::KeyEvent& event);
		void done();

		// A moveCards between the run deck and the locker as a control: off with the rules' reason, or with nothing said
		// where the run deck has no such copy for it (a full stack's one more).
		[[nodiscard]] crew::EntryControl move(const std::string& key, const std::string& label, const rules::campaign::CardMove& made);

		template <typename Action>
		void step(Action&& action);

		rules::campaign::CrewId driver;
		ui::Ref<ui::Component>	sheet;
		crew::CardKind			filter = crew::CardKind::All;
		std::string				notice;
	};

} // namespace game
