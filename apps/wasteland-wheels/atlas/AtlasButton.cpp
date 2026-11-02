#include "atlas/AtlasButton.h"

#include "atlas/Glyphs.h"
#include "atlas/Ink.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <utility>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr float	 kHighwayHeight = 68.0F;
		constexpr float	 kBackRoadHeight = 46.0F;
		constexpr float	 kHighwayBorder = 4.0F;
		constexpr float	 kBackRoadBorder = 1.6F;
		constexpr float	 kOffset = 3.0F; // the highway's casing beneath it
		constexpr float	 kInnerRuleInset = 3.0F;
		constexpr float	 kFocusGap = 3.0F;
		constexpr float	 kFocusWidth = 2.0F;
		constexpr float	 kLift = -1.0F;
		constexpr float	 kHighwayPress = 3.0F;
		constexpr float	 kBackRoadPress = 2.0F;
		constexpr Dashes kDisabledDashes{.dash = 6.0F, .gap = 4.0F};

		void drawRule(const Foundation::Rect& bounds, Foundation::Color color, float width, int32_t key) {
			Renderer::Primitives::drawRect({
				.bounds = bounds,
				.style =
					{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
					 .border = Foundation::BorderStyle{.color = color, .width = width, .position = Foundation::BorderPosition::Inside}},
				.key = key,
			});
		}

	} // namespace

	AtlasButton::AtlasButton(const Args& args)
		: label(args.label),
		  road(args.road),
		  shield(args.shield),
		  onPress(args.onPress) {}

	void AtlasButton::setLabel(std::string value) {
		label = std::move(value);
		if (ui::Text* shown = text.get()) {
			shown->setText(label);
		}
	}

	float AtlasButton::inkExtent() const {
		return kFocusGap + kFocusWidth;
	}

	void AtlasButton::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		node["label"] = label;
		node["road"] = road == Road::Highway ? "highway" : "back_road";
	}

	void AtlasButton::onMount() {
		ui::Control::onMount();
		const bool highway = road == Road::Highway;
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::Center;
		layout.justifyContent = shield ? ui::JustifyContent::SpaceBetween : ui::JustifyContent::Center;
		layout.padding = ui::Edges(0.0F, highway ? 20.0F : 14.0F);
		layout.gap = 12.0F;
		setLayout(layout);
		setMinSize({0.0F, highway ? kHighwayHeight : kBackRoadHeight});
		const std::string id = getId();
		text = addChild<ui::Text>({
			.id = id.empty() ? std::string() : id + "_label",
			.style = highway ? styles::highwayLabel : styles::backRoadLabel,
			.text = label,
		});
		if (shield) {
			addChild<IconStack>(shieldGlyph(id.empty() ? std::string() : id + "_shield"));
		}
	}

	void AtlasButton::render() {
		const ui::Theme&	   theme = getContext()->getTheme();
		const float			   alpha = opacity();
		const bool			   enabled = isEnabledInTree();
		const bool			   hovered = enabled && isHovered();
		const bool			   pressed = enabled && isPressed();
		const bool			   highway = road == Road::Highway;
		const int32_t		   key = drawKey();
		const Foundation::Rect face{0.0F, 0.0F, size.x, size.y};
		const auto			   ink = [&](ui::ColorToken token) {
			return withAlpha(theme.get(token), alpha);
		};

		if (highway && enabled && !pressed) {
			const float beneath = kOffset - (hovered ? kLift : 0.0F);
			Renderer::Primitives::drawRect(
				{.bounds = {0.0F, beneath, size.x, size.y}, .style = {.fill = ink(palette::casing)}, .key = key}
			);
		}

		const ui::ColorToken fill =
			!enabled ? (highway ? palette::index : palette::freshPaper) : (highway ? palette::highway : palette::freshPaper);
		drawPaper({
			.bounds = face,
			.tint = ink(fill),
			.look = {.seed = paperSeed(getId()), .wear = Wear::Handled},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});

		if (!enabled) {
			drawDashedRect(face, ink(palette::backRoad), kBackRoadBorder, kDisabledDashes, key);
		} else if (highway) {
			drawRule(face, ink(hovered ? palette::ink : palette::casing), kHighwayBorder, key);
		} else {
			drawRule(face, ink(hovered ? palette::ink : palette::backRoad), kBackRoadBorder, key);
			const float inset = kBackRoadBorder + kInnerRuleInset;
			drawRule({inset, inset, size.x - 2.0F * inset, size.y - 2.0F * inset}, withAlpha(ink(palette::ink), 0.2F), 1.0F, key);
		}

		if (isFocusVisible()) {
			const float reach = kFocusGap + kFocusWidth;
			drawRule({-reach, -reach, size.x + 2.0F * reach, size.y + 2.0F * reach}, ink(palette::ink), kFocusWidth, key);
		}
	}

	void AtlasButton::handlePointer(ui::PointerEvent& event) {
		ui::Control::handlePointer(event);
		settle();
	}

	void AtlasButton::activate() {
		if (onPress) {
			onPress();
		}
	}

	void AtlasButton::settle() {
		float offset = 0.0F;
		if (isEnabledInTree() && isPressed()) {
			offset = road == Road::Highway ? kHighwayPress : kBackRoadPress;
		} else if (isEnabledInTree() && isHovered()) {
			offset = kLift;
		}
		if (getTransform().translate.y != offset) {
			setTransform({.translate = {0.0F, offset}});
		}
	}

} // namespace game::atlas
