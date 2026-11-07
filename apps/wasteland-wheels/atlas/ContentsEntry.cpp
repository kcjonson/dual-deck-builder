#include "atlas/ContentsEntry.h"

#include "atlas/Glyphs.h"
#include "atlas/Ink.h"
#include "atlas/Markers.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <algorithm>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;
		namespace printed = styles::print;

		constexpr float kLeaderGap = 6.0F;
		constexpr float kRule = 1.4F;

		struct Sizing {
			float minHeight;
			float marker; // the lead's extent
			float pad;	  // above and below
			float label;  // px
		};

		Sizing sizing(EntrySize entrySize) {
			switch (entrySize) {
				case EntrySize::Primary:
					return {.minHeight = 76.0F, .marker = 44.0F, .pad = 10.0F, .label = 32.0F};
				case EntrySize::Row:
					return {.minHeight = 58.0F, .marker = 30.0F, .pad = 8.0F, .label = 26.0F};
				case EntrySize::Appendix:
					break;
			}
			return {.minHeight = 44.0F, .marker = 20.0F, .pad = 6.0F, .label = 20.0F};
		}

	} // namespace

	ContentsEntry::ContentsEntry(const Args& args)
		: label(args.label),
		  line(args.line),
		  value(args.value),
		  lead(args.lead),
		  leadText(args.leadText),
		  entrySize(args.entrySize),
		  warnLine(args.warnLine),
		  record(args.record),
		  onPress(args.onPress) {}

	void ContentsEntry::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		node["label"] = label;
		node["line"] = line;
		node["value"] = value;
	}

	void ContentsEntry::onMount() {
		ui::Control::onMount();
		if (record) {
			setFocusable(false);
			setPointerEvents(ui::PointerEvents::None);
		}
		const Sizing	  sized = sizing(entrySize);
		const bool		  faded = !isEnabled();
		const ui::Theme&  theme = getContext()->getTheme();
		const ui::Style	  fade{.color = theme.get(palette::fadedPrint)};
		const std::string id = getId();

		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::Center;
		layout.gap = entrySize == EntrySize::Appendix ? 8.0F : 16.0F;
		layout.padding = ui::Edges(sized.pad, 8.0F, sized.pad, entrySize == EntrySize::Appendix ? 0.0F : 8.0F);
		layout.flexShrink = 0.0F;
		setLayout(layout);
		setMinSize({0.0F, sized.minHeight});

		switch (lead) {
			case EntryLead::Shield:
				addChild<Marker>({.kind = MarkerKind::Shield, .text = leadText, .extent = sized.marker, .faded = faded});
				break;
			case EntryLead::Circled:
			case EntryLead::Ring:
				addChild<Marker>({
					.kind = MarkerKind::Circled,
					.text = lead == EntryLead::Ring ? std::string() : leadText,
					.extent = sized.marker,
					.faded = faded || lead == EntryLead::Ring,
				});
				break;
			case EntryLead::Deck:
				addChild<IconStack>(deckGlyph(id.empty() ? std::string() : id + "_glyph"));
				break;
			case EntryLead::None:
				break;
		}

		ui::Ref<ui::Component> body = addChild<ui::Component>({
			.minSize = {0.0F, 0.0F},
			.layout = [] {
				ui::Layout column{.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = 2.0F};
				column.flexGrow = 1.0F;
				return column;
			}(),
		});
		ui::Ref<ui::Component> top = body.addChild<ui::Component>({
			.layout = {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = kLeaderGap, .alignItems = ui::AlignItems::End
			},
		});
		const ui::Style		   labelStyle = printed::rowLabel.extend({.fontSize = sized.label});
		labelText = top.addChild<ui::Text>({
			.id = id.empty() ? std::string() : id + "_label",
			.minSize = {0.0F, 0.0F},
			.style = faded ? labelStyle.extend(fade) : labelStyle,
			.text = label,
			.wrap = true,
		});
		// The leaders' room, which takes what the label leaves; the entry draws the dots.
		top.addChild<ui::Component>({.minSize = {12.0F, 1.0F}, .layout = {.flexGrow = 1.0F}, .pointerEvents = ui::PointerEvents::None});
		if (!value.empty()) {
			const ui::Style valueStyle = entrySize == EntrySize::Appendix ? printed::caption : printed::figure;
			valueText = top.addChild<ui::Text>({
				.id = id.empty() ? std::string() : id + "_value",
				.layout = {.flexShrink = 0.0F},
				.style = faded ? valueStyle.extend(fade) : valueStyle,
				.text = value,
			});
		}
		if (!line.empty()) {
			body.addChild<ui::Text>({
				.id = id.empty() ? std::string() : id + "_line",
				.style = warnLine ? printed::warning : printed::note,
				.text = line,
				.wrap = true,
			});
		}
	}

	void ContentsEntry::render() {
		ui::Control::render();
		const ui::Theme&		theme = getContext()->getTheme();
		const float				alpha = opacity();
		const int32_t			key = drawKey();
		const bool				faded = !isEnabledInTree();
		const Foundation::Color ink = withAlpha(theme.get(palette::ink), alpha);
		if (entrySize == EntrySize::Primary) {
			for (const float at : {0.0F, size.y - kRule}) {
				Renderer::Primitives::drawRect({.bounds = {0.0F, at, size.x, kRule}, .style = {.fill = ink}, .key = key});
			}
		} else {
			Renderer::Primitives::drawRect(
				{.bounds = {0.0F, size.y - 1.0F, size.x, 1.0F}, .style = {.fill = withAlpha(ink, 0.22F)}, .key = key}
			);
		}

		const ui::Text* shownLabel = labelText.get();
		const ui::Text* shownValue = valueText.get();
		if (shownLabel == nullptr || shownValue == nullptr) {
			return;
		}
		// The text boxes are in their row's space, which is the entry's moved by the row's place in it.
		const ui::Component* top = shownLabel->parent().get();
		const ui::Component* body = top != nullptr ? top->parent().get() : nullptr;
		if (body == nullptr) {
			return;
		}
		const Foundation::Vec2 origin = body->getPosition() + top->getPosition();
		const Foundation::Rect labelBox = shownLabel->getBounds();
		const Foundation::Rect valueBox = shownValue->getBounds();
		const float			   from = origin.x + labelBox.x + std::min(labelBox.width, shownLabel->measureExtent().size.x) + kLeaderGap;
		const float			   to = origin.x + valueBox.x - kLeaderGap;
		if (to - from < 12.0F) {
			return;
		}
		const float baseline = origin.y + valueBox.y + valueBox.height - 4.0F;
		Renderer::Primitives::drawLine({
			.start = {from, baseline},
			.end = {to, baseline},
			.style =
				{.color = faded ? withAlpha(theme.get(palette::fadedPrint), alpha) : withAlpha(ink, 0.6F),
				 .width = 1.2F,
				 .dash = kLeaderDots},
			.key = key,
		});
	}

	void ContentsEntry::activate() {
		if (onPress) {
			onPress();
		}
	}

} // namespace game::atlas
