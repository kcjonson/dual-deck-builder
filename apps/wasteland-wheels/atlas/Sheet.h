#pragma once

// The screen sheet (UI Art Direction, Components): the table, a W2 sheet on it inside the 14 px margin, a double
// neatline, and duct tape at the top-left and bottom-right corners. It draws under its children, which the scene lays
// out in it. The tape is art/tape.svg, drawn as the rest of the art is (ArtView.h).

#include "atlas/Paper.h"

#include <ui/Component.h>

#include <string>

namespace game::atlas {

	class Sheet : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string identity; // what seeds its wear: the scene's name
		};

		explicit Sheet(const Args& args);

		[[nodiscard]] const char* typeName() const override { return "Sheet"; }
		// The tape runs off the sheet's corners into the table, and the shadow past its edge.
		[[nodiscard]] float inkExtent() const override { return 24.0F; }

		// Whether the tape art loaded; it's logged once if it didn't.
		[[nodiscard]] static bool tapeLoaded();

	  protected:
		void render() override;

	  private:
		PaperLook look;
	};

} // namespace game::atlas
