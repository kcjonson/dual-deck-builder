#pragma once

// The atlas's panels and lists (UI Art Direction, Components). A legend box is paper with a 1.4 px ink border and a
// 0.6 px rule 6 px inside it, padded 16 by 18, its head in display bold spaced capitals; its rows are split by
// hairlines and led by map-legend symbols. A contents row is the atlas's contents page: a leading glyph, the label in
// display bold, dotted leaders, and a mono value at the right.

#include "atlas/Paper.h"

#include <ui/Component.h>
#include <ui/Style.h>
#include <ui/shapes/Text.h>

#include <string>

namespace game::atlas {

	class LegendBox : public Paper {
	  public:
		struct Args {
			UI_COMMON_ARGS
			PaperLook	look;
			std::string title; // its head; none when empty
		};

		explicit LegendBox(const Args& args);

		[[nodiscard]] const char* typeName() const override { return "LegendBox"; }

	  protected:
		void onMount() override;
		void render() override;

	  private:
		std::string title;
	};

	// The map legend's symbols: a stronghold diamond for a shortfall, an open ring for something pending, a dashed line
	// for nothing to report.
	enum class MapSymbol : uint8_t { Diamond, Ring, Dash };

	class LegendRow : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			MapSymbol	symbol = MapSymbol::Ring;
			std::string text;
			std::string tag;	   // a mono capitals tag at the right; none when empty
			ui::Style	textStyle; // the atlas's body by default
		};

		explicit LegendRow(const Args& args);

		[[nodiscard]] const char* typeName() const override { return "LegendRow"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;

	  private:
		MapSymbol	symbol;
		std::string text;
		std::string tag;
		ui::Style	textStyle;
	};

	class ContentsRow : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string label;
			std::string value;
			std::string glyph; // a circled number or letter before the label; none when empty
			ui::Style	labelStyle;
		};

		explicit ContentsRow(const Args& args);

		[[nodiscard]] const char* typeName() const override { return "ContentsRow"; }

	  protected:
		void onMount() override;
		void render() override;

	  private:
		std::string		  label;
		std::string		  value;
		std::string		  glyph;
		ui::Style		  labelStyle;
		ui::Ref<ui::Text> labelText;
		ui::Ref<ui::Text> valueText;
	};

} // namespace game::atlas
