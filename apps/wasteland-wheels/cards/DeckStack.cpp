#include "cards/DeckStack.h"

#include "atlas/Ink.h"
#include "atlas/Tokens.h"
#include "cards/CardBack.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <numbers>
#include <string>

namespace game::cards {

	namespace {

		namespace palette = atlas::tokens::palette;

		// A stacked card's edge shows this far past the one above it, at a 100 px card.
		constexpr float kStackStep = 1.8F;
		// A fanned card's turn past the one above it, about the cards' bottom-left corner.
		constexpr float kFanTurn = 7.0F * std::numbers::pi_v<float> / 180.0F;
		constexpr float kShadowBlur = 10.0F;
		constexpr float kShadowDrop = 5.0F;

		glm::mat4 turnedAbout(Foundation::Vec2 pivot, float turn) {
			glm::mat4 place = glm::translate(glm::mat4(1.0F), glm::vec3(pivot.x, pivot.y, 0.0F));
			place = glm::rotate(place, turn, glm::vec3(0.0F, 0.0F, 1.0F));
			return glm::translate(place, glm::vec3(-pivot.x, -pivot.y, 0.0F));
		}

	} // namespace

	DeckStack::DeckStack(const Args& args)
		: deck(args.seat),
		  width(args.width),
		  under(std::clamp(args.under, 0, 4)),
		  lay(args.lay) {}

	float DeckStack::inkExtent() const {
		// A fanned card's far corner swings out about its height times the turn; a stack's edges and the shadow are less.
		const float height = CardBack::heightFor(size.x);
		return lay == DeckLay::Fan ? height * kFanTurn * static_cast<float>(under) + kShadowBlur
								   : kStackStep * size.x / back::kWidth * static_cast<float>(under) + kShadowBlur + kShadowDrop;
	}

	void DeckStack::describe(nlohmann::json& node) const {
		node["deck"] = deck == 0 ? "a" : "b";
		node["lay"] = lay == DeckLay::Fan ? "fan" : "stack";
		node["cards"] = under + 1;
	}

	std::optional<Foundation::Vec2> DeckStack::intrinsicSize(std::optional<float> boxWidth, float /*availableWidth*/) const {
		const float shown = boxWidth.value_or(width);
		return Foundation::Vec2{shown, CardBack::heightFor(shown)};
	}

	void DeckStack::onMount() {
		const ui::Size whole{ui::percent(100.0F), ui::percent(100.0F)};
		const auto	   card = [&](int index, ui::Transform turn) {
			addChild<CardBack>({
					.id = getId().empty() ? std::string() : getId() + "_card_" + std::to_string(index),
					.size = whole,
					.transform = turn,
					.layout = {.position = ui::Position::Absolute},
					.seat = deck,
					.width = width,
			});
		};
		if (lay == DeckLay::Fan) {
			for (int index = under; index > 0; --index) {
				card(index, {.rotate = -kFanTurn * static_cast<float>(index), .origin = {0.0F, 1.0F}});
			}
		}
		card(0, {});
	}

	void DeckStack::render() {
		const ui::Theme&			theme = getContext()->getTheme();
		const float					alpha = opacity();
		const int32_t				key = drawKey();
		const float					scale = size.x / back::kWidth;
		const float					radius = back::kRadius * scale;
		const Foundation::Color		paper = atlas::withAlpha(theme.get(palette::paper), alpha);
		const Foundation::Color		ink = atlas::withAlpha(theme.get(palette::ink), alpha);
		const Foundation::BoxShadow shadow{
			.color = atlas::withAlpha(theme.get(palette::shadow), alpha * 0.8F), .blur = kShadowBlur, .offset = {0.0F, kShadowDrop}
		};
		const Foundation::Rect face{0.0F, 0.0F, size.x, size.y};

		if (lay == DeckLay::Fan) {
			// Each fanned card's shadow and paper under it; the backs paint over them.
			for (int index = under; index >= 0; --index) {
				Renderer::Primitives::PushTransform(turnedAbout({0.0F, size.y}, -kFanTurn * static_cast<float>(index)));
				Renderer::Primitives::drawRect({
					.bounds = face,
					.style = {.fill = paper, .border = Foundation::BorderStyle{.width = 0.0F, .cornerRadius = radius}, .boxShadow = shadow},
					.key = key,
				});
				Renderer::Primitives::PopTransform();
			}
			return;
		}

		// The edges of the cards under the top one, the bottom card's carrying the shadow.
		const float step = kStackStep * scale;
		for (int index = under; index > 0; --index) {
			const float by = step * static_cast<float>(index);
			Renderer::Primitives::drawRect({
				.bounds = {by, by, size.x, size.y},
				.style =
					{.fill = paper,
					 .border =
						 Foundation::BorderStyle{
							 .color = ink, .width = 0.8F, .cornerRadius = radius, .position = Foundation::BorderPosition::Inside
						 },
					 .boxShadow = index == under ? std::optional(shadow) : std::nullopt},
				.key = key,
			});
		}
		if (under == 0) {
			Renderer::Primitives::drawRect({
				.bounds = face,
				.style = {.fill = paper, .border = Foundation::BorderStyle{.width = 0.0F, .cornerRadius = radius}, .boxShadow = shadow},
				.key = key,
			});
		}
	}

} // namespace game::cards
