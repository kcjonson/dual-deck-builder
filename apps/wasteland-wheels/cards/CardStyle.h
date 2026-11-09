#pragma once

// The card's look (Battle Screen Design 5 to 8, Game Flow 7.0): its own dark stock whatever the scene's theme, since a
// card is the same object on the road and on the atlas, so its colours are constants rather than tokens. Driver colour is
// the frame, rarity only ever the gem. Every box is in the card's own px from its outer edge.

#include <graphics/Color.h>
#include <math/Types.h>
#include <primitives/FontFamily.h>

#include <rules/core/Card.h>

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace game::cards {

	[[nodiscard]] constexpr Foundation::Color hex(uint32_t rgb, float alpha = 1.0F) {
		return {
			static_cast<float>((rgb >> 16U) & 0xFFU) / 255.0F,
			static_cast<float>((rgb >> 8U) & 0xFFU) / 255.0F,
			static_cast<float>(rgb & 0xFFU) / 255.0F,
			alpha,
		};
	}

	inline constexpr Foundation::Color kGround = hex(0x1D2023);
	inline constexpr Foundation::Color kLine = hex(0xE9E4D6, 0.2F);
	inline constexpr Foundation::Color kLineFaint = hex(0xE9E4D6, 0.1F);
	inline constexpr Foundation::Color kName = hex(0xE9E4D6);
	inline constexpr Foundation::Color kRules = hex(0xDCD7CA);
	inline constexpr Foundation::Color kDetailRules = hex(0xE2DDD0);
	inline constexpr Foundation::Color kMuted = hex(0xA39E92);
	inline constexpr Foundation::Color kDim = hex(0x6F6B63);
	inline constexpr Foundation::Color kKeyword = hex(0xEFD25A);
	inline constexpr Foundation::Color kHexBone = hex(0xE9E4D6);
	inline constexpr Foundation::Color kHexEdge = hex(0x0E0F10);
	inline constexpr Foundation::Color kDigits = hex(0x111214);
	// "Unaffordable cards dim and their cost turns dark red" (Battle Screen Design 6).
	inline constexpr Foundation::Color kDigitsUnpayable = hex(0x8D1D12);
	// The strip across a card that can't be played for a reason other than its cost (the mock's .pblock).
	inline constexpr Foundation::Color kBlockedText = hex(0xFFD0C8);
	inline constexpr Foundation::Color kBlockedBand = hex(0x5A1F18, 0.95F);
	inline constexpr Foundation::Color kArtGlyph = hex(0xE9E4D6, 0.22F);
	// Hover and keyboard focus outline a card in the interaction yellow (Battle Screen Design 7); a selected one is brighter.
	inline constexpr Foundation::Color kHover = hex(0xEFD25A);
	inline constexpr Foundation::Color kShadow = hex(0x000000, 0.8F);

	// Driver 1 amber with a triangle, driver 2 teal with a diamond (Battle Screen Design 7).
	inline constexpr std::array<Foundation::Color, 2> kDriverColors{hex(0xF2A33A), hex(0x3CC3C9)};

	// The brightness a dimmed card's own draws take; its words take dimmedText's.
	inline constexpr float kDimBrightness = 0.62F;

	[[nodiscard]] Foundation::Color dimmed(Foundation::Color color);
	// The mock's `.cant`, saturate(0.3) brightness(0.62), for a card its driver can't play or a faded mini.
	[[nodiscard]] Foundation::Color dimmedText(Foundation::Color color);

	[[nodiscard]] Foundation::Color gemColor(rules::Rarity rarity);
	[[nodiscard]] std::string_view	rarityName(rules::Rarity rarity);

	// The frame: the seat's colour, or the neutral line for a card nobody holds.
	[[nodiscard]] Foundation::Color frameColor(std::optional<int> seat);

	// The art strip's ground, top and bottom: warm for driver 1, cool for driver 2, neutral otherwise.
	[[nodiscard]] std::array<Foundation::Color, 2> artGround(std::optional<int> seat);

	// What kind of card it is, as the corner says it: ATK, DEF, UTL, PWR, ORD, or SYN.
	[[nodiscard]] std::string_view typeLabel(const rules::CardDefinition& card);

	// The placeholder drawn in the art until cards have art of their own.
	enum class ArtGlyph : uint8_t { Crosshair, Shield, Chevrons, Square, Ring };
	[[nodiscard]] ArtGlyph artGlyph(const rules::CardDefinition& card);

	// A pointy-top hexagon in a `side` px box at `topLeft`, the mock's #i-hex.
	[[nodiscard]] std::array<Foundation::Vec2, 6> hexPoints(Foundation::Vec2 topLeft, float side);

	// The face, 128 by 180 (Battle Screen Design 4 and 5).
	namespace face {
		inline constexpr Foundation::Vec2 kSize{128.0F, 180.0F};
		inline constexpr float			  kRadius = 6.0F;
		inline constexpr float			  kBorder = 2.0F;
		// The cost hex hangs off the top-left corner.
		inline constexpr Foundation::Vec2 kHexAt{-7.0F, -7.0F};
		inline constexpr float			  kHexSide = 30.0F;
		inline constexpr float			  kHexDigits = 19.0F;
		inline constexpr Foundation::Vec2 kMarkCentre{116.0F, 12.0F};
		inline constexpr float			  kMarkSize = 12.0F;
		inline constexpr float			  kTypeRight = 106.0F;
		inline constexpr float			  kTypeY = 6.0F;
		inline constexpr float			  kTypeSize = 11.0F;
		inline constexpr Foundation::Vec2 kNameAt{8.0F, 23.0F};
		inline constexpr float			  kNameWidth = 112.0F;
		inline constexpr float			  kNameSize = 16.0F;
		inline constexpr float			  kNameShrunk = 14.0F;
		inline constexpr float			  kArtX = 6.0F;
		inline constexpr float			  kArtY = 45.0F;
		inline constexpr float			  kArtWidth = 116.0F;
		inline constexpr float			  kArtHeight = 52.0F;
		inline constexpr float			  kArtRadius = 3.0F;
		// Three lines of 12 over 17 in 114 (Battle Screen Design 5's short text).
		inline constexpr Foundation::Vec2 kRulesAt{7.0F, 101.0F};
		inline constexpr float			  kRulesWidth = 114.0F;
		inline constexpr float			  kRulesSize = 12.0F;
		inline constexpr float			  kRulesLine = 17.0F;
		inline constexpr int			  kRulesLines = 3;
		inline constexpr float			  kFootX = 8.0F;
		inline constexpr float			  kFootRight = 120.0F;
		inline constexpr float			  kFootY = 158.0F;
		inline constexpr float			  kFootHeight = 16.0F;
		inline constexpr float			  kGem = 8.0F;
		inline constexpr float			  kFootSize = 11.0F;
		// How far it draws past its box: the hex and its edge, and the focus ring.
		inline constexpr float kInk = 9.0F;
		// The blocked strip, over the art: 6 in from each side, 64 down, its words from the left (call 367).
		inline constexpr float kBlockedInset = 6.0F;
		inline constexpr float kBlockedY = 64.0F;
		inline constexpr float kBlockedHeight = 16.0F;
		inline constexpr float kBlockedSize = 11.0F;
		inline constexpr float kBlockedPad = 5.0F;
	} // namespace face

	// The mini card, 80 by 112 (Game Flow 7.0, mini-card.md): the face less the summary.
	namespace mini {
		inline constexpr Foundation::Vec2 kSize{80.0F, 112.0F};
		inline constexpr float			  kRadius = 5.0F;
		inline constexpr float			  kBorder = 2.0F;
		inline constexpr Foundation::Vec2 kHexAt{-5.0F, -5.0F};
		inline constexpr float			  kHexSide = 22.0F;
		inline constexpr float			  kHexDigits = 14.0F;
		// Two lines of 13 in 56, which every card's name fits whole.
		inline constexpr Foundation::Vec2 kNameAt{20.0F, 5.0F};
		inline constexpr float			  kNameWidth = 56.0F;
		inline constexpr float			  kNameSize = 13.0F;
		inline constexpr float			  kNameLine = 13.5F;
		inline constexpr int			  kNameLines = 2;
		inline constexpr float			  kArtX = 6.0F;
		inline constexpr float			  kArtY = 35.0F;
		inline constexpr float			  kArtWidth = 68.0F;
		inline constexpr float			  kArtHeight = 48.0F;
		inline constexpr Foundation::Vec2 kTypeAt{7.0F, 89.0F};
		inline constexpr float			  kTypeSize = 10.0F;
		inline constexpr Foundation::Vec2 kGemCentre{70.0F, 95.0F};
		inline constexpr float			  kGem = 7.0F;
		// Copies past the first show as edges behind it, a step down and right each, two at most.
		inline constexpr float kStackStep = 3.0F;
		inline constexpr int   kStackEdges = 2;
		inline constexpr float kEdgeBrightness = 0.7F;
		// The "x5" pill across the bottom edge, flush with the stack's last edge.
		inline constexpr float kCountHeight = 14.0F;
		inline constexpr float kCountSize = 11.0F;
		inline constexpr float kCountPad = 5.0F;
		// A state's tag straddles the top edge and hangs past the right one.
		inline constexpr float kTagRight = 84.0F;
		inline constexpr float kTagHeight = 14.0F;
		inline constexpr float kTagSize = 9.0F;
		inline constexpr float kTagPad = 4.0F;
		// A borrowed copy's frame, in dashes.
		inline constexpr float kDash = 5.0F;
		inline constexpr float kDashGap = 3.0F;
		// How far past its box a mini draws, on any side: the hex up and left, a tag up and right, the stack and its count
		// down and right. Grids of minis sit twice this apart (kGridGap) so no card's ink runs into its neighbour's.
		inline constexpr float kInk = 7.0F;
		inline constexpr float kGridGap = kInk * 2.0F + 2.0F;
	} // namespace mini

	// The detail view, 250 wide and up to 440 tall, the art giving way first (Battle Screen Design 5).
	namespace detail {
		inline constexpr float kWidth = 250.0F;
		inline constexpr float kMaxHeight = 440.0F;
		inline constexpr float kRadius = 8.0F;
		inline constexpr float kBorder = 2.0F;
		inline constexpr float kPadTop = 14.0F;
		inline constexpr float kPadSide = 14.0F;
		inline constexpr float kPadBottom = 12.0F;
		inline constexpr float kGap = 8.0F;
		inline constexpr float kHexSide = 34.0F;
		inline constexpr float kHexDigits = 21.0F;
		inline constexpr float kNameSize = 22.0F;
		inline constexpr float kNameLine = 23.0F;
		inline constexpr int   kNameLines = 2;
		inline constexpr float kTypeSize = 12.0F;
		inline constexpr float kArtHeight = 64.0F;
		inline constexpr float kArtMin = 20.0F;
		inline constexpr float kRulesSize = 15.0F;
		inline constexpr float kRulesLine = 21.0F;
		inline constexpr float kFootHeight = 12.0F;
		inline constexpr float kFootSize = 11.0F;
		inline constexpr float kGem = 9.0F;
		// The keyword boxes beside it.
		inline constexpr float kKeywordWidth = 230.0F;
		inline constexpr float kKeywordGap = 6.0F;
		inline constexpr float kKeywordOffset = 10.0F;
		inline constexpr int   kKeywordMax = 3;
	} // namespace detail

	// The card back (UI Art Direction, Card hints): atlas stock at 5:7 with 7 px corners, from the canvas's cardBackA at
	// 100 by 140; everything scales with the width.
	namespace back {
		inline constexpr float kWidth = 100.0F;
		inline constexpr float kHeight = 140.0F;
		inline constexpr float kRadius = 7.0F;
		inline constexpr float kEdge = 1.2F;
		inline constexpr float kBandInset = 5.0F;
		inline constexpr float kBandRadius = 4.0F;
		inline constexpr float kBandStroke = 2.5F;
		inline constexpr float kInnerInset = 11.0F;
		inline constexpr float kInnerRadius = 2.0F;
		inline constexpr float kRuleInset = 14.0F;
		inline constexpr float kRuleStroke = 0.8F;
		// The small mark, centred, this tall.
		inline constexpr float kMarkHeight = 56.0F;
	} // namespace back

} // namespace game::cards
