#pragma once

// The battle screen's own colours (Battle Screen Design 7; the mock's :root and the road's lane styles). They're game
// colours, not theme tokens: driver identity owns amber and teal, raiders and attacks red, structure green, armor steel,
// driver HP pink-red, and yellow is keywords, warnings, the centre line and interaction. The card and the vehicle token
// keep their own copies beside their tables (cards/CardStyle.h, road/VehicleToken.cpp); these are the rest of the scene's.

#include "cards/CardStyle.h"

#include <graphics/Color.h>

namespace game::battle::ink {

	using cards::hex;

	// The mock's grounds, darkest first.
	inline constexpr Foundation::Color kGround = hex(0x111214);
	inline constexpr Foundation::Color kAsphalt = hex(0x1A1C1E);
	inline constexpr Foundation::Color kAsphalt2 = hex(0x212427);
	inline constexpr Foundation::Color kPanel = hex(0x26292C);
	inline constexpr Foundation::Color kPanel2 = hex(0x30343A);
	inline constexpr Foundation::Color kLine = hex(0xE9E4D6, 0.1F);
	inline constexpr Foundation::Color kLine2 = hex(0xE9E4D6, 0.2F);

	// Text.
	inline constexpr Foundation::Color kBone = hex(0xE9E4D6);
	inline constexpr Foundation::Color kMuted = hex(0xA39E92);
	inline constexpr Foundation::Color kDim = hex(0x6F6B63);

	// Who's who.
	inline constexpr Foundation::Color kDriver1 = hex(0xF2A33A);
	inline constexpr Foundation::Color kDriver1Deep = hex(0x6B4414);
	inline constexpr Foundation::Color kDriver2 = hex(0x3CC3C9);
	inline constexpr Foundation::Color kDriver2Deep = hex(0x134F54);
	inline constexpr Foundation::Color kEscort = hex(0xC9C3B4);
	inline constexpr Foundation::Color kRaider = hex(0xD4513F);
	inline constexpr Foundation::Color kRaiderDeep = hex(0x5A1F18);
	inline constexpr Foundation::Color kStructure = hex(0x8FBF5C);
	inline constexpr Foundation::Color kArmor = hex(0xA9BCCD);
	inline constexpr Foundation::Color kHp = hex(0xE7727A);
	inline constexpr Foundation::Color kWarn = hex(0xEFD25A);

	// The bands' grounds (the mock's .g-top, .g-dock, .dtab), and the scrim over a dock dropped for the enemy turn.
	inline constexpr Foundation::Color kTopBar = hex(0x0E0F10);
	inline constexpr Foundation::Color kDockTop = hex(0x131416);
	inline constexpr Foundation::Color kDockFoot = hex(0x0C0D0E);
	inline constexpr Foundation::Color kDriverTab = hex(0x17191B);
	inline constexpr Foundation::Color kDockScrim = hex(0x2A2C2F, 0.6F);

	// A hit's number (.dmgpop) and a miss's.
	inline constexpr Foundation::Color kDamageNumber = hex(0xFF8A78);
	inline constexpr Foundation::Color kMissNumber = kBone;

	// The turn banners: the player's a neutral dark band, since red is the raiders'.
	inline constexpr Foundation::Color kBannerPlayer = hex(0x202326, 0.92F);
	inline constexpr Foundation::Color kBannerRaiders = hex(0x5A1F18, 0.92F);

	// The road (.lane, .lane-line, .slot, .col-head, .headstrip, .rowlab): red tints are the raiders', bone yours, and the
	// yellow centre line is where the two inside lanes meet at range 1.
	inline constexpr Foundation::Color kShoulderGround = hex(0x1A1B1C);
	inline constexpr Foundation::Color kShoulderStripe = hex(0x1D1E20);
	inline constexpr Foundation::Color kRaiderLaneTint = hex(0xD4513F, 0.05F);
	inline constexpr Foundation::Color kPlayerShoulderTint = hex(0xE9E4D6, 0.025F);
	inline constexpr Foundation::Color kHeader = hex(0x0A0B0C, 0.7F);
	inline constexpr Foundation::Color kHeaderRule = hex(0xE9E4D6, 0.1F);
	inline constexpr Foundation::Color kEdgeLine = hex(0xE9E4D6, 0.22F);
	inline constexpr Foundation::Color kLaneDash = hex(0xE9E4D6, 0.16F);
	inline constexpr Foundation::Color kCentreLine = hex(0xEFD25A, 0.35F);
	inline constexpr Foundation::Color kSlotOutline = hex(0xE9E4D6, 0.06F);
	inline constexpr Foundation::Color kRaiderSlotOutline = hex(0xD4513F, 0.09F);
	inline constexpr Foundation::Color kHeaderLabel = hex(0x8B8373);
	inline constexpr Foundation::Color kRaiderHeaderLabel = hex(0xB0685C);
	// A row a due wave will pull into (section 9): the gutter's label in the raiders' red.
	inline constexpr Foundation::Color kArrivalRow = hex(0xD4513F);

} // namespace game::battle::ink
