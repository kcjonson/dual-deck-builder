#include "scenes/map/MapPage.h"

namespace game {

	namespace {

		constexpr float kColumnWidth = 360.0F;
		// The least height the plate and the column are laid out in; past it the body scrolls.
		constexpr float kSpreadLeast = 470.0F;

		ui::Layout grown(ui::Layout layout) {
			layout.flexGrow = 1.0F;
			return layout;
		}

		ui::Layout fixed(ui::Layout layout) {
			layout.flexShrink = 0.0F;
			return layout;
		}

	} // namespace

	ui::Layout columnLayout(float gap) {
		return {
			.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Stretch
		};
	}

	MapPage openMapPage(ui::Ref<ui::Component> root, const std::string& identity, const std::vector<atlas::TabSpec>& tabs) {
		MapPage	   page;
		ui::Layout sheetLayout = columnLayout(8.0F);
		sheetLayout.padding = ui::Edges(0.0F, 48.0F, 50.0F, 46.0F);
		page.sheet = root.addChild<atlas::Sheet>({
			.id = "sheet",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.layout = sheetLayout,
			.identity = identity,
		});
		ui::Ref<ui::Component> row = atlas::sectionTabs(page.sheet, tabs);
		ui::Layout			   tabLayout = row.get()->getLayout();
		tabLayout.alignSelf = ui::AlignItems::Center;
		tabLayout.flexShrink = 0.0F;
		row.get()->setLayout(tabLayout);

		ui::Ref<ui::Component> body = page.sheet.addChild<ui::Component>({
			.id = "body",
			.minSize = {0.0F, 0.0F},
			.layout = grown(columnLayout(0.0F)),
			.overflow = ui::Overflow::Scroll,
		});
		ui::Layout			   spreadLayout{
						.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = 30.0F, .alignItems = ui::AlignItems::Stretch
		};
		ui::Ref<ui::Component> spread = body.addChild<ui::Component>({
			.id = "spread",
			.minSize = {0.0F, kSpreadLeast},
			.layout = grown(spreadLayout),
		});
		page.plate = spread.addChild<ui::Component>({.id = "plate_column", .minSize = {0.0F, 0.0F}, .layout = grown(columnLayout(10.0F))});
		page.heading = page.plate.addChild<ui::Component>({
			.id = "heading",
			.layout = fixed(
				{.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = 16.0F, .alignItems = ui::AlignItems::End}
			),
		});
		ui::Ref<ui::Component> column = spread.addChild<ui::Component>({
			.id = "orders",
			.size = {kColumnWidth, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = fixed(columnLayout(14.0F)),
		});
		page.boxes = column.addChild<ui::Component>({.id = "boxes", .minSize = {0.0F, 0.0F}, .layout = grown(columnLayout(14.0F))});
		page.primary = column.addChild<ui::Component>({.id = "primary", .layout = fixed(columnLayout(8.0F))});
		return page;
	}

} // namespace game
