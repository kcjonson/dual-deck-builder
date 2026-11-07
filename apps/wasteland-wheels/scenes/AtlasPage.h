#pragma once

// The page the menu's appendices (settings, credits, campaign history) and the founding and loading pages share, in the
// atlas (UI Art Direction, Screens: the rest follow the same parts): one W2 sheet on the table, its section tabs when it
// has any, the title in spaced capitals with a subtitle beside it, and a body that takes the room left, its boxes
// centred. A scene rebuilds it whole whenever what it shows changes.

#include "MapJob.h"
#include "atlas/Gauges.h"
#include "atlas/LegendBox.h"
#include "atlas/SectionTabs.h"
#include "atlas/Sheet.h"

#include <application/App.h>
#include <scene/Scene.h>
#include <ui/Component.h>
#include <ui/Input.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>
#include <vector>

namespace game {

	struct AtlasPage {
		ui::Ref<atlas::Sheet>  sheet;
		ui::Ref<ui::Component> body;
	};

	struct AtlasPageArgs {
		std::string						   identity; // the scene's name: the sheet's wear
		std::string						   title;
		std::string						   subtitle; // beside the title; none when empty
		std::vector<atlas::TabSpec>		   tabs;	 // none: the sheet has no tabs
		std::function<void(ui::KeyEvent&)> onKeyDown;
	};

	// Replaces `previous`, if the scene has one, with an empty page.
	[[nodiscard]] AtlasPage openAtlasPage(app::Scene& scene, AtlasPage& previous, const AtlasPageArgs& args);

	// The tabs between the menu's appendices, Menu first, the one with the id `active` current: ids main_menu,
	// tab_campaign_history, tab_settings and tab_credits.
	[[nodiscard]] std::vector<atlas::TabSpec> appendixTabs(app::App& app, const std::string& active);

	// A map being made, for founding and loading: a legend box with what it's for in mono, the stages as a scale bar, and
	// the stage in words; the scene puts its buttons in the box's foot.
	struct MapProgressBox {
		ui::Ref<atlas::LegendBox> box;
		ui::Ref<atlas::ScaleBar>  bar;
		ui::Ref<ui::Text>		  line;
		ui::Ref<ui::Component>	  foot;
	};

	[[nodiscard]] MapProgressBox mapProgressBox(ui::Ref<ui::Component> body, const std::string& kicker);

	// The stage reached; the line says it as progressText does.
	void showProgress(const MapProgressBox& shown, const MapProgress& progress);

	// A box for what went wrong: what it was for in mono (none when empty), the reason, and the box's foot for the scene's
	// buttons.
	[[nodiscard]] ui::Ref<ui::Component>
	failureBox(ui::Ref<ui::Component> body, const std::string& title, const std::string& kicker, const std::string& reason);

	// The build's line, under the splash's loader and at the foot of the menu: a development build says so.
	[[nodiscard]] const char* buildLine();

} // namespace game
