// Settings, an appendix of the atlas (UI Art Direction, Screens): what the App keeps in the user settings file (vsync,
// fullscreen, the ui's scale, and motion: system, reduced, or full) in legend boxes, each applied at once and the file saved, since the
// App never saves it itself. It has no primary action, so no highway; the tabs go back to the menu, as Escape does.

#include "atlas/AtlasTheme.h"
#include "atlas/LegendBox.h"
#include "atlas/Tokens.h"
#include "scenes/AtlasPage.h"
#include "scenes/GameScene.h"
#include "scenes/settings/MotionSetting.h"

#include <ui/components/SegmentedControl.h>
#include <ui/components/Toggle.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <optional>
#include <string>
#include <utility>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;

		constexpr std::array<float, 3> kUiScales{1.0F, 1.25F, 1.5F};
		constexpr float				   kBoxWidth = 560.0F;

		class SettingsScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kSettings; }

			std::string exportState() const override {
				return nlohmann::json{
					{"vsync", app().settings().get<bool>("video.vsync", true)},
					{"fullscreen", app().fullscreenMonitor().has_value()},
					{"uiScale", app().uiScale()},
					{"motion", static_cast<int>(savedMotion(app()))},
					{"reducedMotion", app().reducedMotion()},
					{"notice", notice},
				}
					.dump();
			}

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override { build(); }

		  private:
			void build() {
				const AtlasPage opened = openAtlasPage(
					*this,
					sheetPage,
					{
						.identity = scenes::kSettings,
						.title = "Settings",
						.tabs = appendixTabs(app(), "tab_settings"),
						.onKeyDown = [this](ui::KeyEvent& event) {
							if (event.type == ui::KeyEvent::Type::Cancel) {
								app().scenes().switchTo(scenes::kMainMenu);
								event.consume();
							}
						},
					}
				);

				ui::Ref<atlas::LegendBox> video = box(opened.body, "video", "Video");
				toggleRow(video, "vsync", "Vsync", app().settings().get<bool>("video.vsync", true), [this](bool on) {
					app().setVsync(on);
					saved();
				});
				toggleRow(video, "fullscreen", "Fullscreen", app().fullscreenMonitor().has_value(), [this](bool on) {
					app().setFullscreen(on ? std::optional<int>(0) : std::nullopt);
					saved();
				});

				ui::Ref<atlas::LegendBox> look = box(opened.body, "interface", "Interface");
				const float				  scale = app().uiScale();
				const auto nearest = std::ranges::min_element(kUiScales, {}, [scale](float option) { return std::abs(option - scale); });
				ui::Ref<ui::Component> scaleRow = row(look, "Interface scale");
				scaleRow.addChild<ui::SegmentedControl>({
					.id = "ui_scale",
					.options = {"100%", "125%", "150%"},
					.selected = static_cast<int>(nearest - kUiScales.begin()),
					.onChange = [this](int index) {
						app().setUiScale(kUiScales.at(static_cast<size_t>(index)));
						saved();
					},
				});
				ui::Ref<ui::Component> motionRow = row(look, "Reduce motion");
				motionRow.addChild<ui::SegmentedControl>({
					.id = "motion",
					.options = {"System", "Reduced", "Full"},
					.selected = static_cast<int>(savedMotion(app())),
					.onChange = [this](int index) {
						chooseMotion(app(), static_cast<MotionSetting>(index));
						saved();
					},
				});
				look.addChild<ui::Text>({
					.id = "reduced_motion_note",
					.style = styles::note,
					.text = "System follows your device's reduced motion setting where the engine can read it; for now it plays full "
							"motion. Reduced finishes every animation at once: screen fades, card movement, and combat effects.",
					.wrap = true,
				});
				// Hidden until a save fails, so a failure never rebuilds the page under the control that changed.
				noticeLine = opened.body.addChild<ui::Text>(
					{.id = "notice", .visible = false, .style = styles::warning, .text = "The settings couldn't be saved."}
				);
			}

			ui::Ref<atlas::LegendBox> box(ui::Ref<ui::Component> body, const std::string& id, const std::string& title) {
				return body.addChild<atlas::LegendBox>({
					.id = id,
					.size = {kBoxWidth, ui::kAuto},
					.maxSize = {ui::percent(100.0F), ui::kAuto},
					.layout = {.flexShrink = 0.0F},
					.look = {.seed = atlas::paperSeed("settings/" + id), .grab = atlas::Corner::BottomRight},
					.title = title,
				});
			}

			// A setting's row: its name, and the control at the right.
			static ui::Ref<ui::Component> row(ui::Ref<atlas::LegendBox> box, const std::string& label) {
				ui::Ref<ui::Component> line = box.addChild<ui::Component>({
					.minSize = {0.0F, 36.0F},
					.layout = {
						.display = ui::Display::Flex,
						.flexDirection = ui::FlexDirection::Row,
						.gap = 16.0F,
						.alignItems = ui::AlignItems::Center
					},
				});
				line.addChild<ui::Text>({.minSize = {0.0F, 0.0F}, .layout = {.flexGrow = 1.0F}, .style = styles::body, .text = label});
				return line;
			}

			static void toggleRow(
				ui::Ref<atlas::LegendBox> box,
				const std::string&		  id,
				const std::string&		  label,
				bool					  on,
				std::function<void(bool)> onChange
			) {
				row(box, label).addChild<ui::Toggle>({.id = id, .on = on, .onChange = std::move(onChange)});
			}

			void saved() {
				if (!app().settings().save()) {
					LOG_ERROR(Game, "SettingsScene: the settings file couldn't be saved");
					notice = true;
					if (ui::Text* line = noticeLine.get()) {
						line->setVisible(true);
					}
				}
			}

			AtlasPage		  sheetPage;
			ui::Ref<ui::Text> noticeLine;
			bool			  notice = false;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeSettingsScene() {
		return std::make_unique<SettingsScene>();
	}

} // namespace game
