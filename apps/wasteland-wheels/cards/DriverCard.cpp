#include "cards/DriverCard.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>

#include <rules/campaign/Recruits.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <numbers>

namespace game::cards {

	namespace {

		constexpr float				kFocusGap = 3.0F;
		constexpr float				kFocusWidth = 2.0F;
		constexpr Foundation::Color kHitpoints = hex(0xE7727A);
		constexpr Foundation::Color kTrack = hex(0x0E0F10);
		constexpr Foundation::Color kSilhouette = hex(0xE9E4D6, 0.2F);
		constexpr int				kShoulderSteps = 10;

		std::string upper(std::string_view text) {
			std::string out(text);
			std::ranges::transform(out, out.begin(), [](unsigned char letter) { return static_cast<char>(std::toupper(letter)); });
			return out;
		}

		// A head and shoulders on the unowned art strip's ground, until drivers have portraits.
		void drawPortrait(const Foundation::Rect& box, bool dim, int32_t key) {
			const Foundation::Color ground = artGround(std::nullopt)[0];
			drawRounded(box, driver::kRadius, dim ? dimmed(ground) : ground, std::nullopt, 0.0F, key);
			const Foundation::Color figure = dim ? dimmed(kSilhouette) : kSilhouette;
			const float				centre = box.x + box.width * 0.5F;
			Renderer::Primitives::drawCircle(
				{.center = {centre, box.y + box.height * 0.4F}, .radius = box.height / 6.0F, .style = {.fill = figure}, .key = key}
			);
			const float											 radius = box.height * 0.27F;
			const float											 half = box.height * 0.73F * 0.5F;
			const float											 top = box.y + box.height * 0.6F;
			const float											 bottom = box.y + box.height;
			std::array<Foundation::Vec2, kShoulderSteps * 2 + 4> outline{};
			size_t												 at = 0;
			outline.at(at++) = {centre - half, bottom};
			for (int step = 0; step <= kShoulderSteps; ++step) {
				const float angle = std::numbers::pi_v<float> * (1.0F + 0.5F * static_cast<float>(step) / kShoulderSteps);
				outline.at(at++) = {centre - half + radius + radius * std::cos(angle), top + radius + radius * std::sin(angle)};
			}
			for (int step = 0; step <= kShoulderSteps; ++step) {
				const float angle = std::numbers::pi_v<float> * (1.5F + 0.5F * static_cast<float>(step) / kShoulderSteps);
				outline.at(at++) = {centre + half - radius + radius * std::cos(angle), top + radius + radius * std::sin(angle)};
			}
			outline.at(at++) = {centre + half, bottom};
			Renderer::Primitives::drawPolygon({.vertices = std::span(outline.data(), at), .style = {.fill = figure}, .key = key});
		}

	} // namespace

	DriverFace
	driverFace(const rules::campaign::Campaign& campaign, const rules::Content& content, const rules::campaign::DriverRecord& record) {
		using rules::campaign::DriverStatus;
		const rules::DriverDefinition& archetype = content.drivers.at(record.archetype);
		DriverFace					   face{
								.name = rules::campaign::driverName(campaign, content, record.id),
								.specialty = archetype.specialty,
								.hitpoints = record.hitpoints,
								.maxHitpoints = archetype.maxHitpoints,
								.handLimit = archetype.handLimit,
								.deckSize = rules::campaign::totalCards(record.defaultDeck),
		};
		switch (record.status) {
			case DriverStatus::Dead:
				face.specialty = "Killed on a run";
				face.tag = "LOST";
				face.deckSize = 0;
				return face;
			case DriverStatus::Missing:
				face.specialty = "Missing on a run";
				face.tag = "LOST";
				return face;
			case DriverStatus::Injured:
				face.tag = "INJURED";
				break;
			case DriverStatus::Ready:
				break;
		}
		if (const rules::campaign::RunDeck* deck = campaign.runDeckOf(record.id)) {
			face.deckSize = rules::campaign::totalCards(rules::campaign::runDeckCards(*deck));
			face.custom = !deck->leftHome.empty() || !deck->borrowed.empty();
			const auto seat = std::ranges::find(campaign.run->seats, record.id, &rules::campaign::RunDeck::driver);
			face.tag = "SEAT " + std::to_string(seat - campaign.run->seats.begin() + 1);
		}
		return face;
	}

	DriverCard::DriverCard(const Args& args)
		: face(args.face),
		  faded(args.faded),
		  onPress(args.onPress) {}

	void DriverCard::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		node["name"] = face.name;
		node["specialty"] = face.specialty;
		node["hp"] = std::to_string(face.hitpoints) + "/" + std::to_string(face.maxHitpoints);
		node["deck"] = face.deckSize;
		node["tag"] = face.tag;
		node["custom"] = face.custom;
		node["faded"] = faded;
	}

	void DriverCard::onMount() {
		ui::Control::onMount();
		setSize(driver::kSize);
		name = wrappedLines(face.name, fonts::kDisplayBold, driver::kNameSize, driver::kContentWidth, driver::kNameLines);
		specialty = fittedLine(upper(face.specialty), fonts::kDisplayBold, driver::kSpecialtySize, driver::kContentWidth);
	}

	void DriverCard::activate() {
		if (onPress) {
			onPress();
		}
	}

	void DriverCard::render() {
		const int32_t			   key = drawKey();
		const ui::InteractionState now = interaction();
		const auto				   tone = [this](Foundation::Color color) {
			return faded ? dimmedText(color) : color;
		};
		const auto shade = [this](Foundation::Color color) {
			return faded ? dimmed(color) : color;
		};
		const bool lit = (now.hovered && isEnabledInTree()) || now.focusVisible;

		// The riveted double frame: the outer line, a gap of the ground, a thin inner line, and a rivet in each corner.
		drawRounded({0.0F, 0.0F, size.x, size.y}, driver::kRadius, shade(kGround), lit ? kHover : shade(kDim), driver::kOuter, key);
		const float inset = driver::kOuter + driver::kGap;
		drawRounded(
			{inset, inset, size.x - inset * 2.0F, size.y - inset * 2.0F}, driver::kRadius, {0.0F, 0.0F, 0.0F, 0.0F}, shade(kDim), 1.0F, key
		);
		for (const Foundation::Vec2 rivet : {
				 Foundation::Vec2{driver::kRivetInset, driver::kRivetInset},
				 Foundation::Vec2{size.x - driver::kRivetInset, driver::kRivetInset},
				 Foundation::Vec2{size.x - driver::kRivetInset, size.y - driver::kRivetInset},
				 Foundation::Vec2{driver::kRivetInset, size.y - driver::kRivetInset},
			 }) {
			Renderer::Primitives::drawCircle({.center = rivet, .radius = driver::kRivet, .style = {.fill = shade(kMuted)}, .key = key});
		}
		if (now.focusVisible) {
			const float reach = kFocusGap + kFocusWidth;
			drawRounded(
				{-reach, -reach, size.x + reach * 2.0F, size.y + reach * 2.0F},
				driver::kRadius + reach,
				{0.0F, 0.0F, 0.0F, 0.0F},
				kHover,
				kFocusWidth,
				key
			);
		}

		drawPortrait({driver::kContentX, driver::kPortraitY, driver::kContentWidth, driver::kPortraitHeight}, faded, key);
		for (size_t line = 0; line < name.size(); ++line) {
			drawWords({
				.text = name[line],
				.at = {driver::kContentX, driver::kNameY + static_cast<float>(line) * driver::kNameLine},
				.face = fonts::kDisplayBold,
				.size = driver::kNameSize,
				.color = tone(kName),
				.boxHeight = driver::kNameLine,
				.key = key,
			});
		}
		drawWords({
			.text = specialty,
			.at = {driver::kContentX, driver::kSpecialtyY},
			.face = fonts::kDisplayBold,
			.size = driver::kSpecialtySize,
			.color = tone(kMuted),
			.boxHeight = driver::kRow,
			.letterSpacing = 0.4F,
			.key = key,
		});

		const float barWidth = driver::kContentWidth - driver::kFigures - 4.0F;
		const float barY = driver::kHpY + (driver::kRow - driver::kBar) * 0.5F;
		drawRounded({driver::kContentX, barY, barWidth, driver::kBar}, 1.0F, shade(kTrack), std::nullopt, 0.0F, key);
		const float share = face.maxHitpoints > 0 ? std::clamp(static_cast<float>(face.hitpoints) / face.maxHitpoints, 0.0F, 1.0F) : 0.0F;
		if (share > 0.0F) {
			drawRounded({driver::kContentX, barY, barWidth * share, driver::kBar}, 1.0F, shade(kHitpoints), std::nullopt, 0.0F, key);
		}
		drawWords({
			.text = std::to_string(face.hitpoints) + "/" + std::to_string(face.maxHitpoints),
			.at = {driver::kContentX + driver::kContentWidth - driver::kFigures, driver::kHpY},
			.face = fonts::kMono,
			.size = driver::kMono,
			.color = tone(kName),
			.align = Foundation::HorizontalAlign::Right,
			.boxWidth = driver::kFigures,
			.boxHeight = driver::kRow,
			.key = key,
		});
		drawWords({
			.text = "HAND " + std::to_string(face.handLimit),
			.at = {driver::kContentX, driver::kFootY},
			.face = fonts::kMono,
			.size = driver::kMono,
			.color = tone(kMuted),
			.boxHeight = driver::kRow,
			.key = key,
		});
		drawWords({
			.text = "DECK " + std::to_string(face.deckSize),
			.at = {driver::kContentX, driver::kFootY},
			.face = fonts::kMono,
			.size = driver::kMono,
			.color = tone(kMuted),
			.align = Foundation::HorizontalAlign::Right,
			.boxWidth = driver::kContentWidth,
			.boxHeight = driver::kRow,
			.key = key,
		});

		const float tagWidth = drawTag(face.tag, driver::kTagRight, 0.0F, faded, key);
		if (face.custom) {
			(void)drawTag("CUSTOM", driver::kTagRight - (tagWidth > 0.0F ? tagWidth + driver::kTagGap : 0.0F), 0.0F, faded, key);
		}
	}

} // namespace game::cards
