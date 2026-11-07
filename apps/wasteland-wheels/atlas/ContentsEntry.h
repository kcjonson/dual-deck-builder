#pragma once

// An entry on the atlas's contents page (UI Art Direction, Components: Contents rows), pressed to open it: a leading
// marker, the label in display bold with a line under it, dotted leaders, and a mono value at the right. The primary
// entry leads with the highway shield, its label larger, between two ink rules; the others with a circled glyph, an
// empty ring, the deck glyph or nothing, over a hairline. Disabled, the label, leaders, value and marker go to faded
// print and the line under it stays legible, since it says why. A record is the same row read, not pressed: no focus,
// and the pointer passes through it.

#include <ui/components/Control.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>

namespace game::atlas {

	enum class EntryLead : uint8_t { None, Shield, Circled, Ring, Deck };
	enum class EntrySize : uint8_t { Primary, Row, Appendix };

	class ContentsEntry : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string			  label;
			std::string			  line;	 // under the label; none when empty
			std::string			  value; // at the end of the leaders; none when empty
			EntryLead			  lead = EntryLead::None;
			std::string			  leadText; // the shield's or the circle's figures
			EntrySize			  entrySize = EntrySize::Row;
			bool				  warnLine = false; // the line in stronghold red: a save that can't be read
			bool				  record = false;
			std::function<void()> onPress;
		};

		explicit ContentsEntry(const Args& args);

		[[nodiscard]] const std::string& getLabel() const { return label; }
		[[nodiscard]] const std::string& getLine() const { return line; }
		[[nodiscard]] const char*		 typeName() const override { return "ContentsEntry"; }
		[[nodiscard]] float				 stateOpacity() const override { return 1.0F; }
		void							 describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void activate() override;

	  private:
		std::string			  label;
		std::string			  line;
		std::string			  value;
		EntryLead			  lead;
		std::string			  leadText;
		EntrySize			  entrySize;
		bool				  warnLine;
		bool				  record;
		std::function<void()> onPress;
		ui::Ref<ui::Text>	  labelText;
		ui::Ref<ui::Text>	  valueText;
	};

} // namespace game::atlas
