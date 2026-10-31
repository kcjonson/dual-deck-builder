#include "scenes/SceneKit.h"

#include <ui/theme/Tokens.h>

#include <utility>

namespace game::kit {

	using ui::AlignItems;
	using ui::Display;
	using ui::FlexDirection;
	using ui::Layout;
	using ui::Ref;

	namespace {

		Layout flex(FlexDirection direction, float gap) {
			return {.display = Display::Flex, .flexDirection = direction, .gap = gap, .alignItems = AlignItems::Stretch};
		}

	} // namespace

	Page openPage(app::Scene& scene, Page& previous, const std::string& title, const std::string& subtitle) {
		Ref<ui::Component> root = scene.root();
		if (previous.frame.get() != nullptr) {
			root.get()->removeChild(previous.frame);
		}
		Layout frameLayout = flex(FlexDirection::Column, 12.0F);
		frameLayout.padding = 24.0F;
		Page page;
		page.frame =
			root.addChild<ui::Component>({.id = "page", .size = {ui::percent(100.0F), ui::percent(100.0F)}, .layout = frameLayout});
		page.frame.addChild<ui::Text>({.id = "title", .style = ui::styles::text::display, .text = title});
		if (!subtitle.empty()) {
			page.frame.addChild<ui::Text>({.id = "subtitle", .style = ui::styles::text::secondary, .text = subtitle, .wrap = true});
		}
		Layout bodyLayout = flex(FlexDirection::Row, 16.0F);
		bodyLayout.flexGrow = 1.0F;
		bodyLayout.alignItems = AlignItems::Start;
		page.body = page.frame.addChild<ui::Component>(
			{.id = "body", .minSize = {0.0F, 0.0F}, .layout = bodyLayout, .overflow = ui::Overflow::Scroll}
		);
		Layout footerLayout = flex(FlexDirection::Row, 8.0F);
		footerLayout.alignItems = AlignItems::Center;
		page.footer = page.frame.addChild<ui::Component>({.id = "footer", .layout = footerLayout});
		page.notice = page.frame.addChild<ui::Text>({.id = "notice", .style = ui::styles::text::caption, .text = "", .wrap = true});
		previous = page;
		return page;
	}

	Ref<ui::Component> panel(const Page& page, const std::string& title, const std::string& id) {
		Layout layout = flex(FlexDirection::Column, 6.0F);
		layout.flexGrow = 1.0F;
		Ref<ui::Panel>	   made = page.body.addChild<ui::Panel>({.id = id, .minSize = {220.0F, 0.0F}, .layout = layout, .title = title});
		Ref<ui::Component> body = made.get()->body();
		// Rows take the panel's width, as a list's do.
		Layout stretched = body.get()->getLayout();
		stretched.alignItems = AlignItems::Stretch;
		body.get()->setLayout(stretched);
		return body;
	}

	Ref<ui::Component> column(Ref<ui::Component> parent, float gap) {
		return parent.addChild<ui::Component>({.layout = flex(FlexDirection::Column, gap)});
	}

	Ref<ui::Component> row(Ref<ui::Component> parent, float gap) {
		Layout layout = flex(FlexDirection::Row, gap);
		layout.alignItems = AlignItems::Center;
		return parent.addChild<ui::Component>({.layout = layout});
	}

	Ref<ui::Text> text(Ref<ui::Component> parent, const std::string& words, const std::string& id) {
		return parent.addChild<ui::Text>({.id = id, .style = ui::styles::text::body, .text = words, .wrap = true});
	}

	Ref<ui::Text> caption(Ref<ui::Component> parent, const std::string& words, const std::string& id) {
		return parent.addChild<ui::Text>({.id = id, .style = ui::styles::text::caption, .text = words, .wrap = true});
	}

	Ref<ui::Button> button(
		Ref<ui::Component>	  parent,
		const std::string&	  id,
		const std::string&	  label,
		std::function<void()> onPress,
		ui::ButtonVariant	  variant,
		bool				  enabled
	) {
		return parent.addChild<ui::Button>(
			{.id = id, .enabled = enabled, .label = label, .variant = variant, .onPress = std::move(onPress)}
		);
	}

	Ref<ui::ListRow> listRow(
		Ref<ui::Component>	  parent,
		const std::string&	  id,
		const std::string&	  label,
		const std::string&	  trailing,
		std::function<void()> onPress,
		bool				  dim,
		bool				  selected
	) {
		return parent.addChild<ui::ListRow>({
			.id = id,
			.label = label,
			.trailing = trailing,
			.selected = selected,
			.dim = dim,
			.onPress = dim ? std::function<void()>{} : std::move(onPress),
		});
	}

	void setNotice(const Page& page, const std::string& words) {
		if (ui::Text* notice = page.notice.get()) {
			notice->setText(words);
		}
	}

} // namespace game::kit
