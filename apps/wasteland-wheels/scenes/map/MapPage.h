#pragma once

// The page the area map and the run route share (area-map-atlas-panels.md, Layout): one atlas sheet with the section
// tabs hanging from it, the map's plate on the left under its heading with a status line beneath, and a 360 px column
// of legend boxes on the right over the one primary, pinned at its foot. The body scrolls, whole, when the window is too
// short for it at the ui's scale, so the heading, the boxes and the primary keep their size (DDB-602's squeeze).

#include "atlas/SectionTabs.h"
#include "atlas/Sheet.h"

#include <ui/Component.h>

#include <string>
#include <vector>

namespace game {

	struct MapPage {
		ui::Ref<atlas::Sheet> sheet;
		// The plate's column: its heading row, then whatever the scene lays under it.
		ui::Ref<ui::Component> plate;
		ui::Ref<ui::Component> heading;
		// The column's boxes, which share what the primary leaves, and the primary's own foot.
		ui::Ref<ui::Component> boxes;
		ui::Ref<ui::Component> primary;
	};

	// The page under `root`, its sheet seeded by the scene's name.
	[[nodiscard]] MapPage openMapPage(ui::Ref<ui::Component> root, const std::string& identity, const std::vector<atlas::TabSpec>& tabs);

	// A column of `gap`, its children stretched across it.
	[[nodiscard]] ui::Layout columnLayout(float gap);

} // namespace game
