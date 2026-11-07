#pragma once

// One choice at an event stop (Game Flow 5.2 and 7.0; event-screen.md, The screen): a card, not a list row. Card stock
// with 7 px corners, flat fresh paper as the thing in focus is: an index band with what the choice needs, or in
// Stronghold why it can't be taken, and its number key; the action in display bold; the hint; and at its foot two rows of
// icons, what it risks and what it can give. It's pressed like a button and taken when pressed. One that can't be taken
// is disabled, in one of the art direction's two states: locked, for a need the party lacks, under the rust hatch with
// its label clean; or short, for the stores, in faded print under a dashed border with its title struck through.

#include "scenes/event/EventText.h"

#include <graphics/Color.h>
#include <math/Types.h>
#include <ui/components/Control.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>

namespace ui {
	class Context;
	class Theme;
} // namespace ui

namespace game::event {

	// An icon `size` px square at `topLeft`, in `color`: the stores' from the icon atlases, the rest as strokes.
	void drawIcon(ui::Context& context, Icon icon, Foundation::Vec2 topLeft, float size, Foundation::Color color, int32_t key);

	// One icon as a component, 18 px square, in its tone's colour. Decoration.
	class IconView : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			Icon icon = Icon::Skull;
			Tone tone = Tone::Ink;
		};

		explicit IconView(const Args& args)
			: icon(args.icon),
			  tone(args.tone) {}

		[[nodiscard]] const char* typeName() const override { return "IconView"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		Icon icon;
		Tone tone;
	};

	// A row of icons, each with its value after it, under `parent`, its items `<id>_<n>`.
	ui::Ref<ui::Component>
	iconRow(ui::Ref<ui::Component> parent, const std::string& id, const std::vector<IconItem>& items, const ui::Theme& theme);

	// The ink a tone prints in.
	[[nodiscard]] Foundation::Color toneColor(const ui::Context& context, Tone tone);

	enum class Lock : uint8_t { Open, Need, Short };

	class ChoiceCard : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string			  title;
			std::string			  preview;
			std::string			  band;
			std::string			  hotkey; // the number key that takes it, at the band's right
			Lock				  lock = Lock::Open;
			ChoiceIcons			  icons;
			std::function<void()> onPress;
		};

		explicit ChoiceCard(const Args& args);

		[[nodiscard]] Lock		  lockState() const { return lock; }
		[[nodiscard]] const char* typeName() const override { return "ChoiceCard"; }
		[[nodiscard]] float		  inkExtent() const override;
		// A locked card's label stays clean: only a shortfall fades it.
		[[nodiscard]] float stateOpacity() const override;
		void				describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void onInteractionChanged(const ui::InteractionState& previous) override;
		void activate() override;

	  private:
		// The lift or the press as a transform, so the words move with the face.
		void settle();

		std::string			   title;
		std::string			   preview;
		std::string			   band;
		std::string			   hotkey;
		Lock				   lock;
		ChoiceIcons			   icons;
		std::function<void()>  onPress;
		ui::Ref<ui::Text>	   titleText;
		ui::Ref<ui::Component> risksRow;
	};

} // namespace game::event
