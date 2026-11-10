#pragma once

// The atlas's buttons (UI Art Direction, Components, Buttons). The highway is the one primary a screen: Highway fill, a
// 4 px Casing border and a 3 px Casing offset beneath, its label in display bold at 30 px, a shield at the right. The
// back road is secondary: Fresh paper, a 1.6 px Back road border and a 1 px inner rule 3 px in, its label at 19 px.
// Hover inks the border and lifts it 1 px; a press, by the pointer or a key, sits it lower, the highway onto its offset;
// focus visible is a 2 px ink ring 3 px out; disabled fades it whole to the theme's disabled opacity under a dashed border.

#include <ui/components/Control.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>

namespace game::atlas {

	enum class Road : uint8_t { Highway, BackRoad };

	class AtlasButton : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string			  label;
			Road				  road = Road::BackRoad;
			bool				  shield = false;  // the highway's shield glyph at the right
			bool				  compact = false; // a back road 30 px tall, its label at 15: a deck builder's controls
			std::function<void()> onPress;
		};

		explicit AtlasButton(const Args& args);

		[[nodiscard]] const std::string& getLabel() const { return label; }
		void							 setLabel(std::string value);
		[[nodiscard]] const char*		 typeName() const override { return "AtlasButton"; }
		[[nodiscard]] float				 inkExtent() const override;
		void							 describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void onInteractionChanged(const ui::InteractionState& previous) override;
		void activate() override;

	  private:
		// The lift or the press as a transform, so the label moves with the face; a key press shows it too.
		void settle();
		void syncLabel(bool enabled, const ui::Theme& theme);

		std::string			  label;
		Road				  road;
		bool				  shield;
		bool				  compact;
		std::function<void()> onPress;
		ui::Ref<ui::Text>	  text;
		ui::Style			  enabledStyle;
		bool				  labelEnabled = true;
	};

} // namespace game::atlas
