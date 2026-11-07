#pragma once

// What the result scenes share (UI Art Direction, Screens: results): one sheet on the table, W2, or W3 burnt when the
// event it reports touched the whole page; on it the heading (a kicker, the title, a line of story, and the stamp of
// what was lost or cleared beside them), a body of legend boxes side by side, and the foot with the one highway at the
// right. The heading and the boxes keep to the left, clear of a burn at the top-right corner.

#include "atlas/AtlasButton.h"
#include "atlas/LegendBox.h"
#include "atlas/Paper.h"
#include "atlas/Sheet.h"

#include <ui/Component.h>

#include <functional>
#include <string>

namespace game::result {

	struct Heading {
		std::string kicker;
		std::string title;
		std::string story;			 // none when empty
		bool		hostile = false; // the title in Stronghold red
		std::string stamp;			 // art/<stamp>.svg struck beside the title; none when empty
	};

	struct PageArgs {
		std::string		identity; // what seeds the sheet's wear: the scene's name
		atlas::HeroMark mark = atlas::HeroMark::None;
		Heading			heading;
	};

	struct Page {
		ui::Ref<atlas::Sheet>  sheet;
		ui::Ref<ui::Component> body;
		ui::Ref<ui::Component> foot;
	};

	// The page on the scene's root, `heading_*` ids on the heading's parts and `stamp` on its stamp.
	Page openPage(ui::Ref<ui::Component> root, const PageArgs& args);

	// A legend box in the body, `width` px wide, W1 paper seeded by its id.
	ui::Ref<atlas::LegendBox> box(const Page& page, const std::string& id, const std::string& title, float width);

	// A row in a box, its map symbol before its line; a warning in Stronghold red.
	void row(ui::Ref<atlas::LegendBox> box, const std::string& id, atlas::MapSymbol symbol, const std::string& text, bool warning = false);

	// A line in the foot, at the left; a warning in Stronghold red.
	void footLine(const Page& page, const std::string& id, const std::string& text, bool warning = false);

	// The page's one highway, last in the foot, so at its right.
	ui::Ref<atlas::AtlasButton> highway(const Page& page, const std::string& id, const std::string& label, std::function<void()> onPress);

} // namespace game::result
