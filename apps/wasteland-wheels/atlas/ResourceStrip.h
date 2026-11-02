#pragma once

// The resource strip (UI Art Direction, Components): the stores read like a map's legend key, each an 18 px icon, its
// name in mono capitals and its value in mono, in ink, or in Stronghold when it runs short.

#include <ui/Component.h>

#include <string>
#include <vector>

namespace game::atlas {

	struct Store {
		std::string id;	  // the item's, and its icon's name
		std::string name; // printed in capitals
		std::string value;
		bool		shortfall = false;
	};

	// The strip in a row under `parent`, its items `<id>` with `<id>_value` beside each.
	ui::Ref<ui::Component> resourceStrip(ui::Ref<ui::Component> parent, const std::vector<Store>& stores);

} // namespace game::atlas
