// The splash: the game's name for a moment at launch, then the main menu; a press or a key goes on at once.

#include "scenes/GameScene.h"

#include <nlohmann/json.hpp>

namespace game {

	namespace {

		constexpr double kSplashSeconds = 1.5;

		class SplashScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kSplash; }

			bool handleEvent(const foundation::InputEvent& event) override {
				using Type = foundation::InputEvent::Type;
				if (event.type == Type::PointerDown || event.type == Type::KeyDown || event.type == Type::ButtonDown) {
					goOn();
					return true;
				}
				return false;
			}

			void update(const app::FrameContext& frame) override {
				shown += frame.dt;
				if (shown >= kSplashSeconds) {
					goOn();
				}
			}

			std::string exportState() const override { return nlohmann::json{{"shown", shown}}.dump(); }

		  protected:
			void enter() override {
				page = kit::openPage(*this, page, "Wasteland Wheels", "Early alpha");
				kit::caption(page.body, "Press any key");
			}

		  private:
			void goOn() {
				if (!leaving) {
					leaving = true;
					app().scenes().switchTo(scenes::kMainMenu);
				}
			}

			double shown = 0.0;
			bool   leaving = false;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeSplashScene() {
		return std::make_unique<SplashScene>();
	}

} // namespace game
