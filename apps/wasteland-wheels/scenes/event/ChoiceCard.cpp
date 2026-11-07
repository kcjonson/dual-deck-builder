#include "scenes/event/ChoiceCard.h"

#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <numbers>
#include <span>
#include <vector>

namespace game::event {

	namespace {

		using Foundation::Color;
		using Foundation::Rect;
		using Foundation::Vec2;
		namespace palette = atlas::tokens::palette;
		namespace styles = atlas::styles::print;
		namespace Primitives = Renderer::Primitives;

		constexpr float kIconSize = 18.0F;
		constexpr float kStroke = 1.6F;
		constexpr float kCorner = 7.0F;
		constexpr float kBand = 26.0F;
		constexpr float kPad = 12.0F;
		constexpr float kBorder = 1.6F;
		constexpr float kFocusGap = 3.0F;
		constexpr float kFocusWidth = 2.0F;
		constexpr float kLift = -1.0F;
		constexpr float kPress = 2.0F;
		constexpr float kHatchAlpha = 0.32F;
		constexpr Color kClear{0.0F, 0.0F, 0.0F, 0.0F};

		struct Strokes {
			std::vector<std::vector<Vec2>>	  lines;
			std::vector<bool>				  closed;
			std::vector<std::array<float, 3>> circles; // x, y, radius
		};

		// The TypeScript's strokes on the 18 px grid, until there's icon art for them.
		const Strokes& strokesOf(Icon icon) {
			static const auto kSkull = Strokes{
				.lines =
					{{{4.0F, 9.5F},
					  {3.8F, 6.2F},
					  {5.8F, 3.2F},
					  {9.0F, 2.2F},
					  {12.2F, 3.2F},
					  {14.2F, 6.2F},
					  {14.0F, 9.5F},
					  {12.4F, 11.4F},
					  {12.4F, 14.6F},
					  {5.6F, 14.6F},
					  {5.6F, 11.4F}},
					 {{7.6F, 14.6F}, {7.6F, 16.6F}},
					 {{10.4F, 14.6F}, {10.4F, 16.6F}}},
				.closed = {true, false, false},
				.circles = {{6.9F, 8.4F, 1.5F}, {11.1F, 8.4F, 1.5F}},
			};
			static const auto kSwords = Strokes{
				.lines =
					{{{3.0F, 3.0F}, {12.0F, 12.0F}},
					 {{10.0F, 14.0F}, {14.0F, 10.0F}},
					 {{12.0F, 12.0F}, {15.5F, 15.5F}},
					 {{15.0F, 3.0F}, {6.0F, 12.0F}},
					 {{4.0F, 10.0F}, {8.0F, 14.0F}},
					 {{6.0F, 12.0F}, {2.5F, 15.5F}}},
				.closed = {false, false, false, false, false, false},
				.circles = {},
			};
			static const auto kClock = Strokes{
				.lines = {{{9.0F, 9.0F}, {9.0F, 4.5F}}, {{9.0F, 9.0F}, {12.2F, 10.6F}}},
				.closed = {false, false},
				.circles = {{9.0F, 9.0F, 7.0F}},
			};
			static const auto kCards = Strokes{
				.lines =
					{{{2.5F, 5.5F}, {10.0F, 5.5F}, {10.0F, 16.0F}, {2.5F, 16.0F}},
					 {{7.0F, 2.0F}, {15.5F, 2.0F}, {15.5F, 12.5F}, {12.5F, 12.5F}},
					 {{7.0F, 2.0F}, {7.0F, 4.0F}}},
				.closed = {true, false, false},
				.circles = {},
			};
			static const auto kEscort = Strokes{
				.lines =
					{{{1.5F, 5.5F}, {10.5F, 5.5F}, {10.5F, 13.0F}, {1.5F, 13.0F}},
					 {{10.5F, 8.0F}, {14.0F, 8.0F}, {16.5F, 10.5F}, {16.5F, 13.0F}, {10.5F, 13.0F}}},
				.closed = {true, false},
				.circles = {{5.0F, 14.5F, 1.7F}, {13.5F, 14.5F, 1.7F}},
			};
			static const auto kDriver = Strokes{
				.lines = {{{2.0F, 9.0F}, {7.2F, 9.0F}}, {{10.8F, 9.0F}, {16.0F, 9.0F}}, {{9.0F, 10.8F}, {9.0F, 16.0F}}},
				.closed = {false, false, false},
				.circles = {{9.0F, 9.0F, 7.0F}, {9.0F, 9.0F, 1.8F}},
			};
			static const auto kRepair = Strokes{
				.lines = {{{3.0F, 15.0F}, {10.2F, 7.8F}}, {{11.2F, 3.4F}, {14.6F, 6.8F}}},
				.closed = {false, false},
				.circles = {{12.2F, 5.8F, 3.2F}},
			};
			static const auto kHeal = Strokes{
				.lines =
					{{{9.0F, 15.5F},
					  {3.4F, 9.8F},
					  {2.8F, 6.6F},
					  {4.4F, 3.9F},
					  {7.0F, 3.4F},
					  {9.0F, 5.4F},
					  {11.0F, 3.4F},
					  {13.6F, 3.9F},
					  {15.2F, 6.6F},
					  {14.6F, 9.8F}}},
				.closed = {true},
				.circles = {},
			};
			switch (icon) {
				case Icon::Swords:
					return kSwords;
				case Icon::Clock:
					return kClock;
				case Icon::Cards:
					return kCards;
				case Icon::Escort:
					return kEscort;
				case Icon::Driver:
					return kDriver;
				case Icon::Repair:
					return kRepair;
				case Icon::Heal:
					return kHeal;
				default:
					return kSkull;
			}
		}

		const char* storeIcon(Icon icon) {
			switch (icon) {
				case Icon::Food:
					return "food";
				case Icon::Water:
					return "water";
				case Icon::Fuel:
					return "fuel";
				case Icon::Meds:
					return "meds";
				case Icon::Scrap:
					return "scrap";
				case Icon::People:
					return "people";
				default:
					return nullptr;
			}
		}

		const char* iconName(Icon icon) {
			if (const char* store = storeIcon(icon)) {
				return store;
			}
			switch (icon) {
				case Icon::Skull:
					return "skull";
				case Icon::Swords:
					return "swords";
				case Icon::Clock:
					return "clock";
				case Icon::Cards:
					return "cards";
				case Icon::Escort:
					return "escort";
				case Icon::Driver:
					return "driver";
				case Icon::Repair:
					return "repair";
				case Icon::Heal:
					return "heal";
				default:
					return "";
			}
		}

		void rule(const Rect& bounds, Color color, float width, int32_t key, std::optional<Foundation::DashPattern> dash = std::nullopt) {
			Primitives::drawRect({
				.bounds = bounds,
				.style =
					{.fill = kClear,
					 .border =
						 Foundation::BorderStyle{
							 .color = color,
							 .width = width,
							 .cornerRadius = kCorner,
							 .position = Foundation::BorderPosition::Inside,
							 .dash = dash,
						 }},
				.key = key,
			});
		}

	} // namespace

	void drawIcon(ui::Context& context, Icon icon, Vec2 topLeft, float size, Color color, int32_t key) {
		if (const char* store = storeIcon(icon)) {
			atlas::drawIcon(context, store, topLeft, size, color, key);
			return;
		}
		const Strokes& strokes = strokesOf(icon);
		const float	   scale = size / kIconSize;
		const auto	   at = [&](Vec2 point) {
			return Vec2{topLeft.x + point.x * scale, topLeft.y + point.y * scale};
		};
		for (size_t index = 0; index < strokes.lines.size(); ++index) {
			std::vector<Vec2> points;
			for (const Vec2 point : strokes.lines[index]) {
				points.push_back(at(point));
			}
			Primitives::drawPolyline({
				.points = points,
				.width = kStroke * scale,
				.color = color,
				.cap = Primitives::LineCap::Round,
				.closed = strokes.closed[index],
				.key = key,
			});
		}
		for (const auto& [x, y, radius] : strokes.circles) {
			Primitives::drawCircle({
				.center = at({x, y}),
				.radius = radius * scale,
				.style = {.fill = kClear, .border = Foundation::BorderStyle{.color = color, .width = kStroke * scale}},
				.key = key,
			});
		}
	}

	Color toneColor(const ui::Context& context, Tone tone) {
		const ui::Theme& theme = context.getTheme();
		switch (tone) {
			case Tone::Cost:
				return theme.get(palette::stronghold);
			case Tone::Gain:
				return theme.get(palette::sage);
			case Tone::Ink:
				return theme.get(palette::ink);
		}
		return theme.get(palette::ink);
	}

	void IconView::describe(nlohmann::json& node) const {
		node["icon"] = iconName(icon);
		node["tone"] = tone == Tone::Cost ? "cost" : tone == Tone::Gain ? "gain" : "ink";
	}

	void IconView::render() {
		ui::Context& context = *getContext();
		drawIcon(context, icon, {0.0F, 0.0F}, kIconSize, atlas::withAlpha(toneColor(context, tone), opacity()), drawKey());
	}

	std::optional<Vec2> IconView::intrinsicSize(std::optional<float> /*width*/, float /*availableWidth*/) const {
		return Vec2{kIconSize, kIconSize};
	}

	ui::Ref<ui::Component>
	iconRow(ui::Ref<ui::Component> parent, const std::string& id, const std::vector<IconItem>& items, const ui::Theme& theme) {
		ui::Ref<ui::Component> row = parent.addChild<ui::Component>({
			.id = id,
			.minSize = {0.0F, kIconSize},
			.layout = [] {
				ui::Layout layout{
					.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = 4.0F, .alignItems = ui::AlignItems::Center
				};
				layout.flexWrap = ui::FlexWrap::Wrap;
				layout.flexShrink = 0.0F;
				return layout;
			}(),
		});
		for (size_t index = 0; index < items.size(); ++index) {
			const IconItem&	  item = items[index];
			const std::string itemId = id + "_" + std::to_string(index);
			row.addChild<IconView>({.id = itemId, .icon = item.icon, .tone = item.tone});
			if (!item.value.empty()) {
				const ui::ColorToken color = item.tone == Tone::Cost   ? palette::stronghold
											 : item.tone == Tone::Gain ? palette::sage
																	   : palette::ink;
				row.addChild<ui::Text>({
					.id = itemId + "_value",
					.margin = ui::Edges(0.0F, 6.0F, 0.0F, 0.0F),
					.style = styles::caption.extend({.color = theme.get(color)}),
					.text = item.value,
				});
			}
		}
		return row;
	}

	ChoiceCard::ChoiceCard(const Args& args)
		: title(args.title),
		  preview(args.preview),
		  band(args.band),
		  hotkey(args.hotkey),
		  lock(args.lock),
		  icons(args.icons),
		  onPress(args.onPress) {}

	float ChoiceCard::inkExtent() const {
		return kFocusGap + kFocusWidth + kPress;
	}

	float ChoiceCard::stateOpacity() const {
		return lock == Lock::Need ? 1.0F : ui::Control::stateOpacity();
	}

	void ChoiceCard::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		node["title"] = title;
		node["band"] = band;
		node["lock"] = lock == Lock::Open ? "open" : lock == Lock::Need ? "need" : "short";
	}

	void ChoiceCard::onMount() {
		ui::Control::onMount();
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Column;
		layout.alignItems = ui::AlignItems::Stretch;
		layout.padding = ui::Edges(0.0F, 0.0F, kPad, 0.0F);
		setLayout(layout);
		const std::string id = getId();
		const bool		  locked = lock != Lock::Open;
		const ui::Style	  bandStyle =
			styles::kicker.extend({.color = getContext()->getTheme().get(locked ? palette::stronghold : palette::inkDim)});

		ui::Ref<ui::Component> bandRow = addChild<ui::Component>({
			.id = id + "_band",
			.minSize = {0.0F, kBand},
			.layout = {
				.display = ui::Display::Flex,
				.flexDirection = ui::FlexDirection::Row,
				.gap = 8.0F,
				.padding = ui::Edges(0.0F, kPad),
				.alignItems = ui::AlignItems::Center,
			},
		});
		bandRow.addChild<ui::Text>({
			.id = id + "_need",
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
			.style = bandStyle,
			.text = band.empty() ? " " : band,
			.wrap = true,
		});
		if (!hotkey.empty()) {
			bandRow.addChild<ui::Text>({.id = id + "_key", .layout = {.flexShrink = 0.0F}, .style = styles::kicker, .text = hotkey});
		}
		titleText = addChild<ui::Text>({
			.id = id + "_title",
			.margin = ui::Edges(10.0F, kPad, 0.0F, kPad),
			.style = styles::boxTitle.extend({.fontSize = 21.0F}),
			.text = title,
			.wrap = true,
		});
		addChild<ui::Text>({
			.id = id + "_preview",
			.margin = ui::Edges(4.0F, kPad, 0.0F, kPad),
			.style = styles::note,
			.text = preview,
			.wrap = true,
		});
		addChild<ui::Component>({.minSize = {0.0F, 8.0F}, .layout = {.flexGrow = 1.0F}, .pointerEvents = ui::PointerEvents::None});
		// A choice that risks and gives nothing, driving on, has no icons, and no rule over them.
		if (icons.risks.empty() && icons.gains.empty()) {
			return;
		}
		risksRow = addChild<ui::Component>({
			.id = id + "_icons",
			.margin = ui::Edges(10.0F, kPad, 0.0F, kPad),
			.layout = {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = 6.0F, .alignItems = ui::AlignItems::Start
			},
		});
		if (!icons.risks.empty()) {
			iconRow(risksRow, id + "_risk", icons.risks, getContext()->getTheme());
		}
		if (!icons.gains.empty()) {
			iconRow(risksRow, id + "_gain", icons.gains, getContext()->getTheme());
		}
	}

	void ChoiceCard::render() {
		ui::Context&			   context = *getContext();
		const ui::Theme&		   theme = context.getTheme();
		const float				   alpha = opacity();
		const bool				   enabled = isEnabledInTree();
		const ui::InteractionState state = interaction();
		const int32_t			   key = drawKey();
		const Rect				   face{0.0F, 0.0F, size.x, size.y};
		const auto				   ink = [&](ui::ColorToken token) {
			return atlas::withAlpha(theme.get(token), alpha);
		};

		Primitives::drawRect({
			.bounds = face,
			.style =
				{.fill = ink(palette::freshPaper),
				 .border = Foundation::BorderStyle{.color = kClear, .width = 0.0F, .cornerRadius = kCorner}},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		// The index band, its top corners the card's.
		Primitives::drawRect({
			.bounds = {0.0F, 0.0F, size.x, kBand},
			.style =
				{.fill = ink(palette::index),
				 .border =
					 Foundation::BorderStyle{
						 .color = ink(palette::index),
						 .width = 1.0F,
						 .cornerRadius = kCorner,
						 .position = Foundation::BorderPosition::Inside,
						 .sides = {.top = true, .right = true, .bottom = false, .left = true},
					 }},
			.key = key,
		});
		Primitives::drawRect({.bounds = {0.0F, kBand - 1.0F, size.x, 1.0F}, .style = {.fill = ink(palette::inkHairline)}, .key = key});
		// The hairline over the icons.
		if (const ui::Component* row = risksRow.get()) {
			const Rect icons = row->getBounds();
			Primitives::drawRect(
				{.bounds = {kPad, icons.y - 6.0F, size.x - 2.0F * kPad, 1.0F}, .style = {.fill = ink(palette::inkHairline)}, .key = key}
			);
		}

		if (lock == Lock::Need) {
			// The rust hatch over the card (UI Art Direction: locked), as the compound's unbuilt plots carry it.
			Primitives::pushClip(face);
			const float step = 11.0F * std::numbers::sqrt2_v<float>;
			for (float along = 0.0F; along < size.x + size.y; along += step) {
				Primitives::drawLine({
					.start = {along, 0.0F},
					.end = {along - size.y, size.y},
					.style = {.color = atlas::withAlpha(theme.get(palette::rustHatch), kHatchAlpha), .width = 2.0F},
					.key = key,
				});
			}
			Primitives::popClip();
		}
		if (lock == Lock::Short) {
			rule(face, ink(palette::backRoad), kBorder, key, atlas::kDisabledDash);
			// The title struck through (Game Flow 5.2), across its first line.
			if (const ui::Text* shown = titleText.get()) {
				const Rect			   words = shown->getBounds();
				const ui::Text::Extent extent = shown->measureExtent();
				const float			   line = extent.lines > 0 ? extent.size.y / static_cast<float>(extent.lines) : words.height;
				const float			   across = extent.lines > 1 ? words.width : std::min(words.width, extent.size.x);
				Primitives::drawLine({
					.start = {words.x, words.y + line * 0.55F},
					.end = {words.x + across, words.y + line * 0.55F},
					.style = {.color = ink(palette::ink), .width = 1.6F},
					.key = key,
				});
			}
		} else {
			const bool hovered = enabled && state.hovered;
			rule(face, ink(hovered || state.pressed ? palette::ink : palette::backRoad), kBorder, key);
		}
		if (state.focusVisible) {
			const float reach = kFocusGap + kFocusWidth;
			Primitives::drawRect({
				.bounds = {-reach, -reach, size.x + 2.0F * reach, size.y + 2.0F * reach},
				.style =
					{.fill = kClear,
					 .border =
						 Foundation::BorderStyle{
							 .color = ink(palette::ink),
							 .width = kFocusWidth,
							 .cornerRadius = kCorner + reach,
							 .position = Foundation::BorderPosition::Inside,
						 }},
				.key = key,
			});
		}
	}

	void ChoiceCard::onInteractionChanged(const ui::InteractionState& /*previous*/) {
		settle();
	}

	void ChoiceCard::activate() {
		if (onPress) {
			onPress();
		}
	}

	void ChoiceCard::settle() {
		const ui::InteractionState state = interaction();
		float					   offset = 0.0F;
		if (isEnabledInTree() && state.pressed) {
			offset = kPress;
		} else if (isEnabledInTree() && state.hovered) {
			offset = kLift;
		}
		if (getTransform().translate.y != offset) {
			setTransform({.translate = {0.0F, offset}});
		}
	}

} // namespace game::event
