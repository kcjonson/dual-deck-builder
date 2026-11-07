#include "cards/EscortCard.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>

namespace game::cards {

	namespace {

		constexpr float				kFocusGap = 3.0F;
		constexpr float				kFocusWidth = 2.0F;
		constexpr Foundation::Color kStructure = hex(0x8FBF5C);
		constexpr Foundation::Color kTrack = hex(0x0E0F10);
		constexpr Foundation::Color kSilhouette = hex(0xE9E4D6, 0.2F);

		// A vehicle seen from behind on the unowned art strip's ground, until escorts have art: a body, its cab, two tyres.
		void drawVehicle(const Foundation::Rect& box, bool dim, int32_t key) {
			const Foundation::Color ground = artGround(std::nullopt)[0];
			drawRounded(box, 3.0F, dim ? dimmed(ground) : ground, std::nullopt, 0.0F, key);
			const Foundation::Color figure = dim ? dimmed(kSilhouette) : kSilhouette;
			const Foundation::Color tyre = dim ? dimmed(kTrack) : kTrack;
			const float				centre = box.x + box.width * 0.5F;
			const float				body = box.width * 0.62F;
			drawRounded({centre - body * 0.3F, box.y + 5.0F, body * 0.6F, 9.0F}, 2.0F, figure, std::nullopt, 0.0F, key);
			drawRounded({centre - body * 0.5F, box.y + 13.0F, body, 12.0F}, 2.0F, figure, std::nullopt, 0.0F, key);
			for (const float side : {-1.0F, 1.0F}) {
				drawRounded(
					{centre + side * body * 0.5F - (side < 0.0F ? 3.0F : 4.0F), box.y + 22.0F, 7.0F, 7.0F},
					1.5F,
					tyre,
					std::nullopt,
					0.0F,
					key
				);
			}
		}

	} // namespace

	EscortFace escortFace(const rules::campaign::ConvoyEscort& member, const rules::Content& content) {
		const rules::EscortDefinition& type = content.escorts.at(member.type);
		return EscortFace{
			.name = type.name,
			.structure = member.structure,
			.maxStructure = type.structure,
			.signature = content.cards.at(type.signatureCard).name,
		};
	}

	EscortCard::EscortCard(const Args& args)
		: face(args.face),
		  faded(args.faded),
		  onPress(args.onPress) {}

	void EscortCard::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		node["name"] = face.name;
		node["structure"] = std::to_string(face.structure) + "/" + std::to_string(face.maxStructure);
		node["signature"] = face.signature;
		node["tag"] = face.tag;
		node["faded"] = faded;
	}

	void EscortCard::onMount() {
		ui::Control::onMount();
		setSize(escort::kSize);
		name = wrappedLines(face.name, fonts::kDisplayBold, escort::kNameSize, escort::kContentWidth, escort::kNameLines);
		signature = fittedLine("+ " + face.signature, fonts::kMono, escort::kMono, escort::kContentWidth);
	}

	void EscortCard::activate() {
		if (onPress) {
			onPress();
		}
	}

	void EscortCard::render() {
		const int32_t			   key = drawKey();
		const ui::InteractionState now = interaction();
		const auto				   tone = [this](Foundation::Color color) {
			return faded ? dimmedText(color) : color;
		};
		const auto shade = [this](Foundation::Color color) {
			return faded ? dimmed(color) : color;
		};
		const bool lit = (now.hovered && isEnabledInTree()) || now.focusVisible;

		drawRounded({0.0F, 0.0F, size.x, size.y}, escort::kRadius, shade(kGround), std::nullopt, 0.0F, key);
		// The hazard-stripe header: the road shoulder's 135 degree hatch, muted bone on the bar's sunk black.
		const Foundation::Rect band{escort::kBorder, escort::kBorder, size.x - escort::kBorder * 2.0F, escort::kHeader};
		drawRounded(band, escort::kRadius - escort::kBorder, shade(kTrack), std::nullopt, 0.0F, key);
		Renderer::Primitives::pushClip(band);
		for (float x = band.x - band.height; x < band.x + band.width; x += escort::kStripePeriod) {
			const std::array<Foundation::Vec2, 4> stripe{{
				{x + band.height, band.y},
				{x + band.height + escort::kStripe, band.y},
				{x + escort::kStripe, band.y + band.height},
				{x, band.y + band.height},
			}};
			Renderer::Primitives::drawPolygon({.vertices = stripe, .style = {.fill = shade(kMuted)}, .key = key});
		}
		Renderer::Primitives::popClip();
		drawRounded(
			{0.0F, 0.0F, size.x, size.y}, escort::kRadius, {0.0F, 0.0F, 0.0F, 0.0F}, lit ? kHover : shade(kDim), escort::kBorder, key
		);
		if (now.focusVisible) {
			const float reach = kFocusGap + kFocusWidth;
			drawRounded(
				{-reach, -reach, size.x + reach * 2.0F, size.y + reach * 2.0F},
				escort::kRadius + reach,
				{0.0F, 0.0F, 0.0F, 0.0F},
				kHover,
				kFocusWidth,
				key
			);
		}

		drawVehicle({escort::kContentX, escort::kArtY, escort::kContentWidth, escort::kArtHeight}, faded, key);
		for (size_t line = 0; line < name.size(); ++line) {
			drawWords({
				.text = name[line],
				.at = {escort::kContentX, escort::kNameY + static_cast<float>(line) * escort::kNameLine},
				.face = fonts::kDisplayBold,
				.size = escort::kNameSize,
				.color = tone(kName),
				.boxHeight = escort::kNameLine,
				.key = key,
			});
		}
		const float barWidth = escort::kContentWidth - escort::kFigures - 4.0F;
		const float barY = escort::kStructureY + (escort::kRow - escort::kBar) * 0.5F;
		drawRounded({escort::kContentX, barY, barWidth, escort::kBar}, 1.0F, shade(kTrack), std::nullopt, 0.0F, key);
		const float share = face.maxStructure > 0 ? std::clamp(static_cast<float>(face.structure) / face.maxStructure, 0.0F, 1.0F) : 0.0F;
		if (share > 0.0F) {
			drawRounded({escort::kContentX, barY, barWidth * share, escort::kBar}, 1.0F, shade(kStructure), std::nullopt, 0.0F, key);
		}
		drawWords({
			.text = std::to_string(face.structure) + "/" + std::to_string(face.maxStructure),
			.at = {escort::kContentX + escort::kContentWidth - escort::kFigures, escort::kStructureY},
			.face = fonts::kMono,
			.size = escort::kMono,
			.color = tone(kName),
			.align = Foundation::HorizontalAlign::Right,
			.boxWidth = escort::kFigures,
			.boxHeight = escort::kRow,
			.key = key,
		});
		drawWords({
			.text = signature,
			.at = {escort::kContentX, escort::kSignatureY},
			.face = fonts::kMono,
			.size = escort::kMono,
			.color = tone(kMuted),
			.boxHeight = escort::kRow,
			.key = key,
		});
		(void)drawTag(face.tag, escort::kTagRight, 0.0F, faded, key);
	}

} // namespace game::cards
