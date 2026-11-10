#pragma once

// The top bar (Battle Screen Design 2 and 8): 36 tall across the stage. The menu's key, the wave and what's coming
// ("Wave 2 of 3", "+3 arriving"), the turn and whose it is, a one-line ticker of the last log line (12 px, cut with an
// ellipsis; the full text is in the log), the scrap and fuel the run carries, and the LOG toggle, which opens and closes
// the drawer.
//
// The menu is a dialog over the fight: Keep fighting, or Abandon the run, under a warning of what giving the fight up
// costs. The key is off while the raiders act and once the fight is over, when the dock's Leave is the way on.

#include <ui/Component.h>
#include <ui/components/Dialog.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <optional>
#include <string>

namespace game::battle {

	// What the run carries that the bar shows.
	struct Carried {
		int scrap = 0;
		int fuel = 0;

		bool operator==(const Carried&) const = default;
	};

	struct TopBarPicture {
		int					   wave = 1;
		int					   waves = 1;
		int					   arriving = 0; // raiders pulling in at the end of this enemy turn, arrivalsOf's count
		int					   turn = 1;
		bool				   raidersActing = false;
		std::string			   ticker;
		bool				   logOpen = false;
		bool				   menu = true; // the menu's key is on
		std::optional<Carried> cargo;		// none with no run out, and the bar leaves scrap and fuel off

		bool operator==(const TopBarPicture&) const = default;
	};

	class TopBar : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::function<void()>		 onToggleLog;	 // the LOG button, id "log_toggle", and the L key
			std::function<void()>		 onAbandon;		 // the menu's Abandon the run, id "menu_abandon"
			std::function<std::string()> abandonWarning; // what abandoning costs, asked for as the menu opens
		};

		explicit TopBar(const Args& args);

		void							   show(const TopBarPicture& picture);
		[[nodiscard]] const TopBarPicture& picture() const { return shown; }

		// The menu, id "menu_dialog", opened over the fight as its key, id "menu", opens it; false while the key is off or
		// it's open already.
		bool			   openMenu();
		[[nodiscard]] bool menuOpen() const { return menuDialog.get() != nullptr; }

		[[nodiscard]] const char* typeName() const override { return "TopBar"; }

		// Everything below is the implementer's to change; the public API above is what the scene uses.
		static constexpr float kHeight = 36.0F;

	  protected:
		void onMount() override;
		void render() override;

	  private:
		void refresh();
		void closeMenu();

		std::function<void()>		 onToggleLog;
		std::function<void()>		 onAbandon;
		std::function<std::string()> abandonWarning;
		TopBarPicture				 shown;
		ui::Ref<ui::Component>		 menuButton;
		ui::Ref<ui::Dialog>			 menuDialog;
		ui::Ref<ui::Text>			 wave;
		ui::Ref<ui::Text>			 arriving;
		ui::Ref<ui::Text>			 turn;
		ui::Ref<ui::Text>			 whose;
		ui::Ref<ui::Component>		 ticker;
		ui::Ref<ui::Component>		 scrapGroup;
		ui::Ref<ui::Text>			 scrap;
		ui::Ref<ui::Component>		 fuelGroup;
		ui::Ref<ui::Text>			 fuel;
		ui::Ref<ui::Component>		 logButton;
	};

} // namespace game::battle
