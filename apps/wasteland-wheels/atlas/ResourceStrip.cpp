#include "atlas/ResourceStrip.h"

#include "atlas/Tokens.h"

#include <ui/shapes/Icon.h>
#include <ui/shapes/Text.h>

namespace game::atlas {

	namespace {

		constexpr float kIconSize = 18.0F;
		constexpr float kItemGap = 7.0F;
		constexpr float kStripGap = 20.0F;

		ui::Layout row(float gap) {
			return {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = ui::AlignItems::Center
			};
		}

	} // namespace

	ui::Ref<ui::Component> resourceStrip(ui::Ref<ui::Component> parent, const std::vector<Store>& stores) {
		// The strip wraps where the column is too narrow for every store on one line.
		ui::Layout stripLayout = row(kStripGap);
		stripLayout.flexWrap = ui::FlexWrap::Wrap;
		ui::Ref<ui::Component> strip = parent.addChild<ui::Component>({.id = "resource_strip", .layout = stripLayout});
		for (const Store& store : stores) {
			const ui::Style		   text = store.shortfall ? styles::print::figureShort : styles::print::figure;
			ui::Ref<ui::Component> item = strip.addChild<ui::Component>({.id = store.id, .layout = row(kItemGap)});
			item.addChild<ui::Icon>({
				.id = store.id + "_icon",
				.size = {kIconSize, kIconSize},
				.style = store.shortfall ? styles::print::figureShort : ui::Style{},
				.name = store.id,
			});
			item.addChild<ui::Text>(
				{.id = store.id + "_name",
				 .style = text.extend({.textTransform = Foundation::TextTransform::Uppercase}),
				 .text = store.name}
			);
			item.addChild<ui::Text>({.id = store.id + "_value", .style = text, .text = store.value});
		}
		return strip;
	}

} // namespace game::atlas
