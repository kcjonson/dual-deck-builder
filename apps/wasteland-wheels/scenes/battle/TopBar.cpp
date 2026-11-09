#include "scenes/battle/TopBar.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "scenes/battle/BattleInk.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/components/Button.h>
#include <ui/components/Control.h>
#include <ui/shapes/Icon.h>

#include <nlohmann/json.hpp>

#include <array>
#include <string>
#include <utility>

namespace game::battle {

	namespace {

		// The mock's .g-top: its groups in display 14 spaced 0.06 em, the ticker in body 12, the LOG key's .kbtn.
		constexpr float kPadX = 12.0F;
		constexpr float kGap = 18.0F;
		constexpr float kGroupGap = 8.0F;
		constexpr float kGroupSize = 14.0F;
		constexpr float kTickerSize = 12.0F;
		constexpr float kTickerHeight = 16.0F;
		constexpr float kKeySize = 12.0F;
		constexpr float kKbdSize = 10.0F;
		// Both keys are this tall; the menu's is square, around the mock's 16 px i-menu: three 1.8 px bars, 12 wide.
		constexpr float				   kKeyHeight = 24.0F;
		constexpr float				   kMenuGlyph = 16.0F;
		constexpr float				   kMenuBarWidth = 12.0F;
		constexpr float				   kMenuBarHeight = 1.8F;
		constexpr std::array<float, 3> kMenuBars{3.5F, 8.0F, 12.5F};
		constexpr float				   kResourceGap = 6.0F;
		constexpr float				   kResourceIcon = 16.0F;
		constexpr float				   kMenuWidth = 420.0F;
		// The mock's scrap and fuel tints (.g-top .grp).
		constexpr Foundation::Color kScrap = cards::hex(0xC9B27A);
		constexpr Foundation::Color kFuel = cards::hex(0xC9A36A);

		ui::Style group(Foundation::Color color) {
			return {
				.color = color,
				.fontFamily = fonts::kDisplaySemibold,
				.fontSize = kGroupSize,
				.letterSpacing = kGroupSize * 0.06F,
				.textTransform = Foundation::TextTransform::Uppercase,
				.fontWeight = 600.0F,
			};
		}

		// The last log line, on one line, cut with an ellipsis to the room the bar leaves it.
		class Ticker : public ui::Component {
		  public:
			struct Args {
				UI_COMMON_ARGS
			};

			explicit Ticker(const Args& /*args*/) {}

			void setText(std::string value) { text = std::move(value); }

			[[nodiscard]] const char* typeName() const override { return "Ticker"; }
			void					  describe(nlohmann::json& node) const override {
				 node["text"] = text;
				 node["shown"] = cards::fittedLine(text, fonts::kBody, kTickerSize, size.x);
			}

		  protected:
			void render() override {
				cards::drawWords({
					.text = cards::fittedLine(text, fonts::kBody, kTickerSize, size.x),
					.at = {0.0F, 0.0F},
					.face = fonts::kBody,
					.size = kTickerSize,
					.color = ink::kMuted,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = size.x,
					.boxHeight = size.y,
					.key = drawKey(),
				});
			}
			[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::None; }

		  private:
			std::string text;
		};

		// LOG with its key beside it, outlined, lit in the interaction yellow while the drawer is open.
		class LogButton : public ui::Control {
		  public:
			struct Args {
				UI_COMMON_ARGS
				std::function<void()> onPress;
			};

			explicit LogButton(const Args& args)
				: onPress(args.onPress) {}

			void setLit(bool value) { setActive(value); }

			[[nodiscard]] const char* typeName() const override { return "LogButton"; }
			[[nodiscard]] float		  inkExtent() const override { return 3.0F; }

		  protected:
			void onMount() override {
				ui::Control::onMount();
				ui::Layout layout = getLayout();
				layout.display = ui::Display::Flex;
				layout.flexDirection = ui::FlexDirection::Row;
				layout.alignItems = ui::AlignItems::Center;
				layout.gap = 6.0F;
				layout.padding = ui::Edges(4.0F, 8.0F);
				setLayout(layout);
				const std::string id = getId();
				label = addChild<ui::Text>({
					.id = id + "_label",
					.style = group(ink::kMuted).extend({.fontSize = kKeySize, .letterSpacing = kKeySize * 0.08F}),
					.text = "Log",
				});
				key = addChild<ui::Text>({
					.id = id + "_key",
					.style = {.color = ink::kDim, .fontFamily = fonts::kMono, .fontSize = kKbdSize},
					.text = "L",
				});
				tint();
			}

			void render() override {
				const ui::InteractionState state = interaction();
				const bool				   lit = isActive();
				Foundation::Color		   edge = lit ? ink::kWarn : ink::kLine2;
				if (!lit && (state.hovered || state.pressed)) {
					edge = ink::kMuted;
				}
				cards::drawRounded(
					{0.0F, 0.0F, size.x, size.y},
					2.0F,
					lit ? cards::hex(0xEFD25A, 0.12F) : Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
					edge,
					1.0F,
					drawKey()
				);
				if (state.focusVisible) {
					cards::drawRounded(
						{-3.0F, -3.0F, size.x + 6.0F, size.y + 6.0F}, 4.0F, {0.0F, 0.0F, 0.0F, 0.0F}, ink::kWarn, 1.5F, drawKey()
					);
				}
			}

			void onInteractionChanged(const ui::InteractionState& /*previous*/) override { tint(); }

			void activate() override {
				if (onPress) {
					onPress();
				}
			}

		  private:
			void tint() {
				if (ui::Text* shown = label.get()) {
					const bool lit = isActive();
					shown->setStyle(shown->getDeclaredStyle().extend({.color = lit || interaction().hovered ? ink::kWarn : ink::kMuted}));
				}
			}

			std::function<void()> onPress;
			ui::Ref<ui::Text>	  label;
			ui::Ref<ui::Text>	  key;
		};

		// The menu's key: outlined like the LOG key, three bars in it, faded whole while it's off.
		class MenuButton : public ui::Control {
		  public:
			struct Args {
				UI_COMMON_ARGS
				std::function<void()> onPress;
			};

			explicit MenuButton(const Args& args)
				: onPress(args.onPress) {}

			[[nodiscard]] const char* typeName() const override { return "MenuButton"; }
			[[nodiscard]] float		  inkExtent() const override { return 3.0F; }

		  protected:
			void render() override {
				const ui::InteractionState state = interaction();
				const bool				   lit = state.hovered || state.pressed;
				cards::drawRounded(
					{0.0F, 0.0F, size.x, size.y},
					2.0F,
					Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
					lit ? ink::kMuted : ink::kLine2,
					1.0F,
					drawKey()
				);
				const Foundation::Vec2 glyph{(size.x - kMenuGlyph) * 0.5F, (size.y - kMenuGlyph) * 0.5F};
				for (const float bar : kMenuBars) {
					Renderer::Primitives::drawRect({
						.bounds =
							{glyph.x + (kMenuGlyph - kMenuBarWidth) * 0.5F,
							 glyph.y + bar - kMenuBarHeight * 0.5F,
							 kMenuBarWidth,
							 kMenuBarHeight},
						.style = {.fill = lit ? ink::kBone : ink::kMuted},
						.key = drawKey(),
					});
				}
				if (state.focusVisible) {
					cards::drawRounded(
						{-3.0F, -3.0F, size.x + 6.0F, size.y + 6.0F}, 4.0F, {0.0F, 0.0F, 0.0F, 0.0F}, ink::kWarn, 1.5F, drawKey()
					);
				}
			}

			void activate() override {
				if (onPress) {
					onPress();
				}
			}

		  private:
			std::function<void()> onPress;
		};

	} // namespace

	TopBar::TopBar(const Args& args)
		: onToggleLog(args.onToggleLog),
		  onMainMenu(args.onMainMenu) {}

	bool TopBar::openMenu() {
		if (!shown.menu || menuOpen() || menuButton.get() == nullptr) {
			return false;
		}
		menuDialog = ui::Dialog::open(
			*this, {.id = "menu_dialog", .title = "Menu", .panelSize = {kMenuWidth, ui::kAuto}, .footer = true, .onClose = [this] {
						menuDialog = {};
					}}
		);
		ui::Dialog* dialog = menuDialog.get();
		dialog->content().addChild<ui::Text>({
			.id = "menu_body",
			.style = {.color = ink::kMuted, .fontFamily = fonts::kBody, .fontSize = 14.0F},
			.text = "The fight isn't saved. Leave for the main menu and Continue starts it again from its first turn.",
			.wrap = true,
		});
		// Keep fighting first, so it has the focus as the menu opens and a stray Enter stays in the fight.
		dialog->footer().addChild<ui::Button>({
			.id = "menu_resume",
			.label = "Keep fighting",
			.variant = ui::ButtonVariant::Primary,
			.onPress = [this] { closeMenu(); },
		});
		dialog->footer().addChild<ui::Button>({
			.id = "menu_main_menu",
			.label = "Main menu",
			// The scene goes, and the menu with it.
			.onPress = [this] {
				if (onMainMenu) {
					onMainMenu();
				}
			},
		});
		return true;
	}

	void TopBar::closeMenu() {
		if (ui::Context* context = getContext(); context != nullptr && menuOpen()) {
			context->closeOverlay(menuDialog);
		}
		menuDialog = {};
	}

	void TopBar::show(const TopBarPicture& picture) {
		if (picture == shown) {
			return;
		}
		shown = picture;
		refresh();
	}

	void TopBar::onMount() {
		if (getSizeSpec().height.isAuto()) {
			setSize({getSizeSpec().width, kHeight});
		}
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::Center;
		layout.gap = kGap;
		layout.padding = ui::Edges(0.0F, kPadX);
		setLayout(layout);

		const std::string id = getId().empty() ? std::string("top") : getId();
		const ui::Layout  row{
			 .display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = kGroupGap, .alignItems = ui::AlignItems::Center
		 };
		menuButton = addChild<MenuButton>({.id = "menu", .size = {kKeyHeight, kKeyHeight}, .onPress = [this] { openMenu(); }});
		ui::Ref<ui::Component> waves = addChild<ui::Component>({.id = id + "_waves", .layout = row});
		wave = waves.addChild<ui::Text>({.id = id + "_wave", .style = group(ink::kBone)});
		arriving = waves.addChild<ui::Text>({.id = id + "_arriving", .style = group(ink::kRaider)});
		ui::Ref<ui::Component> turns = addChild<ui::Component>({.id = id + "_turns", .layout = row});
		turn = turns.addChild<ui::Text>({.id = id + "_turn", .style = group(ink::kMuted)});
		whose = turns.addChild<ui::Text>({.id = id + "_whose", .style = group(ink::kMuted)});
		ticker = addChild<Ticker>({
			.id = id + "_ticker",
			.size = {ui::kAuto, kTickerHeight},
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
		});
		const ui::Layout resource{
			.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = kResourceGap, .alignItems = ui::AlignItems::Center
		};
		const auto carried = [&](const std::string& name, Foundation::Color color, ui::Ref<ui::Text>& value) {
			ui::Ref<ui::Component> held = addChild<ui::Component>({.id = id + "_" + name, .layout = resource});
			held.addChild<ui::Icon>(
				{.id = id + "_" + name + "_icon", .size = {kResourceIcon, kResourceIcon}, .style = {.color = color}, .name = name}
			);
			value = held.addChild<ui::Text>({.id = id + "_" + name + "_value", .style = group(color)});
			return held;
		};
		scrapGroup = carried("scrap", kScrap, scrap);
		fuelGroup = carried("fuel", kFuel, fuel);
		logButton = addChild<LogButton>({.id = "log_toggle", .size = {ui::kAuto, kKeyHeight}, .onPress = [this] {
											 if (onToggleLog) {
												 onToggleLog();
											 }
										 }});
		refresh();
	}

	void TopBar::refresh() {
		if (wave.get() == nullptr) {
			return;
		}
		wave.get()->setText("Wave " + std::to_string(shown.wave) + " of " + std::to_string(shown.waves));
		// Nothing can arrive once the last wave is on the road (call 195: the bar shows what's arriving, not the queue).
		arriving.get()->setVisible(shown.wave < shown.waves);
		arriving.get()->setText("+" + std::to_string(shown.arriving) + " arriving");
		arriving.get()->setStyle(arriving.get()->getDeclaredStyle().extend({.color = shown.arriving > 0 ? ink::kRaider : ink::kDim}));
		turn.get()->setText("Turn " + std::to_string(shown.turn));
		whose.get()->setText(shown.raidersActing ? "Raiders acting" : "Your move");
		whose.get()->setStyle(whose.get()->getDeclaredStyle().extend({.color = shown.raidersActing ? ink::kRaider : ink::kBone}));
		static_cast<Ticker*>(ticker.get())->setText(shown.ticker);
		scrapGroup.get()->setVisible(shown.cargo.has_value());
		fuelGroup.get()->setVisible(shown.cargo.has_value());
		if (shown.cargo) {
			scrap.get()->setText(std::to_string(shown.cargo->scrap));
			fuel.get()->setText(std::to_string(shown.cargo->fuel));
		}
		static_cast<LogButton*>(logButton.get())->setLit(shown.logOpen);
		menuButton.get()->setEnabled(shown.menu);
		if (!shown.menu) {
			closeMenu();
		}
	}

	void TopBar::render() {
		Renderer::Primitives::drawRect({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.style =
				{.fill = ink::kTopBar,
				 .border =
					 Foundation::BorderStyle{
						 .color = ink::kLine,
						 .width = 1.0F,
						 .position = Foundation::BorderPosition::Inside,
						 .sides = {.top = false, .right = false, .bottom = true, .left = false},
					 }},
			.key = drawKey(),
		});
	}

} // namespace game::battle
