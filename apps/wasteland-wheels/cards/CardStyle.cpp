#include "cards/CardStyle.h"

#include "Words.h"

#include <algorithm>

namespace game::cards {

	Foundation::Color dimmed(Foundation::Color color) {
		return {color.r * kDimBrightness, color.g * kDimBrightness, color.b * kDimBrightness, color.a};
	}

	Foundation::Color dimmedText(Foundation::Color color) {
		const float grey = 0.2126F * color.r + 0.7152F * color.g + 0.0722F * color.b;
		const auto	channel = [grey](float value) {
			 return std::min(1.0F, (grey + (value - grey) * 0.3F) * kDimBrightness);
		};
		return {channel(color.r), channel(color.g), channel(color.b), color.a};
	}

	Foundation::Color gemColor(rules::Rarity rarity) {
		switch (rarity) {
			case rules::Rarity::Starter:
				return hex(0x6F6B63);
			case rules::Rarity::Common:
				return hex(0x9B978C);
			case rules::Rarity::Uncommon:
				return hex(0x6FB3E0);
			case rules::Rarity::Rare:
				return hex(0xE0C14F);
			case rules::Rarity::Legendary:
				return hex(0xD06AD8);
			case rules::Rarity::Signature:
				return hex(0xC98A5A);
		}
		return kDim;
	}

	std::string_view rarityName(rules::Rarity rarity) {
		return nameOf(rules::kRarityNames, rarity);
	}

	Foundation::Color frameColor(std::optional<int> seat) {
		return seat ? kDriverColors.at(static_cast<size_t>(*seat)) : kLine;
	}

	std::array<Foundation::Color, 2> artGround(std::optional<int> seat) {
		if (!seat) {
			return {hex(0x3B3A35), hex(0x24262A)};
		}
		return *seat == 0 ? std::array{hex(0x4A3B27), hex(0x26241F)} : std::array{hex(0x243E41), hex(0x1E2426)};
	}

	std::string_view typeLabel(const rules::CardDefinition& card) {
		if (card.hasTag("synergy")) {
			return "SYN";
		}
		const std::string_view first = card.tags.empty() ? std::string_view() : std::string_view(card.tags.front());
		if (first == "attack") {
			return "ATK";
		}
		if (first == "defense") {
			return "DEF";
		}
		if (first == "power") {
			return "PWR";
		}
		if (first == "order") {
			return "ORD";
		}
		return "UTL";
	}

	ArtGlyph artGlyph(const rules::CardDefinition& card) {
		if (card.hasTag("shield") || card.hasTag("defense") || card.hasTag("armor")) {
			return ArtGlyph::Shield;
		}
		if (card.hasTag("positioning")) {
			return ArtGlyph::Chevrons;
		}
		if (card.hasTag("order")) {
			return ArtGlyph::Square;
		}
		if (!card.tags.empty() && (card.tags.front() == "attack" || card.tags.front() == "power")) {
			return ArtGlyph::Crosshair;
		}
		return ArtGlyph::Ring;
	}

	std::array<Foundation::Vec2, 6> hexPoints(Foundation::Vec2 topLeft, float side) {
		const float unit = side / 30.0F;
		const auto	at = [&](float x, float y) {
			 return Foundation::Vec2{topLeft.x + x * unit, topLeft.y + y * unit};
		};
		return {at(15.0F, 1.5F), at(27.5F, 8.5F), at(27.5F, 21.5F), at(15.0F, 28.5F), at(2.5F, 21.5F), at(2.5F, 8.5F)};
	}

} // namespace game::cards
