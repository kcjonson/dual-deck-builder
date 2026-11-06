#pragma once

// A card's words as a player reads them (Card System Design 1.1): its name, its face text and its rules text with every
// {variable} filled in, base or upgraded, and the rules words they're written with. A summary marks its keywords in
// [brackets]; the full text isn't marked up, so a keyword there is any keyword's name.

#include "Card.h"

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace rules {

	// "Ramming Speed", or "Ramming Speed+" upgraded.
	[[nodiscard]] std::string cardName(const CardDefinition& card, bool upgraded);

	// The face's text, the upgrade's own where it has one, its {variables} filled; keywords still in [brackets].
	[[nodiscard]] std::string cardSummary(const CardDefinition& card, bool upgraded);

	// The detail view's full rules text, the upgrade's own where it has one, its {variables} filled.
	[[nodiscard]] std::string cardDescription(const CardDefinition& card, bool upgraded);

	// A text with its [brackets] dropped, for a line that shows card text as plain words.
	[[nodiscard]] std::string plainText(std::string_view text);

	struct Keyword {
		std::string_view name;
		std::string_view meaning;
	};

	// Every rules word a card is written with, and what it means for the keyword boxes beside the detail view.
	[[nodiscard]] std::span<const Keyword> keywords();

	// The keyword a name means, matched ignoring case and runs of spaces; null for none.
	[[nodiscard]] const Keyword* findKeyword(std::string_view name);

	// How a text marks its keywords: only in [brackets], as a summary does, or also wherever a keyword's name appears, as
	// the full text is read.
	enum class KeywordMarks : uint8_t { Bracketed, Anywhere };

	struct TextPiece {
		std::string text;
		bool		keyword = false;

		bool operator==(const TextPiece&) const = default;
	};

	// A word between spaces, in pieces: "[Flank]s" is one word in two.
	using TextWord = std::vector<TextPiece>;

	// A text cut into keyword and plain stretches, the brackets dropped.
	[[nodiscard]] std::vector<TextPiece> keywordPieces(std::string_view text, KeywordMarks marks);

	// A text cut into words and each word into its pieces.
	[[nodiscard]] std::vector<TextWord> keywordWords(std::string_view text, KeywordMarks marks);

	// The longest range any of the card's effects names, or none.
	[[nodiscard]] std::optional<int> cardRange(const CardDefinition& card, bool upgraded);

	// The keywords the detail view explains, in the order they come up: the full text's, the summary's brackets, then the
	// card's range.
	[[nodiscard]] std::vector<const Keyword*> cardKeywords(const CardDefinition& card, bool upgraded);

} // namespace rules
