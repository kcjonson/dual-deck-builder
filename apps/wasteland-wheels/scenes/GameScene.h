#pragma once

#include "GameContext.h"
#include "scenes/SceneKit.h"
#include "scenes/Scenes.h"

#include <application/App.h>
#include <primitives/Primitives.h>
#include <scene/Scene.h>
#include <ui/theme/Tokens.h>
#include <utils/Log.h>

namespace game {

	// What every scene of the game shares: the App and the game's context from onEnter on, the page it shows, and a
	// clear in the theme's base surface under it.
	template <typename A = app::NoArgs, typename R = app::NoResult>
	class GameScene : public app::TypedScene<A, R> {
	  public:
		void onEnter(app::App& app) final {
			owner = &app;
			enter();
		}

		void render(float /*alpha*/) override { Renderer::Primitives::clear(this->ui().getTheme().get(ui::tokens::color::surface::base)); }

	  protected:
		// onEnter's work, with app() and game() there.
		virtual void enter() = 0;

		[[nodiscard]] app::App&	   app() const { return *owner; }
		[[nodiscard]] GameContext& game() const { return owner->context<GameContext>(); }

		// The campaign being played. A scene that plays one, entered without it (from the dev server or the command line,
		// say), says so and goes back to the main menu, and this is null.
		[[nodiscard]] Session* sessionOrMenu() {
			if (!game().session) {
				LOG_ERROR(Game, "%s: no campaign is being played; back to the main menu", this->name());
				app().scenes().switchTo(scenes::kMainMenu);
				return nullptr;
			}
			return &*game().session;
		}

		kit::Page page;

	  private:
		app::App* owner = nullptr;
	};

} // namespace game
