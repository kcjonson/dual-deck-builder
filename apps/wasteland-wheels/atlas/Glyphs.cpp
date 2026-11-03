#include "atlas/Glyphs.h"

#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>

namespace game::atlas {

	namespace palette = tokens::palette;

	void IconStack::describe(nlohmann::json& node) const {
		nlohmann::json icons = nlohmann::json::array();
		for (const Layer& layer : layers) {
			icons.push_back(layer.icon);
		}
		node["icons"] = icons;
	}

	void IconStack::render() {
		const float side = std::min(size.x, size.y);
		if (side <= 0.0F) {
			return;
		}
		ui::Context&		   context = *getContext();
		const Foundation::Vec2 topLeft{(size.x - side) * 0.5F, (size.y - side) * 0.5F};
		for (const Layer& layer : layers) {
			drawIcon(context, layer.icon, topLeft, side, withAlpha(context.getTheme().get(layer.color), opacity()), drawKey());
		}
	}

	void Circled::render() {
		const float radius = std::min(size.x, size.y) * 0.5F - 1.0F;
		if (radius > 0.0F) {
			drawCircled(size * 0.5F, radius, text, withAlpha(getContext()->getTheme().get(palette::ink), opacity()), drawKey());
		}
	}

	IconStack::Args deckGlyph(const std::string& id) {
		return {
			.id = id,
			.size = {20.0F, 20.0F},
			.layers = {
				{.icon = "deck-a-body", .color = palette::freshPaper},
				{.icon = "deck-a", .color = palette::casing},
				{.icon = "deck-b-body", .color = palette::freshPaper},
				{.icon = "deck-b", .color = palette::routeTealCasing},
			},
		};
	}

	IconStack::Args shieldGlyph(const std::string& id) {
		return {
			.id = id,
			.size = {38.0F, 38.0F},
			.layers = {
				{.icon = "shield-body", .color = palette::onHighway},
				{.icon = "shield-mark", .color = palette::casing},
			},
		};
	}

} // namespace game::atlas
