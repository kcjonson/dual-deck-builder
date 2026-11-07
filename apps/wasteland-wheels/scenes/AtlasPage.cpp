#include "scenes/AtlasPage.h"

#include "Words.h"
#include "atlas/Tokens.h"
#include "scenes/Scenes.h"

#include <ui/shapes/Text.h>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;

		// The sheet's padding inside the table's margin, the tabs hanging into the top of it when there are any.
		constexpr float kPadTabbed = 0.0F;
		constexpr float kPadTop = 44.0F;

	} // namespace

	AtlasPage openAtlasPage(app::Scene& scene, AtlasPage& previous, const AtlasPageArgs& args) {
		if (previous.sheet.get() != nullptr) {
			scene.root().get()->removeChild(previous.sheet);
		}
		ui::Layout sheetLayout{
			.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = 8.0F, .alignItems = ui::AlignItems::Stretch
		};
		sheetLayout.padding = ui::Edges(args.tabs.empty() ? kPadTop : kPadTabbed, 48.0F, 50.0F, 46.0F);
		AtlasPage page;
		page.sheet = scene.root().addChild<atlas::Sheet>({
			.id = "sheet",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.layout = sheetLayout,
			.onKeyDown = args.onKeyDown,
			.identity = args.identity,
		});
		if (!args.tabs.empty()) {
			ui::Ref<ui::Component> tabs = atlas::sectionTabs(page.sheet, args.tabs);
			ui::Layout			   tabsLayout = tabs.get()->getLayout();
			tabsLayout.alignSelf = ui::AlignItems::Center;
			tabsLayout.flexShrink = 0.0F;
			tabs.get()->setLayout(tabsLayout);
			// Focus starts on the first tab, Menu, so the keys reach the sheet and Enter goes back.
			if (ui::Component* first = scene.ui().find(tabs.get()->getChildren().front())) {
				first->focus();
			}
		}
		ui::Ref<ui::Component> heading = page.sheet.addChild<ui::Component>({
			.id = "heading",
			.layout = [] {
				ui::Layout layout{
					.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = 16.0F, .alignItems = ui::AlignItems::End
				};
				layout.flexShrink = 0.0F;
				return layout;
			}(),
		});
		heading.addChild<ui::Text>({
			.id = "title",
			.style = styles::screenTitle.extend({.textTransform = Foundation::TextTransform::Uppercase}),
			.text = args.title,
		});
		if (!args.subtitle.empty()) {
			heading.addChild<ui::Text>({.id = "subtitle", .style = styles::subtitle, .text = args.subtitle});
		}
		page.body = page.sheet.addChild<ui::Component>({
			.id = "body",
			.minSize = {0.0F, 0.0F},
			.layout = [] {
				ui::Layout layout{
					.display = ui::Display::Flex,
					.flexDirection = ui::FlexDirection::Column,
					.gap = 18.0F,
					.alignItems = ui::AlignItems::Center,
				};
				layout.padding = ui::Edges(18.0F, 0.0F, 0.0F, 0.0F);
				layout.flexGrow = 1.0F;
				return layout;
			}(),
		});
		previous = page;
		return page;
	}

	std::vector<atlas::TabSpec> appendixTabs(app::App& app, const std::string& active) {
		const auto tab = [&](const std::string& id, const char* label, const char* scene) {
			return atlas::TabSpec{
				.id = id,
				.label = label,
				.active = id == active,
				.onPress = [&app, scene] { app.scenes().switchTo(scene); },
			};
		};
		return {
			tab("main_menu", "Menu", scenes::kMainMenu),
			tab("tab_campaign_history", "Campaign history", scenes::kCampaignHistory),
			tab("tab_settings", "Settings", scenes::kSettings),
			tab("tab_credits", "Credits", scenes::kCredits),
		};
	}

	namespace {

		constexpr float kBoxWidth = 560.0F;

		ui::Ref<atlas::LegendBox> centredBox(ui::Ref<ui::Component> body, const std::string& id, const std::string& title) {
			return body.addChild<atlas::LegendBox>({
				.id = id,
				.size = {kBoxWidth, ui::kAuto},
				.maxSize = {ui::percent(100.0F), ui::kAuto},
				.layout = {.flexShrink = 0.0F},
				.look = {.seed = atlas::paperSeed(id), .grab = atlas::Corner::BottomRight},
				.title = title,
			});
		}

		ui::Ref<ui::Component> footOf(ui::Ref<atlas::LegendBox> box) {
			return box.addChild<ui::Component>({
				.id = "actions",
				.layout = {
					.display = ui::Display::Flex,
					.flexDirection = ui::FlexDirection::Row,
					.gap = 12.0F,
					.alignItems = ui::AlignItems::Center,
					.justifyContent = ui::JustifyContent::End
				},
			});
		}

	} // namespace

	MapProgressBox mapProgressBox(ui::Ref<ui::Component> body, const std::string& kicker) {
		MapProgressBox made;
		made.box = centredBox(body, "making", "Making the area map");
		made.box.addChild<ui::Text>({.id = "for", .style = styles::caption, .text = kicker, .wrap = true});
		made.bar = made.box.addChild<atlas::ScaleBar>({.id = "stages", .size = {ui::percent(100.0F), 10.0F}, .segments = 9, .value = 0.0F});
		made.line = made.box.addChild<ui::Text>({.id = "progress", .style = styles::body, .text = "Making the area map", .wrap = true});
		made.foot = footOf(made.box);
		return made;
	}

	void showProgress(const MapProgressBox& shown, const MapProgress& progress) {
		if (atlas::ScaleBar* bar = shown.bar.get(); bar != nullptr && progress.count > 0) {
			bar->setValue(static_cast<float>(progress.index) / static_cast<float>(progress.count));
		}
		if (ui::Text* line = shown.line.get()) {
			line->setText(progressText(progress));
		}
	}

	ui::Ref<ui::Component>
	failureBox(ui::Ref<ui::Component> body, const std::string& title, const std::string& kicker, const std::string& reason) {
		ui::Ref<atlas::LegendBox> box = centredBox(body, "failed", title);
		if (!kicker.empty()) {
			box.addChild<ui::Text>({.id = "for", .style = styles::caption, .text = kicker, .wrap = true});
		}
		box.addChild<ui::Text>({.id = "failure", .style = styles::warning, .text = reason, .wrap = true});
		return footOf(box);
	}

	const char* buildLine() {
#ifdef SALAL_DEV_SERVER
		return "Development build";
#else
		return "Early alpha";
#endif
	}

} // namespace game
