#include "CardText.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <variant>

namespace rules {

	namespace {

		constexpr std::array<Keyword, 12> kKeywords{{
			{"Range 1", "Reaches one step: the next lane over on the same row."},
			{"Range 2", "Reaches two steps, counting lanes across plus rows ahead or behind."},
			{"Vulnerable", "Takes 50% more damage. Counts down each turn."},
			{"Sure-hit", "Ignores Evade. Always lands."},
			{"Partner", "Your other driver. Synergy cards check what they did this turn."},
			{"Armor",
			 "Absorbs damage after Shield. Lasts the fight until it is knocked off. Armor past base makes a vehicle Heavy: no "
			 "speed boosts."},
			{"Shield", "Temporary armor. Takes damage before Armor, stacks, and clears at the start of your turn."},
			{"Flank", "Outrun the target onto the shoulder beside it, in its row. Needs more speed than the target."},
			{"Swerve",
			 "Move to an empty slot next to you in your formation: one lane over, or a row ahead or behind. Never diagonal, and "
			 "not while flanking."},
			{"Exhaust", "Removed from your deck until the fight ends."},
			{"Evade", "A shot hits only if the attacker's Gunnery beats the target's Evade."},
			{"Escort",
			 "A convoy vehicle with no driver of its own. Order cards command it; once it acts it is spent until your next turn."},
		}};

		bool isSpace(char character) {
			return std::isspace(static_cast<unsigned char>(character)) != 0;
		}

		bool isWordCharacter(char character) {
			return std::isalnum(static_cast<unsigned char>(character)) != 0 || character == '_' || character == '-';
		}

		char lower(char character) {
			return static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
		}

		// How much of `text` from `at` spells `name`, ignoring case and taking a run of spaces for each space; 0 for none.
		size_t spelled(std::string_view text, size_t at, std::string_view name) {
			size_t from = at;
			for (const char letter : name) {
				if (from >= text.size()) {
					return 0;
				}
				if (letter == ' ') {
					if (!isSpace(text[from])) {
						return 0;
					}
					while (from < text.size() && isSpace(text[from])) {
						++from;
					}
					continue;
				}
				if (lower(text[from]) != lower(letter)) {
					return 0;
				}
				++from;
			}
			return from - at;
		}

		// The keyword names longest first, so "Range 1" is found before a shorter name inside it.
		const std::vector<std::string_view>& namesLongestFirst() {
			static const std::vector<std::string_view> kNames = [] {
				std::vector<std::string_view> names;
				for (const Keyword& keyword : kKeywords) {
					names.push_back(keyword.name);
				}
				std::ranges::stable_sort(names, [](std::string_view a, std::string_view b) { return a.size() > b.size(); });
				return names;
			}();
			return kNames;
		}

		// A keyword's name at `at`, standing as a word of its own; its length, or 0.
		size_t keywordAt(std::string_view text, size_t at) {
			if (at > 0 && isWordCharacter(text[at - 1])) {
				return 0;
			}
			for (const std::string_view name : namesLongestFirst()) {
				const size_t length = spelled(text, at, name);
				if (length > 0 && (at + length >= text.size() || !isWordCharacter(text[at + length]))) {
					return length;
				}
			}
			return 0;
		}

		std::string filled(std::string_view text, const CardDefinition& card, bool upgraded) {
			std::string out;
			out.reserve(text.size());
			size_t from = 0;
			for (size_t open = text.find('{'); open != std::string_view::npos; open = text.find('{', from)) {
				const size_t close = text.find('}', open);
				// The card's reader refuses a { with no } and a name that isn't a variable, so neither reaches here.
				const CardVariable& variable = card.variables.at(std::string(text.substr(open + 1, close - open - 1)));
				out.append(text.substr(from, open - from));
				out += std::to_string(upgraded ? variable.upgraded.value_or(variable.base) : variable.base);
				from = close + 1;
			}
			out.append(text.substr(from));
			return out;
		}

	} // namespace

	std::string cardName(const CardDefinition& card, bool upgraded) {
		return upgraded ? card.name + "+" : card.name;
	}

	std::string cardSummary(const CardDefinition& card, bool upgraded) {
		const bool own = upgraded && card.upgrade && card.upgrade->summary;
		return filled(own ? *card.upgrade->summary : card.summary, card, upgraded);
	}

	std::string cardDescription(const CardDefinition& card, bool upgraded) {
		const bool own = upgraded && card.upgrade && card.upgrade->description;
		return filled(own ? *card.upgrade->description : card.description, card, upgraded);
	}

	std::string plainText(std::string_view text) {
		std::string out;
		for (const TextPiece& piece : keywordPieces(text, KeywordMarks::Bracketed)) {
			out += piece.text;
		}
		return out;
	}

	std::span<const Keyword> keywords() {
		return kKeywords;
	}

	const Keyword* findKeyword(std::string_view name) {
		for (const Keyword& keyword : kKeywords) {
			const size_t length = spelled(name, 0, keyword.name);
			if (length > 0 && length == name.size()) {
				return &keyword;
			}
		}
		return nullptr;
	}

	std::vector<TextPiece> keywordPieces(std::string_view text, KeywordMarks marks) {
		std::vector<TextPiece> pieces;
		size_t				   plainFrom = 0;
		const auto			   flush = [&](size_t to) {
			if (to > plainFrom) {
				pieces.push_back({.text = std::string(text.substr(plainFrom, to - plainFrom))});
			}
		};
		for (size_t at = 0; at < text.size();) {
			if (text[at] == '[') {
				const size_t close = text.find(']', at + 1);
				if (close != std::string_view::npos && close > at + 1) {
					flush(at);
					pieces.push_back({.text = std::string(text.substr(at + 1, close - at - 1)), .keyword = true});
					at = close + 1;
					plainFrom = at;
					continue;
				}
			}
			if (marks == KeywordMarks::Anywhere) {
				if (const size_t length = keywordAt(text, at); length > 0) {
					flush(at);
					pieces.push_back({.text = std::string(text.substr(at, length)), .keyword = true});
					at += length;
					plainFrom = at;
					continue;
				}
			}
			++at;
		}
		flush(text.size());
		return pieces;
	}

	std::vector<TextWord> keywordWords(std::string_view text, KeywordMarks marks) {
		std::vector<TextWord> words;
		TextWord			  word;
		for (const TextPiece& piece : keywordPieces(text, marks)) {
			size_t from = 0;
			while (from <= piece.text.size()) {
				const auto space = std::ranges::find_if(piece.text.begin() + static_cast<std::ptrdiff_t>(from), piece.text.end(), isSpace);
				const size_t to = static_cast<size_t>(space - piece.text.begin());
				if (to > from) {
					word.push_back({.text = piece.text.substr(from, to - from), .keyword = piece.keyword});
				}
				if (space == piece.text.end()) {
					break;
				}
				if (!word.empty()) {
					words.push_back(std::move(word));
					word.clear();
				}
				from = to + 1;
			}
		}
		if (!word.empty()) {
			words.push_back(std::move(word));
		}
		return words;
	}

	std::optional<int> cardRange(const CardDefinition& card, bool upgraded) {
		const std::vector<Effect>& effects = upgraded && card.upgrade && card.upgrade->effects ? *card.upgrade->effects : card.effects;
		int						   range = 0;
		for (const Effect& effect : effects) {
			std::visit(
				[&range](const auto& kind) {
					if constexpr (requires { kind.range; }) {
						range = std::max(range, kind.range.value_or(0));
					}
				},
				effect.kind
			);
		}
		return range > 0 ? std::optional(range) : std::nullopt;
	}

	std::vector<const Keyword*> cardKeywords(const CardDefinition& card, bool upgraded) {
		std::vector<const Keyword*> found;
		const auto					add = [&found](std::string_view name) {
			 const Keyword* keyword = findKeyword(name);
			 if (keyword != nullptr && std::ranges::find(found, keyword) == found.end()) {
				 found.push_back(keyword);
			 }
		};
		for (const TextPiece& piece : keywordPieces(cardDescription(card, upgraded), KeywordMarks::Anywhere)) {
			if (piece.keyword) {
				add(piece.text);
			}
		}
		for (const TextPiece& piece : keywordPieces(cardSummary(card, upgraded), KeywordMarks::Bracketed)) {
			if (piece.keyword) {
				add(piece.text);
			}
		}
		if (const std::optional<int> range = cardRange(card, upgraded)) {
			add("Range " + std::to_string(*range));
		}
		return found;
	}

} // namespace rules
