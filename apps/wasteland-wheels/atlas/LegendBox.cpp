#include "atlas/LegendBox.h"

#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr float kBorder = 1.4F;
		constexpr float kInnerRule = 0.6F;
		constexpr float kInnerInset = 6.0F;
		constexpr float kRowPad = 7.0F;
		constexpr float kSymbolSize = 14.0F;
		constexpr float kSymbolGutter = 24.0F;
		constexpr float kGlyphRadius = 12.0F;
		constexpr float kGlyphGutter = 34.0F;
		constexpr float kLeaderGap = 6.0F;

		const char* nameOf(MapSymbol symbol) {
			switch (symbol) {
				case MapSymbol::Diamond:
					return "diamond";
				case MapSymbol::Ring:
					return "ring";
				case MapSymbol::Dash:
					return "dash";
			}
			return "";
		}

		void drawHairline(float width, Foundation::Color ink, int32_t key) {
			Renderer::Primitives::drawRect({.bounds = {0.0F, 0.0F, width, 1.0F}, .style = {.fill = withAlpha(ink, 0.14F)}, .key = key});
		}

	} // namespace

	LegendBox::LegendBox(const Args& args)
		: Paper(Paper::Args{.look = args.look}),
		  title(args.title) {}

	void LegendBox::onMount() {
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Column;
		layout.alignItems = ui::AlignItems::Stretch;
		layout.padding = ui::Edges(16.0F, 18.0F);
		layout.gap = 10.0F;
		setLayout(layout);
		if (!title.empty()) {
			addChild<ui::Text>({.id = getId().empty() ? std::string() : getId() + "_title", .style = styles::sectionHead, .text = title});
		}
	}

	void LegendBox::render() {
		const ui::Theme&		theme = getContext()->getTheme();
		const Foundation::Color ink = withAlpha(theme.get(palette::ink), opacity());
		const Foundation::Color fill = style.backgroundColor.value_or(theme.get(palette::paper));
		const int32_t			key = drawKey();
		drawPaper({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.tint = withAlpha(fill, opacity()),
			.look = getLook(),
			.border = Foundation::BorderStyle{.color = ink, .width = kBorder, .position = Foundation::BorderPosition::Inside},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		Renderer::Primitives::drawRect({
			.bounds = {kInnerInset, kInnerInset, size.x - 2.0F * kInnerInset, size.y - 2.0F * kInnerInset},
			.style =
				{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
				 .border = Foundation::BorderStyle{.color = ink, .width = kInnerRule, .position = Foundation::BorderPosition::Inside}},
			.key = key,
		});
	}

	LegendRow::LegendRow(const Args& args)
		: symbol(args.symbol),
		  text(args.text),
		  textStyle(args.textStyle) {}

	void LegendRow::describe(nlohmann::json& node) const {
		node["symbol"] = nameOf(symbol);
	}

	void LegendRow::onMount() {
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::Center;
		layout.padding = ui::Edges(kRowPad, 0.0F, kRowPad, kSymbolGutter);
		setLayout(layout);
		addChild<ui::Text>({
			.id = getId().empty() ? std::string() : getId() + "_text",
			.layout = {.flexGrow = 1.0F},
			.style = textStyle.theme.table == nullptr ? styles::body.extend(textStyle) : textStyle,
			.text = text,
			.wrap = true,
		});
	}

	void LegendRow::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const float		 alpha = opacity();
		const int32_t	 key = drawKey();
		drawHairline(size.x, theme.get(palette::ink), key);
		const Foundation::Vec2 centre{kSymbolSize * 0.5F, size.y * 0.5F};
		switch (symbol) {
			case MapSymbol::Diamond:
				drawDiamond(centre, kSymbolSize * 0.8F, withAlpha(theme.get(palette::stronghold), alpha), key);
				break;
			case MapSymbol::Ring:
				Renderer::Primitives::drawCircle({
					.center = centre,
					.radius = 5.0F,
					.style =
						{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
						 .border = Foundation::BorderStyle{.color = withAlpha(theme.get(palette::ink), alpha), .width = 1.6F}},
					.key = key,
				});
				break;
			case MapSymbol::Dash:
				drawDashedLine(
					{centre.x - 5.0F, centre.y},
					{centre.x + 5.0F, centre.y},
					withAlpha(theme.get(palette::fadedPrint), alpha),
					1.6F,
					{.dash = 3.0F, .gap = 2.0F},
					key
				);
				break;
		}
	}

	ContentsRow::ContentsRow(const Args& args)
		: label(args.label),
		  value(args.value),
		  glyph(args.glyph),
		  labelStyle(args.labelStyle) {}

	void ContentsRow::onMount() {
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::End;
		layout.gap = kLeaderGap;
		layout.padding = ui::Edges(kRowPad, 0.0F, kRowPad, glyph.empty() ? 0.0F : kGlyphGutter);
		setLayout(layout);
		const std::string id = getId();
		labelText = addChild<ui::Text>({
			.id = id.empty() ? std::string() : id + "_label",
			.style = labelStyle.theme.table == nullptr ? styles::rowLabel.extend(labelStyle) : labelStyle,
			.text = label,
			.wrap = true,
		});
		// The leaders' room, which takes what the label leaves; the row draws the dots.
		addChild<ui::Component>({.minSize = {16.0F, 1.0F}, .layout = {.flexGrow = 1.0F}, .pointerEvents = ui::PointerEvents::None});
		if (!value.empty()) {
			valueText = addChild<ui::Text>({
				.id = id.empty() ? std::string() : id + "_value",
				.layout = {.flexShrink = 0.0F},
				.style = styles::caption,
				.text = value,
			});
		}
	}

	void ContentsRow::render() {
		const ui::Theme&		theme = getContext()->getTheme();
		const Foundation::Color ink = withAlpha(theme.get(palette::ink), opacity());
		const int32_t			key = drawKey();
		drawHairline(size.x, theme.get(palette::ink), key);
		if (!glyph.empty()) {
			drawCircled({kGlyphRadius, size.y * 0.5F}, kGlyphRadius, glyph, ink, key);
		}
		const ui::Text* shownLabel = labelText.get();
		const ui::Text* shownValue = valueText.get();
		if (shownLabel == nullptr || shownValue == nullptr) {
			return;
		}
		const Foundation::Rect labelBox = shownLabel->getBounds();
		const Foundation::Rect valueBox = shownValue->getBounds();
		const float			   from = labelBox.x + shownLabel->measureExtent().size.x + kLeaderGap;
		const float			   to = valueBox.x - kLeaderGap;
		if (to - from < 12.0F) {
			return;
		}
		const float baseline = valueBox.y + valueBox.height - 4.0F;
		drawDashedLine({from, baseline}, {to, baseline}, withAlpha(ink, 0.6F), 1.2F, {.dash = 1.2F, .gap = 3.6F}, key);
	}

} // namespace game::atlas
