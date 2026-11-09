#pragma once

// The top bar (Battle Screen Design 2 and 8): 36 tall across the stage. The wave and what's coming ("Wave 2 of 3",
// "+3 arriving"), the turn and whose it is, a one-line ticker of the last log line (12 px, cut with an ellipsis; the full
// text is in the log), and the LOG toggle, which opens and closes the drawer.

#include <ui/Component.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>

namespace game::battle {

	struct TopBarPicture {
		int			wave = 1;
		int			waves = 1;
		int			arriving = 0; // raiders pulling in at the end of this enemy turn, arrivalsOf's count
		int			turn = 1;
		bool		raidersActing = false;
		std::string ticker;
		bool		logOpen = false;

		bool operator==(const TopBarPicture&) const = default;
	};

	class TopBar : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::function<void()> onToggleLog; // the LOG button, id "log_toggle", and the L key
		};

		explicit TopBar(const Args& args);

		void							   show(const TopBarPicture& picture);
		[[nodiscard]] const TopBarPicture& picture() const { return shown; }

		[[nodiscard]] const char* typeName() const override { return "TopBar"; }

		// Everything below is the implementer's to change; the public API above is what the scene uses.
		static constexpr float kHeight = 36.0F;

	  protected:
		void onMount() override;
		void render() override;

	  private:
		void refresh();

		std::function<void()>  onToggleLog;
		TopBarPicture		   shown;
		ui::Ref<ui::Text>	   wave;
		ui::Ref<ui::Text>	   arriving;
		ui::Ref<ui::Text>	   turn;
		ui::Ref<ui::Text>	   whose;
		ui::Ref<ui::Component> ticker;
		ui::Ref<ui::Component> logButton;
	};

} // namespace game::battle
