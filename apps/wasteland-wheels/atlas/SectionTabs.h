#pragma once

// Section tabs (UI Art Direction, Components): thumb-index tabs hanging from the sheet's top edge, the navigation between
// the meta scenes in place of Back buttons. The active tab is fresh paper and 4 px taller; the others are index colour
// with ink-dim labels. Each is open at the top, where it runs on past the sheet's edge.

#include <ui/components/Control.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>
#include <vector>

namespace game::atlas {

	class SectionTab : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string			  label;
			bool				  active = false;
			bool				  deckGlyph = false; // the deck glyph before the label: the Crew tab
			std::function<void()> onPress;
		};

		explicit SectionTab(const Args& args);

		[[nodiscard]] bool		  isCurrent() const { return current; }
		[[nodiscard]] const char* typeName() const override { return "SectionTab"; }
		[[nodiscard]] float		  inkExtent() const override;
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void activate() override;

	  private:
		std::string			  label;
		bool				  current;
		bool				  deckGlyph;
		std::function<void()> onPress;
	};

	struct TabSpec {
		std::string			  id;
		std::string			  label;
		bool				  active = false;
		bool				  enabled = true;
		bool				  deckGlyph = false;
		std::function<void()> onPress;
	};

	// The tabs in a row, hanging from the top of `parent`'s box.
	ui::Ref<ui::Component> sectionTabs(ui::Ref<ui::Component> parent, const std::vector<TabSpec>& tabs);

} // namespace game::atlas
