#pragma once

// The placeholder look every scene shares until the art decision lands (game-app.md): salal's default tokens and its
// controls, a page of panels with a title, rows and buttons. A scene rebuilds its page whenever what it shows changes,
// so nothing here keeps state.

#include <scene/Scene.h>
#include <ui/Component.h>
#include <ui/components/Button.h>
#include <ui/components/ListRow.h>
#include <ui/components/Panel.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>

namespace game::kit {

	struct Page {
		// The page's own column, the whole scene, which a rebuild replaces.
		ui::Ref<ui::Component> frame;
		// Between the title and the footer, a row of columns that takes the room.
		ui::Ref<ui::Component> body;
		// A row of the page's buttons at its foot.
		ui::Ref<ui::Component> footer;
		// Under the footer: what went wrong or what just happened.
		ui::Ref<ui::Text> notice;
	};

	// Replaces the scene's page, if it has one, with an empty one titled `title`, `subtitle` under it when not empty.
	[[nodiscard]] Page openPage(app::Scene& scene, Page& previous, const std::string& title, const std::string& subtitle = {});

	// A titled panel in the page's body, a column that grows to share the row with its neighbours.
	[[nodiscard]] ui::Ref<ui::Component> panel(const Page& page, const std::string& title, const std::string& id = {});

	[[nodiscard]] ui::Ref<ui::Component> column(ui::Ref<ui::Component> parent, float gap = 6.0F);
	[[nodiscard]] ui::Ref<ui::Component> row(ui::Ref<ui::Component> parent, float gap = 8.0F);

	ui::Ref<ui::Text> text(ui::Ref<ui::Component> parent, const std::string& words, const std::string& id = {});
	ui::Ref<ui::Text> caption(ui::Ref<ui::Component> parent, const std::string& words, const std::string& id = {});

	ui::Ref<ui::Button> button(
		ui::Ref<ui::Component> parent,
		const std::string&	   id,
		const std::string&	   label,
		std::function<void()>  onPress,
		ui::ButtonVariant	   variant = ui::ButtonVariant::Secondary,
		bool				   enabled = true
	);

	// A row a press acts on; dim says it can't, with the reason as its trailing text, and it does nothing.
	ui::Ref<ui::ListRow> listRow(
		ui::Ref<ui::Component> parent,
		const std::string&	   id,
		const std::string&	   label,
		const std::string&	   trailing,
		std::function<void()>  onPress,
		bool				   dim = false,
		bool				   selected = false
	);

	void setNotice(const Page& page, const std::string& words);

} // namespace game::kit
