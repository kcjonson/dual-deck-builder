// The art gallery, a developer's page: every piece of the game's vector art (ArtView.h) on a sheet at the size a screen
// uses it, named under it, for a launch to look at and the tests to lint. The closed atlas's pieces are shown as the
// splash lays them: the page edges under a W2 cover, the spine over it.

#include "atlas/ArtView.h"
#include "atlas/AtlasTheme.h"
#include "atlas/SectionTabs.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "scenes/GameScene.h"

#include <array>
#include <optional>
#include <string>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;

		// The splash's cover at half the mock's 820 by 560.
		constexpr Foundation::Vec2 kCover{410.0F, 280.0F};
		// The vehicles' rear views, as the road draws them in a token at its largest, x1.25.
		constexpr std::array<const char*, 7>
			kVehicles{"vehicle-bike", "vehicle-buggy", "vehicle-car", "vehicle-truck", "vehicle-rig", "vehicle-tanker", "vehicle-generic"};
		constexpr float kVehicleWidth = 75.0F;

		ui::Layout column(float gap) {
			return {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Start
			};
		}

		ui::Layout filling() {
			return {.position = ui::Position::Absolute};
		}

		class ArtGalleryScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kArtGallery; }

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				ui::Layout sheetLayout = column(8.0F);
				sheetLayout.alignItems = ui::AlignItems::Stretch;
				sheetLayout.padding = ui::Edges(0.0F, 48.0F, 50.0F, 46.0F);
				ui::Ref<atlas::Sheet>  sheet = root().addChild<atlas::Sheet>({
					 .id = "sheet",
					 .size = {ui::percent(100.0F), ui::percent(100.0F)},
					 .layout = sheetLayout,
					 .identity = std::string(scenes::kArtGallery),
				 });
				ui::Ref<ui::Component> tabs = atlas::sectionTabs(
					sheet,
					{
						{.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
						{.id = "tab_art", .label = "Art", .active = true},
					}
				);
				ui::Layout tabsLayout = tabs.get()->getLayout();
				tabsLayout.alignSelf = ui::AlignItems::Center;
				tabsLayout.flexShrink = 0.0F;
				tabs.get()->setLayout(tabsLayout);
				sheet.addChild<ui::Text>({.id = "title", .layout = {.flexShrink = 0.0F}, .style = styles::screenTitle, .text = "The art"});

				ui::Ref<ui::Component> pieces = sheet.addChild<ui::Component>({
					.id = "pieces",
					.minSize = {0.0F, 0.0F},
					.layout =
						{.display = ui::Display::Flex,
						 .flexDirection = ui::FlexDirection::Row,
						 .flexWrap = ui::FlexWrap::Wrap,
						 .gap = 32.0F,
						 .padding = ui::Edges(12.0F),
						 .alignItems = ui::AlignItems::Start,
						 .flexGrow = 1.0F},
					.overflow = ui::Overflow::Scroll,
				});
				piece(pieces, "logo", 700.0F);
				cover(pieces);
				piece(pieces, "mark", 140.0F);
				piece(pieces, "mark-small", 32.0F);
				piece(pieces, "stamp-lost");
				piece(pieces, "stamp-fallen");
				piece(pieces, "stamp-looted");
				piece(pieces, "stamp-looted", 0.0F, atlas::tokens::palette::ink);
				piece(pieces, "tape");
				for (const char* vehicle : kVehicles) {
					piece(pieces, vehicle, kVehicleWidth);
				}
			}

		  private:
			// A piece at `width` px, its height in proportion, or at its own size, in its own colours or `tint`; its name under it.
			void piece(ui::Ref<ui::Component> parent, const std::string& art, float width = 0.0F, std::optional<ui::ColorToken> tint = {}) {
				const std::string	   name = tint ? art + "_tinted" : art;
				ui::Ref<ui::Component> tile = parent.addChild<ui::Component>({.id = "tile_" + name, .layout = column(10.0F)});
				tile.addChild<atlas::ArtView>({
					.id = "art_" + name,
					.size = {width > 0.0F ? ui::Length(width) : ui::kAuto, ui::kAuto},
					.art = art,
					.tint = tint,
				});
				tile.addChild<ui::Text>({.style = styles::kicker, .text = tint ? art + ", tinted" : art});
			}

			void cover(ui::Ref<ui::Component> parent) {
				ui::Ref<ui::Component> tile = parent.addChild<ui::Component>({.id = "tile_cover", .layout = column(10.0F)});
				ui::Ref<ui::Component> book = tile.addChild<ui::Component>({.id = "cover", .size = {kCover.x, kCover.y}});
				const ui::Size		   whole{ui::percent(100.0F), ui::percent(100.0F)};
				book.addChild<atlas::ArtView>(
					{.id = "art_cover-edges", .size = whole, .layout = filling(), .art = "cover-edges", .fit = atlas::ArtFit::Stretch}
				);
				book.addChild<atlas::Paper>({
					.id = "cover_paper",
					.size = whole,
					.layout = filling(),
					.style = {.backgroundColor = ui().getTheme().get(atlas::tokens::palette::sheet)},
					.look = {.seed = atlas::paperSeed("art_gallery/cover"), .wear = atlas::Wear::Worn, .folds = 1},
				});
				book.addChild<atlas::ArtView>(
					{.id = "art_cover-spine", .size = whole, .layout = filling(), .art = "cover-spine", .fit = atlas::ArtFit::Stretch}
				);
				tile.addChild<ui::Text>({.style = styles::kicker, .text = "cover-edges, cover-spine"});
			}
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeArtGalleryScene() {
		return std::make_unique<ArtGalleryScene>();
	}

} // namespace game
