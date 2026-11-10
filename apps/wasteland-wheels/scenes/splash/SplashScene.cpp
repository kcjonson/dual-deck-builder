// The launch splash (UI Art Direction, Screens: Launch splash): the closed atlas on the table, deck A fanned at its lower
// left and deck B stacked at its upper right, both partly under the book, and below it the scale-bar loader captioned
// "UNFOLDING THE MAP" with the percentage, the build's line at the bottom. It fades in, holds, and goes to the main
// menu; a press or a key goes on at once. Everything has loaded before it opens, so the loader runs on the fade and the
// hold.

#include "Build.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Gauges.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"
#include "cards/DeckStack.h"
#include "scenes/GameScene.h"
#include "scenes/splash/ClosedAtlas.h"

#include <primitives/Primitives.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <numbers>
#include <string>
#include <vector>

namespace game {

	namespace {

		namespace palette = atlas::tokens::palette;
		namespace styles = atlas::styles::print;

		constexpr double kFadeSeconds = 0.5;
		constexpr double kSplashSeconds = 1.5;
		// The book's share of the table's width, up to the mock's cover, and the decks' cards against the book's width.
		constexpr float kBookShare = 57.6F;
		constexpr float kBookWidest = 830.0F;
		constexpr float kDeckShare = 15.2F;
		constexpr float kLoaderWidth = 420.0F;
		constexpr int	kLoaderSegments = 10;

		float degrees(float turn) {
			return turn * std::numbers::pi_v<float> / 180.0F;
		}

		// The table's grain: full-width bands of faint tone down a 900 px table, seeded once, light or dark.
		struct GrainBand {
			float top;
			float height;
			bool  light;
			float alpha;
		};

		const std::vector<GrainBand>& grain() {
			static const std::vector<GrainBand> kBands = [] {
				std::vector<GrainBand> bands;
				uint32_t			   state = 506U;
				const auto			   next = [&state] {
					state ^= state << 13U;
					state ^= state >> 17U;
					state ^= state << 5U;
					return static_cast<float>(state % 10000U) / 10000.0F;
				};
				for (float top = 0.0F; top < 900.0F;) {
					const float height = next() < 0.3F ? 2.0F + next() * 4.0F : 12.0F + next() * 32.0F;
					const bool	light = next() < 0.45F;
					bands.push_back(
						{.top = top, .height = height, .light = light, .alpha = light ? 0.01F + next() * 0.025F : 0.05F + next() * 0.15F}
					);
					top += height;
				}
				return bands;
			}();
			return kBands;
		}

		// The dark table the book lies on, with its grain; it lays out the splash in a centred column.
		class Table : public ui::Component {
		  public:
			struct Args {
				UI_COMMON_ARGS
			};

			explicit Table(const Args& /*args*/) {}

			[[nodiscard]] const char* typeName() const override { return "Table"; }

		  protected:
			void render() override {
				const ui::Theme& theme = getContext()->getTheme();
				const float		 alpha = opacity();
				const int32_t	 key = drawKey();
				Renderer::Primitives::drawRect(
					{.bounds = {0.0F, 0.0F, size.x, size.y},
					 .style = {.fill = atlas::withAlpha(theme.get(palette::table), alpha)},
					 .key = key}
				);
				const float rows = size.y / 900.0F;
				for (const GrainBand& band : grain()) {
					const Foundation::Color tone = theme.get(band.light ? palette::sheet : palette::shadow);
					Renderer::Primitives::drawRect({
						.bounds = {0.0F, band.top * rows, size.x, band.height * rows},
						.style = {.fill = Foundation::Color(tone.r, tone.g, tone.b, band.alpha * alpha)},
						.key = key,
					});
				}
			}
		};

		class SplashScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kSplash; }

			bool handleEvent(const foundation::InputEvent& event) override {
				using Type = foundation::InputEvent::Type;
				if (event.type == Type::PointerDown || event.type == Type::KeyDown || event.type == Type::ButtonDown) {
					goOn();
					return true;
				}
				return false;
			}

			void update(const app::FrameContext& frame) override {
				shown += frame.dt;
				show();
				if (shown >= kSplashSeconds) {
					goOn();
				}
			}

			void render(float /*alpha*/) override { Renderer::Primitives::clear(ui().getTheme().get(palette::table)); }

			std::string exportState() const override { return nlohmann::json{{"shown", shown}, {"percent", percent}}.dump(); }

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				const ui::Theme& theme = ui().getTheme();
				table = root().addChild<Table>({
					.id = "table",
					.size = {ui::percent(100.0F), ui::percent(100.0F)},
					.layout = [] {
						ui::Layout layout{
							.display = ui::Display::Flex,
							.flexDirection = ui::FlexDirection::Column,
							.gap = 56.0F,
							.alignItems = ui::AlignItems::Center,
							.justifyContent = ui::JustifyContent::Center,
						};
						layout.padding = ui::Edges(40.0F, 0.0F, 60.0F, 0.0F);
						return layout;
					}(),
				});

				// The decks first, so the book lies over them.
				ui::Ref<ui::Component> stage = table.addChild<ui::Component>({
					.id = "stage",
					.size = {ui::percent(kBookShare), ui::kAuto},
					.maxSize = {kBookWidest, ui::kAuto},
					.layout = {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column},
				});
				stage.addChild<cards::DeckStack>({
					.id = "deck_a",
					.size = {ui::percent(kDeckShare), ui::kAuto},
					.transform = {.rotate = degrees(-24.0F)},
					.layout = {.position = ui::Position::Absolute, .inset = {.top = ui::percent(56.0F), .left = ui::percent(-19.0F)}},
					.seat = 0,
					.under = 4,
					.lay = cards::DeckLay::Fan,
				});
				stage.addChild<cards::DeckStack>({
					.id = "deck_b",
					.size = {ui::percent(kDeckShare), ui::kAuto},
					.transform = {.rotate = degrees(16.0F)},
					.layout = {.position = ui::Position::Absolute, .inset = {.top = ui::percent(7.0F), .left = ui::percent(97.0F)}},
					.seat = 1,
					.under = 4,
				});
				stage.addChild<ClosedAtlas>({.id = "book", .size = {ui::percent(100.0F), ui::kAuto}});

				ui::Ref<ui::Component> loader = table.addChild<ui::Component>({
					.id = "loader",
					.size = {kLoaderWidth, ui::kAuto},
					.layout = {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = 8.0F},
				});
				bar = loader.addChild<atlas::ScaleBar>({
					.id = "loader_bar",
					.size = {ui::percent(100.0F), 12.0F},
					.segments = kLoaderSegments,
					.value = 0.0F,
					.tone = atlas::ScaleTone::Highway,
					.frame = 2.0F,
				});
				const ui::Style		   caption = styles::caption.extend({
						   .color = theme.get(palette::index),
						   .letterSpacing = 1.7F,
						   .textTransform = Foundation::TextTransform::Uppercase,
				   });
				ui::Ref<ui::Component> captions = loader.addChild<ui::Component>({
					.layout = {
						.display = ui::Display::Flex,
						.flexDirection = ui::FlexDirection::Row,
						.justifyContent = ui::JustifyContent::SpaceBetween
					},
				});
				captions.addChild<ui::Text>({.id = "loader_caption", .style = caption, .text = "Unfolding the map"});
				percentText = captions.addChild<ui::Text>({.id = "loader_percent", .style = caption, .text = "0%"});

				table.addChild<ui::Text>({
					.id = "build",
					.layout = {.position = ui::Position::Absolute, .inset = {.right = 0.0F, .bottom = 26.0F, .left = 0.0F}},
					.style = styles::kicker.extend({
						.color = theme.get(palette::fadedPrint),
						.fontSize = 10.0F,
						.textAlign = Foundation::HorizontalAlign::Center,
						.letterSpacing = 1.8F,
						.textTransform = Foundation::TextTransform::None,
					}),
					.text = buildLine(),
				});
				show();
			}

		  private:
			// The fade and the loader at the time shown, the loader by whole percents.
			void show() {
				if (ui::Component* ground = table.get()) {
					ground->setFade(app().reducedMotion() ? 1.0F : static_cast<float>(std::min(1.0, shown / kFadeSeconds)));
				}
				const int now = static_cast<int>(std::floor(std::min(1.0, shown / kSplashSeconds) * 100.0));
				if (now == percent) {
					return;
				}
				percent = now;
				if (atlas::ScaleBar* loaded = bar.get()) {
					loaded->setValue(static_cast<float>(percent) / 100.0F);
				}
				if (ui::Text* line = percentText.get()) {
					line->setText(std::to_string(percent) + "%");
				}
			}

			void goOn() {
				if (!leaving) {
					leaving = true;
					app().scenes().switchTo(scenes::kMainMenu);
				}
			}

			ui::Ref<Table>			 table;
			ui::Ref<atlas::ScaleBar> bar;
			ui::Ref<ui::Text>		 percentText;
			double					 shown = 0.0;
			int						 percent = -1;
			bool					 leaving = false;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeSplashScene() {
		return std::make_unique<SplashScene>();
	}

} // namespace game
