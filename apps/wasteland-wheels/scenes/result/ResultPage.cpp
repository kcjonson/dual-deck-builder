#include "scenes/result/ResultPage.h"

#include "atlas/ArtView.h"
#include "atlas/Tokens.h"

#include <ui/Context.h>
#include <ui/shapes/Text.h>

#include <utility>

namespace game::result {

	namespace {

		namespace styles = atlas::styles::print;

		// The stamp's width, its height in proportion: the stamps are drawn 200 by 104.
		constexpr float kStampWidth = 180.0F;
		constexpr float kStoryWidth = 600.0F;

		ui::Layout column(float gap) {
			return {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Start
			};
		}

		ui::Layout row(float gap, ui::AlignItems align = ui::AlignItems::Center) {
			return {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = align};
		}

		ui::Style tinted(const ui::Style& style, ui::Ref<ui::Component> on, ui::ColorToken token) {
			return style.extend({.color = on.get()->getContext()->getTheme().get(token)});
		}

	} // namespace

	Page openPage(ui::Ref<ui::Component> root, const PageArgs& args) {
		ui::Layout sheetLayout = column(18.0F);
		sheetLayout.alignItems = ui::AlignItems::Stretch;
		sheetLayout.padding = ui::Edges(48.0F, 50.0F, 50.0F, 46.0F);
		Page page;
		page.sheet = root.addChild<atlas::Sheet>({
			.id = "sheet",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.layout = sheetLayout,
			.identity = args.identity,
			.mark = args.mark,
		});

		const Heading&		   heading = args.heading;
		ui::Ref<ui::Component> head = page.sheet.addChild<ui::Component>({
			.id = "heading",
			.layout = [] {
				ui::Layout layout = row(28.0F);
				layout.alignSelf = ui::AlignItems::Start;
				layout.flexShrink = 0.0F;
				return layout;
			}(),
		});
		ui::Ref<ui::Component> words = head.addChild<ui::Component>({.layout = column(6.0F)});
		words.addChild<ui::Text>({.id = "heading_kicker", .style = styles::kicker, .text = heading.kicker});
		words.addChild<ui::Text>({
			.id = "heading_title",
			.style = heading.hostile ? tinted(styles::screenTitle, head, atlas::tokens::palette::stronghold) : styles::screenTitle,
			.text = heading.title,
		});
		if (!heading.story.empty()) {
			words.addChild<ui::Text>(
				{.id = "heading_story", .size = {kStoryWidth, ui::kAuto}, .style = styles::subtitle, .text = heading.story, .wrap = true}
			);
		}
		if (!heading.stamp.empty()) {
			head.addChild<atlas::ArtView>({.id = "stamp", .size = {kStampWidth, ui::kAuto}, .art = heading.stamp});
		}

		page.body = page.sheet.addChild<ui::Component>({
			.id = "body",
			.minSize = {0.0F, 0.0F},
			.layout =
				[] {
					ui::Layout layout = row(16.0F, ui::AlignItems::Start);
					layout.flexWrap = ui::FlexWrap::Wrap;
					layout.flexGrow = 1.0F;
					return layout;
				}(),
			.overflow = ui::Overflow::Scroll,
		});

		page.foot = page.sheet.addChild<ui::Component>({
			.id = "foot",
			.layout = [] {
				ui::Layout layout = row(24.0F);
				layout.justifyContent = ui::JustifyContent::End;
				layout.flexShrink = 0.0F;
				return layout;
			}(),
		});
		return page;
	}

	ui::Ref<atlas::LegendBox> box(const Page& page, const std::string& id, const std::string& title, float width) {
		return page.body.addChild<atlas::LegendBox>({
			.id = id,
			.size = {width, ui::kAuto},
			.layout = {.flexShrink = 0.0F},
			.look = {.seed = atlas::paperSeed(id), .wear = atlas::Wear::Handled},
			.title = title,
		});
	}

	void row(ui::Ref<atlas::LegendBox> box, const std::string& id, atlas::MapSymbol symbol, const std::string& text, bool warning) {
		box.addChild<atlas::LegendRow>({.id = id, .symbol = symbol, .text = text, .textStyle = warning ? styles::warning : styles::body});
	}

	void footLine(const Page& page, const std::string& id, const std::string& text, bool warning) {
		page.foot.addChild<ui::Text>({
			.id = id,
			.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
			.style = warning ? styles::warning : styles::note,
			.text = text,
			.wrap = true,
		});
	}

	ui::Ref<atlas::AtlasButton> highway(const Page& page, const std::string& id, const std::string& label, std::function<void()> onPress) {
		return page.foot.addChild<atlas::AtlasButton>({
			.id = id,
			.layout = {.flexShrink = 0.0F},
			.label = label,
			.road = atlas::Road::Highway,
			.shield = true,
			.onPress = std::move(onPress),
		});
	}

} // namespace game::result
