// Settings: what the App keeps in the user settings file (vsync, fullscreen, the ui's scale, and reduced motion), each
// applied at once and the file saved, since the App never saves it itself.

#include "scenes/GameScene.h"

#include <ui/components/SegmentedControl.h>
#include <ui/components/Toggle.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>

namespace game {

	namespace {

		constexpr std::array<float, 3> kUiScales{1.0F, 1.25F, 1.5F};

		class SettingsScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kSettings; }

			std::string exportState() const override {
				return nlohmann::json{
					{"vsync", app().settings().get<bool>("video.vsync", true)},
					{"fullscreen", app().fullscreenMonitor().has_value()},
					{"uiScale", app().uiScale()},
					{"reducedMotion", app().reducedMotion()},
				}
					.dump();
			}

		  protected:
			void enter() override {
				page = kit::openPage(*this, page, "Settings");
				ui::Ref<ui::Component> video = kit::panel(page, "Video", "video");
				video.addChild<ui::Toggle>({
					.id = "vsync",
					.label = "Vsync",
					.on = app().settings().get<bool>("video.vsync", true),
					.onChange = [this](bool on) {
						app().setVsync(on);
						saved();
					},
				});
				video.addChild<ui::Toggle>({
					.id = "fullscreen",
					.label = "Fullscreen",
					.on = app().fullscreenMonitor().has_value(),
					.onChange = [this](bool on) {
						app().setFullscreen(on ? std::optional<int>(0) : std::nullopt);
						saved();
					},
				});
				ui::Ref<ui::Component> look = kit::panel(page, "Interface", "interface");
				const float			   scale = app().uiScale();
				const auto nearest = std::ranges::min_element(kUiScales, {}, [scale](float option) { return std::abs(option - scale); });
				look.addChild<ui::SegmentedControl>({
					.id = "ui_scale",
					.options = {"100%", "125%", "150%"},
					.selected = static_cast<int>(nearest - kUiScales.begin()),
					.onChange = [this](int index) {
						app().setUiScale(kUiScales[static_cast<size_t>(index)]);
						saved();
					},
				});
				look.addChild<ui::Toggle>({
					.id = "reduced_motion",
					.label = "Reduced motion",
					.on = app().reducedMotion(),
					.onChange = [this](bool on) {
						app().setReducedMotion(on);
						saved();
					},
				});
				kit::button(page.footer, "back", "Back", [this] { app().scenes().switchTo(scenes::kMainMenu); });
			}

		  private:
			void saved() {
				if (!app().settings().save()) {
					LOG_ERROR(Game, "SettingsScene: the settings file couldn't be saved");
					kit::setNotice(page, "The settings couldn't be saved.");
				}
			}
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeSettingsScene() {
		return std::make_unique<SettingsScene>();
	}

} // namespace game
