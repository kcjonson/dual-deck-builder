#pragma once

// Glyphs made of several icons drawn over each other, each tinted its own colour (UI Art Direction, Card hints and
// Buttons): the deck glyph, two cards in the drivers' casing colours, and the highway's shield. Decoration: the pointer
// passes through them.

#include <ui/Component.h>
#include <ui/theme/TokenTable.h>

#include <string>
#include <vector>

namespace game::atlas {

	class IconStack : public ui::Component {
	  public:
		struct Layer {
			std::string	   icon;
			ui::ColorToken color;
		};

		struct Args {
			UI_COMMON_ARGS
			std::vector<Layer> layers; // bottom first
		};

		explicit IconStack(const Args& args)
			: layers(args.layers) {}

		[[nodiscard]] const char* typeName() const override { return "IconStack"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void							render() override;
		[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::None; }

	  private:
		std::vector<Layer> layers;
	};

	// The map's circled number or letter, as large as fits its box.
	class Circled : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string text;
		};

		explicit Circled(const Args& args)
			: text(args.text) {}

		[[nodiscard]] const char* typeName() const override { return "Circled"; }

	  protected:
		void							render() override;
		[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::None; }

	  private:
		std::string text;
	};

	// Two cards overlapped, deck A's in Highway's casing under deck B's in Route teal's: 20 px square.
	[[nodiscard]] IconStack::Args deckGlyph(const std::string& id = {});

	// The highway's shield with its arrow, paper on casing: 38 px square.
	[[nodiscard]] IconStack::Args shieldGlyph(const std::string& id = {});

} // namespace game::atlas
