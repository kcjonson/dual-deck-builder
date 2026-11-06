// The card showcase (Game Flow 7.0, reached from the main menu's appendices), in the atlas: every card in the game on one
// sheet. The two decks' backs first; then the sizes and states a card comes in; then every card's face, by name; then
// each rarity's cards as minis. Each card opens its detail view on hover or focus and pins it with a secondary click
// or I, as everywhere; the sheet scrolls, with Page Up and Page Down.

#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "atlas/SectionTabs.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "cards/Card.h"
#include "cards/CardBack.h"
#include "cards/CardStyle.h"
#include "scenes/GameScene.h"

#include <rules/core/Card.h>
#include <rules/core/CardText.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <string>
#include <vector>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		using cards::Card;
		using cards::CardSize;
		using cards::MiniState;

		constexpr float kFaceGap = 22.0F;
		// Room round the cards for what they draw past their boxes (the hex, a stack, a tag), inside the scroll's clip.
		constexpr float kCardMargin = 12.0F;
		constexpr float kBackWidth = 100.0F;

		ui::Layout column(float gap) {
			return {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Stretch
			};
		}

		ui::Layout wrapRow(float gap) {
			ui::Layout layout{
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = ui::AlignItems::Start
			};
			layout.flexWrap = ui::FlexWrap::Wrap;
			layout.padding = ui::Edges(kCardMargin);
			return layout;
		}

		std::string capitalised(std::string_view text) {
			std::string out(text);
			if (!out.empty()) {
				out[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(out[0])));
			}
			return out;
		}

		class CardShowcaseScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kCardShowcase; }

			std::string exportState() const override { return nlohmann::json{{"cards", shown}}.dump(); }

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				if (!ui().icons().has("food")) {
					ui().icons().add(icons::iconAtlas());
				}
				build();
			}

		  private:
			void build() {
				const rules::Content&					  content = game().rules.content;
				std::vector<const rules::CardDefinition*> cards;
				for (const auto& [id, definition] : content.cards) {
					cards.push_back(&definition);
				}
				std::ranges::sort(cards, [](const rules::CardDefinition* a, const rules::CardDefinition* b) { return a->name < b->name; });
				shown = static_cast<int>(cards.size());

				ui::Layout sheetLayout = column(8.0F);
				sheetLayout.padding = ui::Edges(0.0F, 48.0F, 50.0F, 46.0F);
				ui::Ref<atlas::Sheet>  sheet = root().addChild<atlas::Sheet>({
					 .id = "sheet",
					 .size = {ui::percent(100.0F), ui::percent(100.0F)},
					 .layout = sheetLayout,
					 .onKeyDown = [this](ui::KeyEvent& event) { keys(event); },
					 .identity = std::string(scenes::kCardShowcase),
				 });
				ui::Ref<ui::Component> tabs = atlas::sectionTabs(
					sheet,
					{
						{.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
						{.id = "tab_cards", .label = "Card showcase", .active = true, .deckGlyph = true},
					}
				);
				ui::Layout tabsLayout = tabs.get()->getLayout();
				tabsLayout.alignSelf = ui::AlignItems::Center;
				tabsLayout.flexShrink = 0.0F;
				tabs.get()->setLayout(tabsLayout);
				// Focus starts on Menu, so the keys reach the sheet and Enter goes back.
				if (ui::Component* menu = ui().find(tabs.get()->getChildren().front())) {
					menu->focus();
				}

				ui::Ref<ui::Component> heading = sheet.addChild<ui::Component>({.layout = [] {
					ui::Layout layout{
						.display = ui::Display::Flex,
						.flexDirection = ui::FlexDirection::Row,
						.gap = 16.0F,
						.alignItems = ui::AlignItems::End
					};
					layout.flexShrink = 0.0F;
					return layout;
				}()});
				heading.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = "Card showcase"});
				heading.addChild<ui::Text>(
					{.id = "count", .style = styles::subtitle, .text = std::to_string(cards.size()) + " cards, both decks, every size"}
				);

				ui::Ref<ui::Component> list = sheet.addChild<ui::Component>({
					.id = "showcase",
					.minSize = {0.0F, 0.0F},
					.layout =
						[] {
							ui::Layout layout = column(14.0F);
							layout.flexGrow = 1.0F;
							return layout;
						}(),
					.overflow = ui::Overflow::Scroll,
				});
				scroller = list;

				decks(list);
				sizes(list, sample(cards));
				group(list, "faces", "Every card (" + std::to_string(cards.size()) + ")", cards, CardSize::Face);
				for (const auto& [name, rarity] : rules::kRarityNames) {
					std::vector<const rules::CardDefinition*> ofRarity;
					std::ranges::copy_if(cards, std::back_inserter(ofRarity), [rarity](const rules::CardDefinition* card) {
						return card->rarity == rarity;
					});
					if (!ofRarity.empty()) {
						group(
							list,
							std::string(name),
							capitalised(name) + " (" + std::to_string(ofRarity.size()) + ")",
							ofRarity,
							CardSize::Mini
						);
					}
				}
			}

			// A card with an upgrade and keywords in its summary, to show the sizes and states on.
			static const rules::CardDefinition& sample(const std::vector<const rules::CardDefinition*>& cards) {
				const auto found = std::ranges::find_if(cards, [](const rules::CardDefinition* card) {
					return card->upgrade.has_value() && card->summary.find('[') != std::string::npos && card->cost > 0;
				});
				return found != cards.end() ? **found : *cards.front();
			}

			static ui::Ref<ui::Component> section(ui::Ref<ui::Component> list, const std::string& id, const std::string& title, float gap) {
				ui::Ref<ui::Component> part = list.addChild<ui::Component>({.id = id, .layout = column(4.0F)});
				part.addChild<ui::Text>({.id = id + "_title", .style = styles::sectionHead, .text = title});
				return part.addChild<ui::Component>({.id = id + "_cards", .layout = wrapRow(gap)});
			}

			static void decks(ui::Ref<ui::Component> list) {
				ui::Ref<ui::Component> row = section(list, "decks", "The decks", kFaceGap);
				for (const int seat : {0, 1}) {
					ui::Ref<ui::Component> deck = row.addChild<ui::Component>({.layout = column(6.0F)});
					deck.addChild<cards::CardBack>({.id = seat == 0 ? "back_a" : "back_b", .seat = seat, .width = kBackWidth});
					deck.addChild<ui::Text>({.style = styles::kicker, .text = seat == 0 ? "Deck A" : "Deck B"});
				}
			}

			// The sizes a card comes in and the states it shows, on the board's examples.
			static void sizes(ui::Ref<ui::Component> list, const rules::CardDefinition& sample) {
				ui::Ref<ui::Component> row = section(list, "sizes", "Sizes and states", kFaceGap);
				struct Example {
					std::string		   id;
					std::string		   caption;
					CardSize		   cardSize;
					std::optional<int> seat;
					int				   copies = 1;
					MiniState		   state = MiniState::None;
					bool			   unaffordable = false;
					bool			   upgraded = false;
				};
				const std::vector<Example> examples{
					{.id = "face_a", .caption = "Driver 1's", .cardSize = CardSize::Face, .seat = 0},
					{.id = "face_b", .caption = "Driver 2's, upgraded", .cardSize = CardSize::Face, .seat = 1, .upgraded = true},
					{.id = "face_dear", .caption = "Can't pay", .cardSize = CardSize::Face, .seat = 0, .unaffordable = true},
					{.id = "mini_one", .caption = "One copy", .cardSize = CardSize::Mini},
					{.id = "mini_stack", .caption = "A stack of five", .cardSize = CardSize::Mini, .seat = 0, .copies = 5},
					{.id = "mini_borrowed", .caption = "Borrowed", .cardSize = CardSize::Mini, .seat = 1, .state = MiniState::Borrowed},
					{.id = "mini_home", .caption = "Left at home", .cardSize = CardSize::Mini, .seat = 0, .state = MiniState::Home},
					{.id = "mini_locked", .caption = "Locked", .cardSize = CardSize::Mini, .seat = 1, .state = MiniState::Locked},
					{.id = "mini_unavailable", .caption = "Can't be added", .cardSize = CardSize::Mini, .state = MiniState::Unavailable},
				};
				for (const Example& example : examples) {
					ui::Ref<ui::Component> cell = row.addChild<ui::Component>({.layout = column(10.0F)});
					cell.addChild<Card>({
						.id = example.id,
						.card = &sample,
						.upgraded = example.upgraded,
						.cardSize = example.cardSize,
						.seat = example.seat,
						.copies = example.copies,
						.state = example.state,
						.unaffordable = example.unaffordable,
					});
					cell.addChild<ui::Text>({
						.id = example.id + "_caption",
						.size = {Card::sizeOf(example.cardSize).x, ui::kAuto},
						.style = styles::note,
						.text = example.caption,
						.wrap = true,
					});
				}
			}

			static void group(
				ui::Ref<ui::Component>							 list,
				const std::string&								 id,
				const std::string&								 title,
				const std::vector<const rules::CardDefinition*>& cards,
				CardSize										 cardSize
			) {
				ui::Ref<ui::Component> row = section(list, id, title, cardSize == CardSize::Face ? kFaceGap : cards::mini::kGridGap);
				for (const rules::CardDefinition* card : cards) {
					row.addChild<Card>({.id = id + "_" + card->id.value, .card = card, .cardSize = cardSize});
				}
			}

			// Page Up and Page Down scroll the cards; Escape, unless a pinned card took it, goes back to the menu.
			void keys(ui::KeyEvent& event) {
				if (event.type == ui::KeyEvent::Type::Cancel) {
					app().scenes().switchTo(scenes::kMainMenu);
					event.consume();
					return;
				}
				if (event.type == ui::KeyEvent::Type::Down &&
					(event.key == foundation::Key::PageDown || event.key == foundation::Key::PageUp)) {
					scrollPage(event.key == foundation::Key::PageDown ? 1.0F : -1.0F);
					event.consume();
				}
			}

			void scrollPage(float pages) {
				if (ui::Component* list = scroller.get()) {
					list->scrollBy({0.0F, pages * list->getSize().y * 0.9F});
				}
			}

			ui::Ref<ui::Component> scroller;
			int					   shown = 0;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCardShowcaseScene() {
		return std::make_unique<CardShowcaseScene>();
	}

} // namespace game
