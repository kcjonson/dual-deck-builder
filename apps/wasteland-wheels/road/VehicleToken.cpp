#include "road/VehicleToken.h"

#include "Fonts.h"
#include "atlas/Markers.h"
#include "cards/CardInk.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>

#include <nlohmann/json.hpp>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <numbers>
#include <utility>

namespace game::road {

	namespace {

		using cards::hex;

		// The layout at scale 1, from the battle screen mock's tokenHTML.
		constexpr float			   kIntentStrip = 24.0F;
		constexpr float			   kIntentHeight = 22.0F;
		constexpr Foundation::Rect kSprite{0.0F, 30.0F, 60.0F, 40.0F};
		constexpr float			   kSpeedY = 72.0F;
		constexpr float			   kSpeedIcon = 12.0F;
		constexpr float			   kPlateX = 64.0F;
		constexpr float			   kPlateY = 26.0F;
		constexpr float			   kPlateWidth = VehicleToken::kWidth - kPlateX;
		constexpr float			   kPlateHeight = 68.0F;
		constexpr float			   kPassengerRow = 18.0F;
		constexpr float			   kPadY = 5.0F;
		constexpr float			   kPadRight = 6.0F;
		constexpr float			   kPadLeft = 6.0F;
		constexpr float			   kPadLeftStriped = 9.0F;
		constexpr float			   kStripe = 3.0F;
		constexpr float			   kRowGap = 4.0F;
		constexpr float			   kNameRow = 16.0F;
		constexpr float			   kMarkSize = 12.0F;
		constexpr float			   kStructureRow = 18.0F;
		constexpr float			   kStructureBar = 16.0F;
		constexpr float			   kHpRow = 16.0F;
		constexpr float			   kHpBar = 14.0F;
		constexpr float			   kPassengerBar = 12.0F;
		constexpr float			   kLead = 26.0F;
		constexpr float			   kLeadGap = 4.0F;
		constexpr float			   kChipGap = 3.0F;
		constexpr float			   kChip = 20.0F;
		constexpr float			   kStatusGap = 3.0F;
		constexpr float			   kNameSize = 15.0F;
		constexpr float			   kValueSize = 12.0F;
		constexpr float			   kChipSize = 9.0F;
		constexpr float			   kStampSize = 18.0F;
		constexpr float			   kStampCentreX = 130.0F;
		constexpr float			   kStampTop = 44.0F;
		constexpr float			   kStampTilt = -8.0F * std::numbers::pi_v<float> / 180.0F;

		constexpr Foundation::Color kPlate = hex(0x0F1011);
		constexpr Foundation::Color kPlateEdge = hex(0xE9E4D6, 0.22F);
		constexpr Foundation::Color kTrack = hex(0x26292B);
		constexpr Foundation::Color kStructure = hex(0x8FBF5C);
		constexpr Foundation::Color kArmor = hex(0xA9BCCD);
		constexpr Foundation::Color kHeavyArmor = hex(0xD9B26A);
		constexpr Foundation::Color kHp = hex(0xE7727A);
		constexpr Foundation::Color kPassenger = hex(0xC9656C);
		constexpr Foundation::Color kBone = hex(0xE9E4D6);
		constexpr Foundation::Color kSpeedText = hex(0x8B8373);
		constexpr Foundation::Color kRaiderRed = hex(0xFF6A55);
		constexpr Foundation::Color kIntentGround = hex(0x1A1314);
		constexpr Foundation::Color kEscortBone = hex(0xC9C3B4);
		constexpr Foundation::Color kWreckGrey = hex(0x4A4B4C);
		constexpr Foundation::Color kWreckDim = hex(0x5C5D5E);
		constexpr Foundation::Color kWreckText = hex(0x8A8B8C);
		constexpr Foundation::Color kStamp = hex(0xFF8A78);

		Foundation::Color spriteTint(const TokenData& data) {
			if (data.side == TokenSide::Raider) {
				return hex(0x8A5A50);
			}
			if (data.side == TokenSide::Escort || !data.seat) {
				return hex(0x77736A);
			}
			return *data.seat == 0 ? hex(0x8A7B63) : hex(0x5F7F82);
		}

		std::string meterText(const Meter& meter) {
			return std::to_string(meter.value) + "/" + std::to_string(meter.max);
		}

		void drawBar(const Foundation::Rect& bar, const Meter& meter, Foundation::Color fill, int32_t key) {
			Renderer::Primitives::drawRect({.bounds = bar, .style = {.fill = kTrack}, .key = key});
			const float share =
				meter.max > 0 ? std::clamp(static_cast<float>(meter.value) / static_cast<float>(meter.max), 0.0F, 1.0F) : 0.0F;
			if (share > 0.0F) {
				Renderer::Primitives::drawRect(
					{.bounds = {bar.x, bar.y, bar.width * share, bar.height}, .style = {.fill = fill}, .key = key}
				);
			}
			cards::drawWords({
				.text = meterText(meter),
				.at = {bar.x, bar.y},
				.face = fonts::kMono,
				.size = std::min(kValueSize, bar.height - 2.0F),
				.color = kBone,
				.align = Foundation::HorizontalAlign::Right,
				.boxWidth = bar.width - 3.0F,
				.boxHeight = bar.height,
				.key = key,
			});
		}

		void drawHeart(Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key) {
			constexpr int						 kSteps = 24;
			std::array<Foundation::Vec2, kSteps> points{};
			const float							 unit = size / 34.0F;
			for (int step = 0; step < kSteps; ++step) {
				const float turn = 2.0F * std::numbers::pi_v<float> * static_cast<float>(step) / kSteps;
				const float x = 16.0F * std::pow(std::sin(turn), 3.0F);
				const float y =
					13.0F * std::cos(turn) - 5.0F * std::cos(2.0F * turn) - 2.0F * std::cos(3.0F * turn) - std::cos(4.0F * turn);
				points.at(static_cast<size_t>(step)) = {centre.x + x * unit, centre.y - y * unit};
			}
			Renderer::Primitives::drawPolygon({.vertices = points, .style = {.fill = color}, .key = key});
		}

		void drawMark(TargetMark mark, Foundation::Vec2 centre, float size, Foundation::Color color, int32_t key) {
			switch (mark) {
				case TargetMark::Triangle:
					cards::drawSeatMark(0, centre, size, color, key);
					break;
				case TargetMark::Diamond:
					cards::drawSeatMark(1, centre, size, color, key);
					break;
				case TargetMark::Both:
					cards::drawSeatMark(0, {centre.x - size * 0.3F, centre.y}, size * 0.8F, color, key);
					cards::drawSeatMark(1, {centre.x + size * 0.3F, centre.y}, size * 0.8F, color, key);
					break;
				case TargetMark::Square:
					Renderer::Primitives::drawRect(
						{.bounds = {centre.x - size * 0.4F, centre.y - size * 0.4F, size * 0.8F, size * 0.8F},
						 .style = {.fill = color},
						 .key = key}
					);
					break;
			}
		}

		float chipWidth(const std::string& label) {
			return std::max(kChip, cards::wordsWidth(label, fonts::kMono, kChipSize) + 6.0F);
		}

	} // namespace

	VehicleToken::VehicleToken(const Args& args)
		: token(args.data),
		  tokenScale(args.scale) {}

	float VehicleToken::heightFor(const TokenData& data) {
		return data.passenger && data.side != TokenSide::Escort ? kPassengerHeight : kHeight;
	}

	float VehicleToken::slotScale(Foundation::Vec2 slot, float tokenHeight) {
		return std::min((slot.x - 6.0F) / kWidth, (slot.y - 4.0F) / tokenHeight);
	}

	float VehicleToken::fitScale(Foundation::Vec2 slot, float tokenHeight, float cap) {
		return std::clamp(slotScale(slot, tokenHeight), 1.0F, std::clamp(cap, 1.0F, kMaxScale));
	}

	void VehicleToken::setData(TokenData data) {
		const bool resized = heightFor(data) != heightFor(token);
		token = std::move(data);
		if (resized) {
			contentChanged();
		}
	}

	void VehicleToken::setScale(float scale) {
		if (scale != tokenScale) {
			tokenScale = scale;
			contentChanged();
		}
	}

	std::vector<std::string> VehicleToken::shownChips() const {
		std::vector<std::string> all;
		if (token.spent) {
			all.emplace_back("SPENT");
		}
		all.insert(all.end(), token.statuses.begin(), token.statuses.end());
		if (static_cast<int>(all.size()) <= kMaxChips) {
			return all;
		}
		std::vector<std::string> shown(all.begin(), all.begin() + (kMaxChips - 1));
		shown.push_back("+" + std::to_string(all.size() - shown.size()));
		return shown;
	}

	std::vector<std::string> VehicleToken::shownIntents() const {
		std::vector<std::string> shown;
		for (size_t index = 0; index < token.intents.size() && index < static_cast<size_t>(kMaxIntents); ++index) {
			shown.push_back(token.intents[index].value);
		}
		if (token.intents.size() > static_cast<size_t>(kMaxIntents)) {
			shown.push_back("+" + std::to_string(token.intents.size() - kMaxIntents));
		}
		return shown;
	}

	void VehicleToken::describe(nlohmann::json& node) const {
		node["name"] = token.name;
		node["structure"] = meterText(token.structure);
		node["armor"] = token.armor;
		if (token.driver) {
			node["driver"] = meterText(*token.driver);
		}
		if (token.passenger) {
			node["passenger"] = meterText(*token.passenger);
		}
		node["chips"] = shownChips();
		node["intents"] = shownIntents();
		node["scale"] = tokenScale;
		if (token.wreck != Wreck::None) {
			node["wreck"] = token.wreck == Wreck::Wrecked ? "wrecked" : "no_driver";
		}
	}

	std::optional<Foundation::Vec2> VehicleToken::intrinsicSize(std::optional<float> /*width*/, float /*availableWidth*/) const {
		return Foundation::Vec2{kWidth * tokenScale, heightFor(token) * tokenScale};
	}

	void VehicleToken::render() {
		const int32_t key = drawKey();
		const bool	  wrecked = token.wreck != Wreck::None;
		Renderer::Primitives::PushTransform(glm::scale(glm::mat4(1.0F), glm::vec3(tokenScale, tokenScale, 1.0F)));
		renderIntents(key, wrecked);
		renderSprite(key, wrecked);
		renderPlate(key, wrecked);
		renderChips(key, wrecked);
		if (wrecked) {
			renderStamp(key);
		}
		Renderer::Primitives::PopTransform();
	}

	void VehicleToken::renderIntents(int32_t key, bool wrecked) {
		if (token.side != TokenSide::Raider || wrecked) {
			return;
		}
		float						   right = kWidth;
		const std::vector<std::string> shown = shownIntents();
		for (size_t index = shown.size(); index-- > 0;) {
			const bool			   more = index >= static_cast<size_t>(kMaxIntents);
			const float			   text = cards::wordsWidth(shown[index], fonts::kDisplayBold, 15.0F);
			const float			   width = 6.0F + text + (more ? 0.0F : 4.0F + 10.0F) + 6.0F;
			const Foundation::Rect pill{right - width, (kIntentStrip - kIntentHeight) * 0.5F, width, kIntentHeight};
			cards::drawRounded(pill, kIntentHeight * 0.5F, kIntentGround, kRaiderRed, 1.5F, key);
			cards::drawWords({
				.text = shown[index],
				.at = {pill.x + 6.0F, pill.y},
				.face = fonts::kDisplayBold,
				.size = 15.0F,
				.color = kBone,
				.boxHeight = pill.height,
				.key = key,
			});
			if (!more) {
				drawMark(
					token.intents[index].mark, {pill.x + 6.0F + text + 4.0F + 5.0F, pill.y + pill.height * 0.5F}, 10.0F, kRaiderRed, key
				);
			}
			right = pill.x - 4.0F;
		}
	}

	void VehicleToken::renderSprite(int32_t key, bool wrecked) {
		const Foundation::Color body = wrecked ? kWreckGrey : spriteTint(token);
		const Foundation::Color dark = hex(0x111214);
		// A rear view facing up the road: the wheels, the body over them, and its back window.
		for (const float x : {kSprite.x + 6.0F, kSprite.x + kSprite.width - 16.0F}) {
			cards::drawRounded({x, kSprite.y + 22.0F, 10.0F, 16.0F}, 2.0F, dark, std::nullopt, 0.0F, key);
		}
		cards::drawRounded({kSprite.x + 9.0F, kSprite.y + 4.0F, kSprite.width - 18.0F, 30.0F}, 5.0F, body, std::nullopt, 0.0F, key);
		cards::drawRounded(
			{kSprite.x + 15.0F, kSprite.y + 8.0F, kSprite.width - 30.0F, 9.0F}, 2.0F, hex(0x1D2023), std::nullopt, 0.0F, key
		);

		const std::string		speed = std::to_string(token.speed);
		const float				total = kSpeedIcon + 1.0F + cards::wordsWidth(speed, fonts::kMono, kValueSize);
		const float				left = kSprite.x + (kSprite.width - total) * 0.5F;
		const Foundation::Color ink = wrecked ? kWreckText : kSpeedText;
		for (const float lift : {0.0F, 4.5F}) {
			const std::array<Foundation::Vec2, 3> chevron{{
				{left + 2.0F, kSpeedY + 7.0F + lift},
				{left + kSpeedIcon * 0.5F, kSpeedY + 3.0F + lift},
				{left + kSpeedIcon - 2.0F, kSpeedY + 7.0F + lift},
			}};
			Renderer::Primitives::drawPolyline({.points = chevron, .width = 1.6F, .color = ink, .key = key});
		}
		cards::drawWords({
			.text = speed,
			.at = {left + kSpeedIcon + 1.0F, kSpeedY},
			.face = fonts::kMono,
			.size = kValueSize,
			.color = ink,
			.boxHeight = 16.0F,
			.key = key,
		});
	}

	void VehicleToken::renderPlate(int32_t key, bool wrecked) {
		const bool	escort = token.side == TokenSide::Escort;
		const bool	striped = token.side == TokenSide::Player && token.seat.has_value();
		const float height = kPlateHeight + (token.passenger && !escort ? kPassengerRow : 0.0F);
		const float left = kPlateX + (striped ? kPadLeftStriped : kPadLeft);
		const float right = kPlateX + kPlateWidth - kPadRight;
		cards::drawRounded({kPlateX, kPlateY, kPlateWidth, height}, 3.0F, kPlate, kPlateEdge, 1.0F, key);
		if (striped) {
			Renderer::Primitives::drawRect({
				.bounds = {kPlateX, kPlateY, kStripe, height},
				.style = {.fill = wrecked ? kWreckDim : cards::kDriverColors.at(static_cast<size_t>(*token.seat))},
				.key = key,
			});
		}

		float					  y = kPlateY + kPadY;
		std::optional<TargetMark> mark;
		if (escort) {
			mark = TargetMark::Square;
		} else if (striped) {
			mark = *token.seat == 0 ? TargetMark::Triangle : TargetMark::Diamond;
		}
		const float nameRoom = right - left - (mark ? kMarkSize + 5.0F : 0.0F);
		cards::drawWords({
			.text = cards::fittedLine(token.name, fonts::kDisplayBold, kNameSize, nameRoom),
			.at = {left, y},
			.face = fonts::kDisplayBold,
			.size = kNameSize,
			.color = wrecked ? kWreckText : kBone,
			.boxHeight = kNameRow,
			.key = key,
		});
		if (mark) {
			const Foundation::Color color =
				wrecked ? kWreckDim : (escort ? kEscortBone : cards::kDriverColors.at(static_cast<size_t>(*token.seat)));
			drawMark(*mark, {right - kMarkSize * 0.5F, y + kNameRow * 0.5F}, kMarkSize, color, key);
		}
		y += kNameRow + kRowGap;

		// The armor shield with its value, beside the structure bar.
		const float shieldHeight = kStructureRow;
		atlas::drawShield({
			.topLeft = {left + (kLead - shieldHeight * atlas::kShieldAspect) * 0.5F, y},
			.height = shieldHeight,
			.fill = wrecked ? kWreckDim : (token.heavy ? kHeavyArmor : kArmor),
			.key = key,
		});
		cards::drawWords({
			.text = std::to_string(token.armor),
			.at = {left, y},
			.face = fonts::kDisplayBold,
			.size = 12.0F,
			.color = hex(0x111214),
			.align = Foundation::HorizontalAlign::Center,
			.boxWidth = kLead,
			.boxHeight = shieldHeight - 2.0F,
			.key = key,
		});
		const float barX = left + kLead + kLeadGap;
		drawBar(
			{barX, y + (kStructureRow - kStructureBar) * 0.5F, right - barX, kStructureBar},
			token.structure,
			wrecked ? kWreckDim : kStructure,
			key
		);
		y += kStructureRow + kRowGap;

		// The driver's HP; on an escort, its passenger's, when it carries one.
		const std::optional<Meter> hp = escort ? token.passenger : token.driver;
		if (hp) {
			const Foundation::Color fill = wrecked ? kWreckDim : (escort ? kPassenger : kHp);
			drawHeart({left + kLead * 0.5F, y + kHpRow * 0.5F}, escort ? 10.0F : 14.0F, fill, key);
			drawBar({barX, y + (kHpRow - kHpBar) * 0.5F, right - barX, kHpBar}, *hp, fill, key);
		}
		y += kHpRow + kRowGap;
		if (token.passenger && !escort) {
			const Foundation::Color fill = wrecked ? kWreckDim : kPassenger;
			drawHeart({left + kLead * 0.5F, y + 7.0F}, 10.0F, fill, key);
			drawBar({barX, y + 1.0F, right - barX, kPassengerBar}, *token.passenger, fill, key);
		}
	}

	void VehicleToken::renderChips(int32_t key, bool wrecked) {
		const float top = kPlateY + kPlateHeight + (token.passenger && token.side != TokenSide::Escort ? kPassengerRow : 0.0F) + kStatusGap;
		float		x = kPlateX;
		for (const std::string& label : shownChips()) {
			const float width = chipWidth(label);
			cards::drawRounded({x, top, width, kChip}, 3.0F, kPlate, wrecked ? kWreckDim : kPlateEdge, 1.0F, key);
			cards::drawWords({
				.text = label,
				.at = {x, top},
				.face = fonts::kMono,
				.size = kChipSize,
				.color = wrecked ? kWreckText : kBone,
				.align = Foundation::HorizontalAlign::Center,
				.boxWidth = width,
				.boxHeight = kChip,
				.key = key,
			});
			x += width + kChipGap;
		}
	}

	void VehicleToken::renderStamp(int32_t key) {
		const std::string text = token.wreck == Wreck::Wrecked ? "WRECKED" : "NO DRIVER";
		const float		  width = cards::wordsWidth(text, fonts::kDisplayBold, kStampSize, 1.0F) + 12.0F;
		const float		  height = kStampSize + 4.0F;
		glm::mat4		  place = glm::translate(glm::mat4(1.0F), glm::vec3(kStampCentreX, kStampTop + height * 0.5F, 0.0F));
		place = glm::rotate(place, kStampTilt, glm::vec3(0.0F, 0.0F, 1.0F));
		Renderer::Primitives::PushTransform(place);
		const Foundation::Rect box{-width * 0.5F, -height * 0.5F, width, height};
		cards::drawRounded(box, 2.0F, kPlate, kStamp, 2.0F, key);
		cards::drawWords({
			.text = text,
			.at = {box.x, box.y},
			.face = fonts::kDisplayBold,
			.size = kStampSize,
			.color = kStamp,
			.align = Foundation::HorizontalAlign::Center,
			.boxWidth = box.width,
			.boxHeight = box.height,
			.letterSpacing = 1.0F,
			.key = key,
		});
		Renderer::Primitives::PopTransform();
	}

} // namespace game::road
