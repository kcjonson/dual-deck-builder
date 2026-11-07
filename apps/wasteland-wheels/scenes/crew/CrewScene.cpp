// The Crew screen (Game Flow 3.2, crew-screen.md), opened from the bunkhouse and the Crew tab, in the atlas: the driver
// pool on the left as driver cards, the chosen one marked in highlighter and the lost below for the record; the chosen
// driver's default deck in the middle as minis with Remove under each and the cost curve; the locker on the right,
// filtered by kind, with Add and a two-press Scrap. Every control asks the rules (cardMoveBlocker, scrapBlocker) and says
// their reason under the card when they refuse; each move is saved as it's made.

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Highlighter.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/SectionTabs.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "cards/DriverCard.h"
#include "scenes/GameScene.h"
#include "scenes/crew/DeckBuilder.h"

#include <rules/campaign/Locker.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		using rules::campaign::Campaign;
		using rules::campaign::CardCounts;
		using rules::campaign::CrewId;
		using rules::campaign::DriverRecord;
		using rules::campaign::DriverStatus;

		constexpr float kRosterWidth = 200.0F;
		constexpr float kMarkPad = 6.0F;

		bool atCompound(const DriverRecord& driver) {
			return driver.status == DriverStatus::Ready || driver.status == DriverStatus::Injured;
		}

		// A driver's default deck as the Crew screen shows it: the record's, or, while they're out on a run, what of it their
		// run deck holds, going and left at home.
		CardCounts defaultDeckOf(const Campaign& campaign, const DriverRecord& driver) {
			if (const rules::campaign::RunDeck* deck = campaign.runDeckOf(driver.id)) {
				CardCounts counts = deck->own;
				rules::campaign::addCards(counts, deck->leftHome);
				return counts;
			}
			return driver.defaultDeck;
		}

		std::string standing(const Campaign& campaign, const DriverRecord& driver) {
			if (driver.status == DriverStatus::Injured) {
				return "Injured, fit in " + counted(driver.injuredDays, "day", "days");
			}
			return campaign.runDeckOf(driver.id) != nullptr ? "Out on a run" : "Ready";
		}

		class CrewScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kCrew; }

			std::string exportState() const override {
				if (!game().session) {
					return "null";
				}
				nlohmann::json deck = nlohmann::json::object();
				if (const DriverRecord* driver = chosenDriver()) {
					for (const auto& [card, count] : defaultDeckOf(game().session->campaign, *driver)) {
						deck[card.value] = count;
					}
				}
				return nlohmann::json{
					{"chosen", chosen ? nlohmann::json(chosen->value) : nlohmann::json(nullptr)},
					{"deck", deck},
					{"armed", armed.control},
					{"notice", notice},
				}
					.dump();
			}

			void update(const app::FrameContext& frame) override {
				if (armed.control.empty()) {
					return;
				}
				armed.seconds += frame.dt;
				if (armed.seconds >= crew::kArmHold) {
					disarm();
				}
			}

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				if (!ui().icons().has("food")) {
					ui().icons().add(icons::iconAtlas());
				}
				if (sessionOrMenu() == nullptr) {
					return;
				}
				for (const DriverRecord& driver : game().session->campaign.drivers) {
					if (atCompound(driver)) {
						chosen = driver.id;
						break;
					}
				}
				build();
				if (ui::Component* back = crew::findUnder(ui(), sheet.get(), "tab_compound")) {
					back->focus();
				}
			}

		  private:
			[[nodiscard]] const DriverRecord* chosenDriver() const {
				return chosen ? game().session->campaign.findDriver(*chosen) : nullptr;
			}

			void build() {
				const Campaign&	  campaign = game().session->campaign;
				const std::string focused = ui().focused().get() != nullptr ? ui().focused().get()->getId() : std::string();
				if (sheet.get() != nullptr) {
					root().get()->removeChild(sheet);
				}
				ui::Layout sheetLayout = crew::column(8.0F);
				sheetLayout.padding = ui::Edges(0.0F, 48.0F, 50.0F, 46.0F);
				sheet = root().addChild<atlas::Sheet>({
					.id = "sheet",
					.size = {ui::percent(100.0F), ui::percent(100.0F)},
					.layout = sheetLayout,
					.onKeyDown = [this](ui::KeyEvent& event) { keys(event); },
					.identity = std::string(scenes::kCrew),
				});
				tabs(campaign);
				ui::Ref<ui::Component> heading =
					sheet.addChild<ui::Component>({.layout = crew::fixed(crew::row(16.0F, ui::AlignItems::End))});
				heading.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = "Crew and decks"});
				heading.addChild<ui::Text>(
					{.id = "subtitle", .style = styles::subtitle, .text = "Bunkhouse / default decks / changes here are free"}
				);
				if (!notice.empty()) {
					sheet.addChild<ui::Text>({.id = "notice", .style = styles::warning, .text = notice});
				}
				ui::Ref<ui::Component> body = sheet.addChild<ui::Component>({
					.id = "body",
					.minSize = {0.0F, 0.0F},
					.layout = crew::grown(crew::row(12.0F, ui::AlignItems::Stretch)),
				});
				roster(body, campaign);
				deck(body, campaign);
				locker(body, campaign);
				crew::refocus(ui(), sheet.get(), focused, {"locker_filter_All", "tab_compound"});
			}

			void tabs(const Campaign& campaign) {
				ui::Ref<ui::Component> row = atlas::sectionTabs(
					sheet,
					{
						{.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
						{.id = "tab_compound", .label = "Compound", .onPress = [this] { app().scenes().switchTo(scenes::kCompound); }},
						{.id = "tab_area_map",
						 .label = "Area map",
						 .enabled = !campaign.run.has_value(),
						 .onPress = [this] { app().scenes().switchTo(scenes::kAreaMap); }},
						{.id = "tab_crew", .label = "Crew", .active = true, .deckGlyph = true},
					}
				);
				ui::Layout layout = row.get()->getLayout();
				layout.alignSelf = ui::AlignItems::Center;
				layout.flexShrink = 0.0F;
				row.get()->setLayout(layout);
			}

			void roster(ui::Ref<ui::Component> body, const Campaign& campaign) {
				const rules::Content& content = game().rules.content;
				int					  home = 0;
				for (const DriverRecord& driver : campaign.drivers) {
					home += atCompound(driver) ? 1 : 0;
				}
				ui::Ref<atlas::LegendBox> box = body.addChild<atlas::LegendBox>({
					.id = "roster",
					.size = {kRosterWidth, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.layout = crew::fixed({}),
					.look = {.seed = atlas::paperSeed("crew/roster"), .grab = atlas::Corner::BottomLeft},
					.title = "Driver pool (" + std::to_string(home) + ")",
				});
				ui::Ref<ui::Component>	  list = box.addChild<ui::Component>({
					   .id = "roster_list",
					   .size = {ui::kAuto, 0.0F},
					   .minSize = {0.0F, 0.0F},
					   .layout = crew::grown(crew::column(10.0F, ui::AlignItems::Start)),
					   .overflow = ui::Overflow::Scroll,
					   .focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Vertical},
				   });
				const auto				  card = [&](const DriverRecord& driver, bool lost) {
					   ui::Layout markLayout = crew::column(0.0F);
					   markLayout.padding = ui::Edges(kMarkPad);
					   ui::Ref<atlas::Highlight> mark = list.addChild<atlas::Highlight>({
									   .id = "roster_" + driver.id.value + "_mark",
									   .layout = markLayout,
									   .identity = "crew/" + driver.id.value,
									   .marked = chosen == driver.id,
					   });
					   mark.addChild<cards::DriverCard>({
									   .id = "roster_" + driver.id.value,
									   .enabled = !lost,
									   .face = cards::driverFace(campaign, content, driver),
									   .faded = lost,
									   .onPress = [this, id = driver.id] { choose(id); },
					   });
				};
				for (const DriverRecord& driver : campaign.drivers) {
					if (atCompound(driver)) {
						card(driver, false);
					}
				}
				if (home == 0) {
					list.addChild<ui::Text>(
						{.id = "roster_empty", .style = styles::quiet, .text = "Nobody is at the compound.", .wrap = true}
					);
				}
				const bool anyLost = std::ranges::any_of(campaign.drivers, [](const DriverRecord& driver) { return !atCompound(driver); });
				if (anyLost) {
					list.addChild<ui::Text>({.id = "roster_lost", .style = styles::kicker, .text = "Lost on runs"});
					for (const DriverRecord& driver : campaign.drivers) {
						if (!atCompound(driver)) {
							card(driver, true);
						}
					}
				}
			}

			void deck(ui::Ref<ui::Component> body, const Campaign& campaign) {
				const GameRules&		  loaded = game().rules;
				const DriverRecord*		  driver = chosenDriver();
				ui::Ref<atlas::LegendBox> box = body.addChild<atlas::LegendBox>({
					.id = "deck",
					.size = {0.0F, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.layout = {.flexGrow = 1.0F},
					.look = {.seed = atlas::paperSeed("crew/deck"), .grab = atlas::Corner::BottomRight},
					.title = driver != nullptr ? rules::campaign::driverName(campaign, loaded.content, driver->id) : "Default deck",
				});
				if (driver == nullptr) {
					box.addChild<ui::Text>(
						{.id = "deck_empty", .style = styles::quiet, .text = "Nobody is at the compound to build a deck for.", .wrap = true}
					);
					return;
				}
				const rules::DriverDefinition& archetype = loaded.content.drivers.at(driver->archetype);
				box.addChild<ui::Text>(
					{.id = "deck_vehicle", .style = styles::note, .text = archetype.vehicle.name + " / " + archetype.specialty}
				);
				const CardCounts counts = defaultDeckOf(campaign, *driver);
				ui::Layout		 chipsLayout = crew::row(8.0F);
				chipsLayout.flexWrap = ui::FlexWrap::Wrap;
				ui::Ref<ui::Component> chips = box.addChild<ui::Component>({.id = "deck_chips", .layout = crew::fixed(chipsLayout)});
				crew::chip(chips, "deck_hp", "HP " + std::to_string(driver->hitpoints) + "/" + std::to_string(archetype.maxHitpoints));
				crew::chip(chips, "deck_hand", "HAND LIMIT " + std::to_string(archetype.handLimit));
				crew::chip(
					chips,
					"deck_size",
					"DECK " + std::to_string(rules::campaign::totalCards(counts)) + "/" + std::to_string(loaded.campaign.deck.mostCards)
				);
				crew::chip(chips, "deck_standing", standing(campaign, *driver));
				box.addChild<ui::Text>(
					{.id = "deck_kicker", .style = styles::kicker, .text = "Default deck / hover a card for its detail view"}
				);

				std::vector<crew::CardEntry> entries;
				std::array<int, 4>			 curve{};
				for (const auto& [card, count] : counts) {
					const rules::CardDefinition& definition = loaded.content.cards.at(card);
					curve.at(static_cast<size_t>(std::clamp(definition.cost, 0, 3))) += count;
					const rules::campaign::CardMove move{
						.card = card, .from = rules::campaign::DefaultDeck{driver->id}, .to = rules::campaign::Locker{}
					};
					entries.push_back({
						.key = card.value,
						.card = &definition,
						.copies = count,
						.controls = {{
							.key = "remove",
							.label = "Remove",
							.reason = refusal(rules::campaign::cardMoveBlocker(campaign, loaded.content, loaded.campaign.deck, move)),
							.run = [this, move] {
								step([this, move](Campaign& played) {
									rules::campaign::moveCards(played, game().rules.content, game().rules.campaign.deck, move);
								});
							},
						}},
					});
				}
				crew::sortEntries(entries);
				ui::Ref<ui::Component> scroll = box.addChild<ui::Component>({
					.id = "deck_scroll",
					.size = {ui::kAuto, 0.0F},
					.minSize = {0.0F, 0.0F},
					.layout = crew::grown(crew::column(0.0F)),
					.overflow = ui::Overflow::Scroll,
				});
				crew::cardGrid(scroll, {.id = "deck", .entries = std::move(entries), .armed = &armed, .arm = [this](const std::string& id) {
											arm(id);
										}});
				ui::Ref<ui::Component> foot =
					box.addChild<ui::Component>({.id = "deck_foot", .layout = crew::fixed(crew::row(12.0F, ui::AlignItems::End))});
				foot.addChild<ui::Text>({.id = "deck_curve_label", .style = styles::kicker, .text = "Cost curve"});
				crew::costCurve(foot, "deck_curve", curve);
				box.addChild<ui::Text>({
					.id = "deck_limits",
					.style = styles::note,
					.text = "Decks stay between " + std::to_string(loaded.campaign.deck.fewestCards) + " and " +
							std::to_string(loaded.campaign.deck.mostCards) + " cards.",
					.wrap = true,
				});
			}

			void locker(ui::Ref<ui::Component> body, const Campaign& campaign) {
				const GameRules&		  loaded = game().rules;
				const DriverRecord*		  driver = chosenDriver();
				ui::Ref<atlas::LegendBox> box = body.addChild<atlas::LegendBox>({
					.id = "locker",
					.size = {0.0F, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.layout = {.flexGrow = 1.0F},
					.look = {.seed = atlas::paperSeed("crew/locker"), .grab = atlas::Corner::TopRight},
					.title = "Locker",
				});
				box.addChild<ui::Text>({.id = "locker_kicker", .style = styles::kicker, .text = "Spare cards, shared by every driver"});
				crew::kindFilter(box, "locker_filter", filter, [this](crew::CardKind kind) { pickFilter(kind); }, "crew/locker_filter");

				std::vector<crew::CardEntry> entries;
				for (const auto& [card, count] : campaign.locker) {
					const rules::CardDefinition& definition = loaded.content.cards.at(card);
					if (!crew::passesFilter(definition, filter)) {
						continue;
					}
					crew::EntryControl add{.key = "add", .label = "Add"};
					if (driver == nullptr) {
						add.reason = "No driver chosen";
					} else {
						const rules::campaign::CardMove move{
							.card = card, .from = rules::campaign::Locker{}, .to = rules::campaign::DefaultDeck{driver->id}
						};
						add.reason = refusal(rules::campaign::cardMoveBlocker(campaign, loaded.content, loaded.campaign.deck, move));
						add.run = [this, move] {
							step([this, move](Campaign& played) {
								rules::campaign::moveCards(played, game().rules.content, game().rules.campaign.deck, move);
							});
						};
					}
					const std::optional<rules::campaign::CardBlocker> scrapRefused = rules::campaign::scrapBlocker(campaign, card, 1);
					const bool										  otherArchetype =
						driver != nullptr && definition.driverRestriction && *definition.driverRestriction != driver->archetype;
					entries.push_back({
						.key = card.value,
						.card = &definition,
						.copies = count,
						.state = otherArchetype ? cards::MiniState::Unavailable : cards::MiniState::None,
						.controls = {
							add,
							{.key = "scrap", .label = "Scrap", .reason = refusal(scrapRefused), .destructive = true, .run = [this, card] {
								 step([this, card](Campaign& played) {
									 rules::campaign::scrapCards(played, game().rules.campaign.deck, card, 1);
								 });
							 }}
						},
					});
				}
				crew::sortEntries(entries);
				ui::Ref<ui::Component> scroll = box.addChild<ui::Component>({
					.id = "locker_scroll",
					.size = {ui::kAuto, 0.0F},
					.minSize = {0.0F, 0.0F},
					.layout = crew::grown(crew::column(0.0F)),
					.overflow = ui::Overflow::Scroll,
				});
				if (entries.empty()) {
					scroll.addChild<ui::Text>({
						.id = "locker_empty",
						.style = styles::quiet,
						.text = campaign.locker.empty() ? "The locker is empty." : "Nothing of that kind in the locker.",
						.wrap = true,
					});
				} else {
					crew::cardGrid(
						scroll,
						{.id = "locker", .entries = std::move(entries), .armed = &armed, .arm = [this](const std::string& id) { arm(id); }}
					);
				}
				box.addChild<ui::Text>({
					.id = "locker_note",
					.style = styles::note,
					.text = "Rewards and finds land here. Scrap destroys a copy for " + std::to_string(loaded.campaign.deck.scrapPerCard) +
							" scrap; the compound has " + std::to_string(campaign.stores.scrap) + ".",
					.wrap = true,
				});
			}

			[[nodiscard]] std::optional<std::string> refusal(const std::optional<rules::campaign::CardBlocker>& blocker) const {
				if (!blocker) {
					return std::nullopt;
				}
				return cardRefusalText(game().session->campaign, *blocker, game().rules.content);
			}

			void choose(const CrewId& driver) {
				chosen = driver;
				armed = {};
				build();
				if (ui::Component* card = crew::findUnder(ui(), sheet.get(), "roster_" + driver.value)) {
					card->focus();
				}
			}

			void pickFilter(crew::CardKind kind) {
				filter = kind;
				armed = {};
				build();
			}

			void arm(const std::string& control) {
				armed = {.control = control, .seconds = 0.0};
				build();
			}

			void disarm() {
				armed = {};
				build();
			}

			// Escape lets go of an armed Scrap first, then goes back to the compound.
			void keys(ui::KeyEvent& event) {
				if (event.type != ui::KeyEvent::Type::Cancel) {
					return;
				}
				if (!armed.control.empty()) {
					disarm();
				} else {
					app().scenes().switchTo(scenes::kCompound);
				}
				event.consume();
			}

			// One move on the campaign, saved once it's made.
			template <typename Action>
			void step(Action&& action) {
				Campaign& campaign = game().session->campaign;
				action(campaign);
				armed = {};
				notice = game().store.save(campaign) ? std::string() : std::string("The campaign couldn't be saved.");
				build();
			}

			ui::Ref<atlas::Sheet> sheet;
			std::optional<CrewId> chosen;
			crew::CardKind		  filter = crew::CardKind::All;
			crew::Armed			  armed;
			std::string			  notice;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCrewScene() {
		return std::make_unique<CrewScene>();
	}

} // namespace game
