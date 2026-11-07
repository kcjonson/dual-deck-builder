// The credits, an appendix of the atlas (UI Art Direction, Screens): a legend box a section, in a column that scrolls
// once it outgrows the room the title leaves, Page Up and Page Down included. It has no primary action, so no highway;
// the tabs go back to the menu, as Escape does.

#include "scenes/credits/Credits.h"

#include "atlas/AtlasTheme.h"
#include "atlas/LegendBox.h"
#include "atlas/Tokens.h"
#include "scenes/AtlasPage.h"
#include "scenes/GameScene.h"

#include <nlohmann/json.hpp>

#include <string>

namespace game {

	const std::vector<CreditSection>& credits() {
		static const std::vector<CreditSection> kCredits{
			{.heading = "Wasteland Wheels",
			 .entries =
				 {{.name = "A roguelike deckbuilder of vehicular combat",
				   .lines = {"Released under the PolyForm Noncommercial License 1.0.0."}}}},
			{.heading = "Development", .entries = {{.name = "Kevin Jonson"}, {.name = "Alan Hudson"}}},
			{.heading = "Typefaces",
			 .entries =
				 {
					 {.name = "Barlow Condensed",
					  .lines = {"Copyright 2017 The Barlow Project Authors", "SIL Open Font License 1.1"},
					  .asset = "barlow-condensed"},
					 {.name = "Open Sans",
					  .lines = {"Copyright 2020 The Open Sans Project Authors", "SIL Open Font License 1.1"},
					  .asset = "open-sans"},
					 {.name = "JetBrains Mono",
					  .lines = {"Copyright 2020 The JetBrains Mono Project Authors", "SIL Open Font License 1.1"},
					  .asset = "jetbrains-mono"},
				 }},
			{.heading = "Built with",
			 .entries = {
				 {.name = "C++20 on salal", .lines = {"OpenGL, GLFW, GLEW, GLM, nlohmann/json, stb, nanosvg, and cpp-httplib"}},
				 {.name = "msdfgen and msdf-atlas-gen", .lines = {"The faces' and icons' distance fields, by Viktor Chlumsky"}},
			 }},
		};
		return kCredits;
	}

	namespace {

		namespace styles = atlas::styles::print;

		constexpr float kListWidth = 560.0F;

		class CreditsScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kCredits; }

			std::string exportState() const override { return nlohmann::json{{"sections", credits().size()}}.dump(); }

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				const AtlasPage opened = openAtlasPage(
					*this,
					sheetPage,
					{
						.identity = scenes::kCredits,
						.title = "Credits",
						.tabs = appendixTabs(app(), "tab_credits"),
						.onKeyDown = [this](ui::KeyEvent& event) { keys(event); },
					}
				);
				list = opened.body.addChild<ui::Component>({
					.id = "credits_list",
					.size = {kListWidth, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.maxSize = {ui::percent(100.0F), ui::kAuto},
					.layout =
						[] {
							ui::Layout layout{
								.display = ui::Display::Flex,
								.flexDirection = ui::FlexDirection::Column,
								.gap = 14.0F,
								.alignItems = ui::AlignItems::Stretch,
							};
							layout.flexShrink = 1.0F;
							return layout;
						}(),
					.overflow = ui::Overflow::Scroll,
				});
				int index = 0;
				for (const CreditSection& section : credits()) {
					ui::Ref<atlas::LegendBox> box = list.addChild<atlas::LegendBox>({
						.id = "credits_" + std::to_string(index++),
						.layout = {.flexShrink = 0.0F},
						.look = {.seed = atlas::paperSeed("credits/" + section.heading)},
						.title = section.heading,
					});
					for (const CreditEntry& entry : section.entries) {
						ui::Ref<ui::Component> block = box.addChild<ui::Component>({
							.layout = {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = 2.0F},
						});
						block.addChild<ui::Text>({.style = styles::rowLabel, .text = entry.name, .wrap = true});
						for (const std::string& line : entry.lines) {
							block.addChild<ui::Text>({.style = styles::note, .text = line, .wrap = true});
						}
					}
				}
			}

		  private:
			void keys(ui::KeyEvent& event) {
				if (event.type == ui::KeyEvent::Type::Cancel) {
					app().scenes().switchTo(scenes::kMainMenu);
					event.consume();
					return;
				}
				if (event.type == ui::KeyEvent::Type::Down &&
					(event.key == foundation::Key::PageDown || event.key == foundation::Key::PageUp)) {
					if (ui::Component* scrolled = list.get()) {
						const float page = scrolled->getSize().y * 0.9F;
						scrolled->scrollBy({0.0F, event.key == foundation::Key::PageDown ? page : -page});
					}
					event.consume();
				}
			}

			AtlasPage			   sheetPage;
			ui::Ref<ui::Component> list;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCreditsScene() {
		return std::make_unique<CreditsScene>();
	}

} // namespace game
