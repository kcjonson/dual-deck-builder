#include "scenes/battle/TopBar.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "scenes/battle/BattleInk.h"

#include <primitives/Primitives.h>
#include <ui/components/Control.h>

#include <nlohmann/json.hpp>

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

	} // namespace

	TopBar::TopBar(const Args& args)
		: onToggleLog(args.onToggleLog) {}

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
		logButton = addChild<LogButton>({.id = "log_toggle", .onPress = [this] {
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
		static_cast<LogButton*>(logButton.get())->setLit(shown.logOpen);
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
