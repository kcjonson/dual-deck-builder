#pragma once

// The detail view (Battle Screen Design 5, Game Flow 7.0): 250 wide, the cost hex, the name on up to two lines, the type
// and seat mark, the art, the full rules text at 15 px with its keywords marked, and a foot with the rarity gem, the
// range and how to pin it; as tall as that needs, up to 440, the art giving way first. Beside it, the keyword boxes
// explain up to three of its keywords, on the right for driver 1's cards and nobody's, on the left for driver 2's.
// CardInspect is the pair, which a card opens as an overlay beside itself.

#include "cards/CardInk.h"

#include <ui/Component.h>

#include <rules/core/Card.h>
#include <rules/core/CardText.h>

#include <optional>
#include <string>
#include <vector>

namespace game::cards {

	class CardDetail : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			const rules::CardDefinition* card = nullptr;
			bool						 upgraded = false;
			std::optional<int>			 seat;
			bool						 pinned = false;
		};

		explicit CardDetail(const Args& args);

		// What it lays out to at 250 wide: its height, the art's, and the lines its name and rules take. Zero lines with
		// no fonts loaded.
		struct Metrics {
			float height = 0.0F;
			float art = 0.0F;
			int	  nameLines = 0;
			int	  rulesLines = 0;
		};
		[[nodiscard]] Metrics measure() const;

		[[nodiscard]] const char* typeName() const override { return "CardDetail"; }
		[[nodiscard]] float		  inkExtent() const override;
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::Auto; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		const rules::CardDefinition* card;
		bool						 upgraded;
		std::optional<int>			 seat;
		bool						 pinned;
		std::string					 description;
		// Laid out once, as it's built: the name's lines, the rules text's flow, and the heights they leave.
		std::vector<std::string> name;
		WordFlow				 flow;
		float					 head = 0.0F;
		float					 art = 0.0F;
		float					 height = 0.0F;
	};

	// One keyword's box: its name in the keyword yellow over what it means.
	class KeywordNote : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			const rules::Keyword* keyword = nullptr;
		};

		explicit KeywordNote(const Args& args);

		[[nodiscard]] const char* typeName() const override { return "KeywordNote"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::Auto; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		const rules::Keyword*	 keyword;
		std::vector<std::string> lines; // its meaning, wrapped once as it's built
	};

	class CardInspect : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			const rules::CardDefinition* card = nullptr;
			bool						 upgraded = false;
			std::optional<int>			 seat;
			bool						 pinned = false;
		};

		explicit CardInspect(const Args& args)
			: shown(args) {}

		[[nodiscard]] const char* typeName() const override { return "CardInspect"; }

	  protected:
		void onMount() override;

	  private:
		Args shown;
	};

} // namespace game::cards
