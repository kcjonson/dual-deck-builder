#include "scenes/map/PlanRows.h"

#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

namespace game {

	namespace {

		namespace palette = atlas::tokens::palette;
		namespace styles = atlas::styles::print;

		constexpr float kRowHeight = 44.0F;
		constexpr float kGlyphRadius = 11.0F;
		constexpr float kGlyphGutter = 32.0F;
		constexpr float kLeaderGap = 6.0F;
		constexpr float kCardPad = 8.0F;

		void drawHairline(float width, Foundation::Color ink, int32_t key) {
			Renderer::Primitives::drawRect(
				{.bounds = {0.0F, 0.0F, width, 1.0F}, .style = {.fill = atlas::withAlpha(ink, 0.14F)}, .key = key}
			);
		}

		ui::Layout rowLayout(const ui::Layout& given, ui::FlexDirection direction, ui::Edges padding) {
			ui::Layout layout = given;
			layout.display = ui::Display::Flex;
			layout.flexDirection = direction;
			layout.alignItems = direction == ui::FlexDirection::Row ? ui::AlignItems::Center : ui::AlignItems::Stretch;
			layout.gap = direction == ui::FlexDirection::Row ? kLeaderGap : 2.0F;
			layout.padding = padding;
			layout.flexShrink = 0.0F;
			return layout;
		}

	} // namespace

	DestinationRow::DestinationRow(const Args& args)
		: label(args.label),
		  value(args.value),
		  glyph(args.glyph),
		  stronghold(args.stronghold),
		  dim(args.dim),
		  startChosen(args.chosen),
		  onPress(args.onPress) {}

	void DestinationRow::onMount() {
		Control::onMount();
		setActive(startChosen);
		setLayout(rowLayout(getLayout(), ui::FlexDirection::Row, ui::Edges(0.0F, 4.0F, 0.0F, kGlyphGutter)));
		setMinSize({0.0F, kRowHeight});
		const std::string id = getId();
		const ui::Style	  fade{.color = getContext()->getTheme().get(palette::fadedPrint)};
		labelText = addChild<ui::Text>({
			.id = id + "_label",
			.minSize = {0.0F, 0.0F},
			.layout = {.flexShrink = 1.0F},
			.style = dim ? styles::rowLabel.extend(fade) : styles::rowLabel,
			.text = label,
		});
		// The leaders' room, which takes what the label leaves; the row draws the dots.
		addChild<ui::Component>({.minSize = {12.0F, 1.0F}, .layout = {.flexGrow = 1.0F}, .pointerEvents = ui::PointerEvents::None});
		valueText = addChild<ui::Text>({
			.id = id + "_value",
			.layout = {.flexShrink = 0.0F},
			.style = styles::caption,
			.text = value,
		});
	}

	void DestinationRow::render() {
		Control::render();
		const ui::Theme&		theme = getContext()->getTheme();
		const float				alpha = opacity();
		const int32_t			key = drawKey();
		const Foundation::Color ink = atlas::withAlpha(theme.get(palette::ink), alpha);
		drawHairline(size.x, theme.get(palette::ink), key);
		const Foundation::Vec2 centre{kGlyphRadius + 2.0F, size.y * 0.5F};
		if (stronghold) {
			atlas::drawDiamond(centre, kGlyphRadius * 1.6F, atlas::withAlpha(theme.get(palette::stronghold), alpha), key);
		} else {
			atlas::drawCircled(centre, kGlyphRadius, glyph, dim ? atlas::withAlpha(theme.get(palette::fadedPrint), alpha) : ink, key);
		}
		const ui::Text* shownLabel = labelText.get();
		const ui::Text* shownValue = valueText.get();
		if (shownLabel == nullptr || shownValue == nullptr) {
			return;
		}
		const Foundation::Rect labelBox = shownLabel->getBounds();
		const Foundation::Rect valueBox = shownValue->getBounds();
		const float			   from = labelBox.x + std::min(labelBox.width, shownLabel->measureExtent().size.x) + kLeaderGap;
		const float			   to = valueBox.x - kLeaderGap;
		if (to - from < 12.0F) {
			return;
		}
		const float baseline = valueBox.y + valueBox.height - 4.0F;
		Renderer::Primitives::drawLine({
			.start = {from, baseline},
			.end = {to, baseline},
			.style = {.color = atlas::withAlpha(ink, 0.6F), .width = 1.2F, .dash = atlas::kLeaderDots},
			.key = key,
		});
	}

	void DestinationRow::activate() {
		if (onPress) {
			onPress();
		}
	}

	RouteCard::RouteCard(const Args& args)
		: name(args.name),
		  facts(args.facts),
		  note(args.note),
		  warn(args.warn),
		  dim(args.dim),
		  startChosen(args.chosen),
		  onPress(args.onPress) {}

	void RouteCard::onMount() {
		Control::onMount();
		setActive(startChosen);
		setLayout(rowLayout(getLayout(), ui::FlexDirection::Column, ui::Edges(kCardPad, 6.0F, kCardPad, 6.0F)));
		const std::string id = getId();
		const ui::Style	  fade{.color = getContext()->getTheme().get(palette::fadedPrint)};
		addChild<ui::Text>(
			{.id = id + "_name", .style = dim ? styles::rowLabel.extend(fade) : styles::rowLabel, .text = name, .wrap = true}
		);
		addChild<ui::Text>({.id = id + "_facts", .style = styles::caption, .text = facts, .wrap = true});
		if (!note.empty()) {
			addChild<ui::Text>({.id = id + "_note", .style = warn ? styles::warning : styles::note, .text = note, .wrap = true});
		}
	}

	void RouteCard::render() {
		Control::render();
		drawHairline(size.x, getContext()->getTheme().get(palette::ink), drawKey());
	}

	void RouteCard::activate() {
		if (onPress) {
			onPress();
		}
	}

} // namespace game
