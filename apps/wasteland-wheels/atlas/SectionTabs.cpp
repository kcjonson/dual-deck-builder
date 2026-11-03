#include "atlas/SectionTabs.h"

#include "atlas/Glyphs.h"
#include "atlas/Ink.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <optional>

namespace game::atlas {

	namespace {

		namespace palette = tokens::palette;

		constexpr float kBorder = 1.4F;
		constexpr float kHeight = 44.0F; // the least a hit target is
		constexpr float kActiveDrop = 4.0F;
		constexpr float kFocusReach = 5.0F;
		// Open at the top, where it hangs from the sheet's edge.
		constexpr Foundation::BorderSides kHanging{.top = false};

	} // namespace

	SectionTab::SectionTab(const Args& args)
		: label(args.label),
		  current(args.active),
		  deckGlyph(args.deckGlyph),
		  onPress(args.onPress) {}

	float SectionTab::inkExtent() const {
		return kFocusReach;
	}

	void SectionTab::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		node["label"] = label;
		node["current"] = current;
	}

	void SectionTab::onMount() {
		ui::Control::onMount();
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::Center;
		layout.gap = 6.0F;
		layout.padding = ui::Edges(6.0F, 16.0F, 8.0F, 16.0F);
		setLayout(layout);
		setMinSize({0.0F, kHeight + (current ? kActiveDrop : 0.0F)});
		const std::string id = getId();
		if (deckGlyph) {
			addChild<IconStack>(game::atlas::deckGlyph(id.empty() ? std::string() : id + "_deck"));
		}
		addChild<ui::Text>({
			.id = id.empty() ? std::string() : id + "_label",
			.style = current ? styles::print::sectionTabActive : styles::print::sectionTab,
			.text = label,
		});
	}

	void SectionTab::render() {
		const ui::Theme&		   theme = getContext()->getTheme();
		const float				   alpha = opacity();
		const bool				   enabled = isEnabledInTree();
		const int32_t			   key = drawKey();
		const ui::InteractionState state = interaction();
		const bool				   lit = current || (enabled && state.hovered);
		const Foundation::Color	   ink = withAlpha(theme.get(palette::ink), alpha);
		drawPaper({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.tint = withAlpha(theme.get(lit ? palette::freshPaper : palette::index), alpha),
			.look = {.seed = paperSeed(getId()), .wear = current ? Wear::Clean : Wear::Handled, .grab = Corner::BottomLeft},
			.border =
				Foundation::BorderStyle{
					.color = enabled ? ink : withAlpha(theme.get(palette::backRoad), alpha),
					.width = kBorder,
					.position = Foundation::BorderPosition::Inside,
					.sides = kHanging,
					.dash = enabled ? std::nullopt : std::optional(kDisabledDash),
				},
			.id = getId().empty() ? nullptr : getId().c_str(),
			.key = key,
		});
		if (state.focusVisible) {
			Renderer::Primitives::drawRect({
				.bounds = {-kFocusReach, 0.0F, size.x + 2.0F * kFocusReach, size.y + kFocusReach},
				.style =
					{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
					 .border =
						 Foundation::BorderStyle{
							 .color = ink, .width = 2.0F, .position = Foundation::BorderPosition::Inside, .sides = kHanging
						 }},
				.key = key,
			});
		}
	}

	void SectionTab::activate() {
		if (onPress && !current) {
			onPress();
		}
	}

	ui::Ref<ui::Component> sectionTabs(ui::Ref<ui::Component> parent, const std::vector<TabSpec>& tabs) {
		ui::Ref<ui::Component> row = parent.addChild<ui::Component>({
			.id = "section_tabs",
			.layout = {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = 6.0F, .alignItems = ui::AlignItems::Start
			},
		});
		for (const TabSpec& tab : tabs) {
			row.addChild<SectionTab>({
				.id = tab.id,
				.enabled = tab.enabled,
				.label = tab.label,
				.active = tab.active,
				.deckGlyph = tab.deckGlyph,
				.onPress = tab.onPress,
			});
		}
		return row;
	}

} // namespace game::atlas
