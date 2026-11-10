// A supply run on the road (Game Flow 3.4 and 5; campaign.md, Supply runs), in the atlas: the run's heading and the step
// it's at in a fresh box, with the crew and the cargo under it; the road on the right, its stops in driving order with
// the one it's at in highlighter, then the destination and home; and the step's highway pinned at the column's foot.
// What the run meets next is ahead()'s, and each step is the rules' own call (a fight through the battle scene, a find,
// an event through the event scene, a reward picked from its cards as cards, the objective, the road home), saved as it
// ends; a run home or failed goes to its debrief.

#include "Words.h"
#include "atlas/ArtView.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Gauges.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/ResourceStrip.h"
#include "atlas/Tokens.h"
#include "cards/Card.h"
#include "scenes/GameScene.h"
#include "scenes/battle/BattleScene.h"
#include "scenes/debrief/DebriefScene.h"
#include "scenes/event/EventScene.h"
#include "scenes/event/EventText.h"
#include "scenes/map/MapPage.h"
#include "scenes/map/Planning.h"
#include "scenes/result/BattleResultScene.h"

#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/EventStops.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>
#include <ui/shapes/Rectangle.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>

namespace game {

	namespace {

		using rules::campaign::Ahead;
		using rules::campaign::Campaign;
		namespace styles = atlas::styles::print;
		namespace palette = atlas::tokens::palette;

		// Room round the cards for what they draw past their boxes: the hex, a stack, a count.
		constexpr float kCardMargin = 12.0F;
		constexpr float kStampWidth = 150.0F;

		std::string aheadName(Ahead ahead) {
			switch (ahead) {
				case Ahead::Fight:
					return "fight";
				case Ahead::Find:
					return "find";
				case Ahead::Event:
					return "event";
				case Ahead::Reward:
					return "reward";
				case Ahead::Objective:
					return "objective";
				case Ahead::Home:
					return "home";
			}
			return "";
		}

		ui::Layout row(float gap, ui::AlignItems align = ui::AlignItems::Center) {
			return {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = align};
		}

		ui::Layout grown(ui::Layout layout, float grow = 1.0F) {
			layout.flexGrow = grow;
			return layout;
		}

		ui::Layout fixed(ui::Layout layout) {
			layout.flexShrink = 0.0F;
			return layout;
		}

		ui::Layout cardRow() {
			ui::Layout layout = row(14.0F, ui::AlignItems::Start);
			layout.flexWrap = ui::FlexWrap::Wrap;
			layout.padding = ui::Edges(kCardMargin);
			return layout;
		}

		// What the step box says and offers: its kicker, head and line, and the highway's label and id, none for a step
		// that's taken by a card.
		struct Step {
			std::string kicker;
			std::string head;
			std::string line;
			std::string action;
			std::string actionId;
			std::string after; // under the highway: what pressing it does
		};

		class RunScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kRun; }

			std::string exportState() const override {
				if (!game().session || !onTheRoad()) {
					return "null";
				}
				const rules::campaign::RunRoute& route = *game().session->campaign.run->route;
				return nlohmann::json{
					{"poi", route.poi},
					{"route", route.route},
					{"stops", route.stops.size()},
					{"next", route.next},
					{"ahead", aheadName(rules::campaign::ahead(game().session->campaign, game().session->layers()))},
					{"notice", notice},
				}
					.dump();
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
				if (!onTheRoad()) {
					LOG_ERROR(Game, "RunScene: no run is on the road; to the compound");
					app().scenes().switchTo(scenes::kCompound);
					return;
				}
				build();
			}

		  private:
			[[nodiscard]] bool onTheRoad() const {
				const Campaign& campaign = game().session->campaign;
				return campaign.run.has_value() && campaign.run->route.has_value();
			}

			Campaign& campaign() { return game().session->campaign; }

			void build() {
				const Session&					 session = *game().session;
				const rules::campaign::RunRoute& route = *session.campaign.run->route;
				const Planning					 planned = planning(session);
				const Destination*				 found = planned.find(route.poi);
				destination = found != nullptr ? std::optional<Destination>(*found) : std::nullopt;
				if (!destination) {
					LOG_ERROR(Game, "RunScene: the run's POI %d isn't on the map's destinations", route.poi);
				}
				std::string routeName;
				if (destination) {
					for (const rules::map::RouteOffer& offer : destination->routes) {
						routeName = offer.route.route == route.route ? offer.route.name : routeName;
					}
				}
				// The page is rebuilt whole: the old sheet goes first.
				if (sheetPage.sheet.get() != nullptr) {
					root().get()->removeChild(sheetPage.sheet);
				}
				sheetPage = openMapPage(
					root(),
					scenes::kRun,
					{
						{.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
						{.id = "tab_compound", .label = "Compound", .onPress = [this] { app().scenes().switchTo(scenes::kCompound); }},
						{.id = "tab_area_map", .label = "Area map", .active = true},
						{.id = "tab_crew", .label = "Crew", .enabled = false, .deckGlyph = true},
					}
				);
				sheetPage.heading.addChild<ui::Text>({
					.id = "title",
					.minSize = {0.0F, 0.0F},
					.layout = {.flexShrink = 1.0F},
					.style = styles::screenTitle,
					.text = "Run to " + poiName(),
					.wrap = true,
				});
				sheetPage.heading.addChild<ui::Text>({
					.id = "subtitle",
					.layout = {.flexShrink = 0.0F},
					.style = styles::subtitle,
					.text = "day " + std::to_string(session.campaign.day) + (routeName.empty() ? "" : ", " + routeName),
				});

				const Ahead next = rules::campaign::ahead(session.campaign, session.layers());
				const Step	step = describeStep(next);
				stepBox(next, step);
				ui::Ref<ui::Component> ledgers =
					sheetPage.plate.addChild<ui::Component>({.id = "ledgers", .layout = fixed(row(14.0F, ui::AlignItems::Stretch))});
				crewBox(ledgers);
				cargoBox(ledgers);
				roadBox(route, next);
				primary(next, step);
			}

			[[nodiscard]] std::string poiName() const { return destination ? destination->name : "the destination"; }

			// "stop 2 of 5", or the road home past the stops.
			[[nodiscard]] std::string where() const {
				const rules::campaign::RunRoute& route = *game().session->campaign.run->route;
				if (route.next >= static_cast<int>(route.stops.size())) {
					return route.objective ? "the road home" : poiName();
				}
				return "stop " + std::to_string(route.next + 1) + " of " + std::to_string(route.stops.size() + 1);
			}

			[[nodiscard]] const rules::map::Stop* stopHere() const {
				const std::optional<int> stop = rules::campaign::stopAhead(game().session->campaign);
				return stop ? &game().session->layers().stops.stops.at(static_cast<size_t>(*stop)) : nullptr;
			}

			[[nodiscard]] Step describeStep(Ahead next) const {
				const Session&					 session = *game().session;
				const rules::campaign::RunRoute& route = *session.campaign.run->route;
				const rules::map::Stop*			 stop = stopHere();
				Step							 step{.kicker = where()};
				switch (next) {
					case Ahead::Fight:
						step.action = "Fight";
						step.actionId = "fight";
						step.after = "Win, and the raiders' cards are on offer.";
						if (route.handOff) {
							step.head = "Raiders, " + counted(route.handOff->skulls, "skull", "skulls");
							step.line = "The event turned into a fight. Fighting them is the only way on.";
						} else if (stop == nullptr) {
							step.head = "Ambush on the road home";
							step.line = "Raiders wait between the convoy and home. Fighting them is the only way past.";
						} else {
							step.head = stopText(*stop);
							step.line = "Raiders hold the road ahead. Driving on starts the fight.";
						}
						return step;
					case Ahead::Find:
						step.head = stop != nullptr ? stopText(*stop) : "A find";
						findStep(step);
						return step;
					case Ahead::Event:
						step.head = stop != nullptr ? stopText(*stop) : "An event";
						step.line = stop != nullptr ? event::fromTheRoad(stop->type) : "Something on the road ahead.";
						step.action = "Pull over";
						step.actionId = "pull_over";
						step.after = "Only a choice gets the convoy past it.";
						return step;
					case Ahead::Reward:
						step.head = stop == nullptr || rules::map::isFight(stop->type) || route.handOff ? "Fight won: pick a card"
									: stop->type == rules::map::StopType::FindCards						? "Cards found: pick one"
																										: "Pick a card";
						step.line = "It rides home as cargo, and reaches the locker if the run gets home.";
						return step;
					case Ahead::Objective:
						step.head = poiName() + " reached";
						step.line = "Its yield, " + objectiveYield() + ", goes into the cargo. Then the road home.";
						step.action = "Take the objective";
						step.actionId = "take_objective";
						step.after = "Whatever waits on the road home shows once it's taken.";
						return step;
					case Ahead::Home:
						step.kicker = "the road home";
						step.head = "The road home is clear";
						step.line = "Getting home unloads the cargo into the stores and ends the day.";
						step.action = "Drive home";
						step.actionId = "drive_home";
						step.after = "Home, and the day ends.";
						return step;
				}
				return step;
			}

			// The objective's yield, the rules' own on a copy: the return ambush it rolls stays unknown until it's taken.
			[[nodiscard]] std::string objectiveYield() const {
				Campaign copy = game().session->campaign;
				return amountsText(rules::campaign::takeObjective(copy, game().rules.campaign, game().session->layers()).yields);
			}

			// What a find holds, the rules' own takeFind on a copy, so the box says what Take it brings.
			void findStep(Step& step) const {
				const GameRules&				 loaded = game().rules;
				Campaign						 copy = game().session->campaign;
				const rules::campaign::TakenFind found =
					rules::campaign::takeFind(copy, loaded.content, loaded.campaign, game().session->layers(), loaded.unlocked);
				step.actionId = "take_find";
				if (found.haul) {
					step.line = std::to_string(found.haul->amount) + " " +
								std::string(nameOf(rules::map::kResourceNames, found.haul->resource)) +
								" stashed by the road. Load it, or drive on.";
					step.action = "Load it";
					step.after = "It rides home in the cargo.";
				} else if (found.driver) {
					if (const auto* missing = std::get_if<rules::campaign::CrewId>(&*found.driver)) {
						step.line = rules::campaign::driverName(copy, loaded.content, *missing) +
									" flags the convoy down, alive. Take them home, or drive on.";
						step.action = "Take them home";
					} else {
						const auto& archetype = std::get<rules::DriverId>(*found.driver);
						std::string who = anArchetype(loaded.content, archetype);
						who.front() = static_cast<char>(std::toupper(static_cast<unsigned char>(who.front())));
						step.line = who + " flags the convoy down, looking for a compound to join. Take them on, or drive on.";
						step.action = "Take them on";
					}
					step.after = "They ride home with the run.";
				} else {
					step.line = "A gutted trailer off the shoulder, a crate of cards still in it. Look through them, or drive on.";
					step.action = "Look through them";
					step.after = "Pick one to bring home, or none.";
				}
			}

			void stepBox(Ahead next, const Step& step) {
				ui::Ref<atlas::LegendBox> box = sheetPage.plate.addChild<atlas::LegendBox>({
					.id = "step",
					.layout = {.flexShrink = 0.0F},
					.style = {.backgroundColor = ui().getTheme().get(palette::freshPaper)},
					.look = {.seed = atlas::paperSeed("run/step"), .wear = atlas::Wear::Clean},
				});
				ui::Ref<ui::Component>	  head = box.addChild<ui::Component>({.layout = row(16.0F, ui::AlignItems::Center)});
				ui::Ref<ui::Component>	  words = head.addChild<ui::Component>({
					   .minSize = {0.0F, 0.0F},
					   .layout = grown(
						   {.display = ui::Display::Flex,
							.flexDirection = ui::FlexDirection::Column,
							.gap = 4.0F,
							.alignItems = ui::AlignItems::Stretch}
					   ),
				   });
				words.addChild<ui::Text>({.id = "step_kicker", .style = styles::kicker, .text = step.kicker});
				words.addChild<ui::Text>({.id = "step_head", .style = styles::boxTitle, .text = step.head, .wrap = true});
				// The run's one hero mark: the destination struck LOOTED once its yield is in the cargo.
				if (campaign().run->route->objective) {
					head.addChild<atlas::ArtView>(
						{.id = "stamp", .size = {kStampWidth, ui::kAuto}, .layout = {.flexShrink = 0.0F}, .art = "stamp-looted"}
					);
				}
				box.addChild<ui::Text>({.id = "step_line", .style = styles::body, .text = step.line, .wrap = true});
				if (!notice.empty()) {
					box.addChild<ui::Text>({.id = "notice", .style = styles::note, .text = notice, .wrap = true});
				}
				if (next == Ahead::Reward) {
					rewardCards(box);
				}
				if (next == Ahead::Find) {
					box.addChild<atlas::AtlasButton>({
						.id = "leave_find",
						.layout = {.alignSelf = ui::AlignItems::Start},
						.label = "Leave it by the road",
						.onPress = [this] {
							act([this](Campaign& played, const Session& on) {
								rules::campaign::driveOn(played, on.layers());
								notice = "Left it by the road.";
							});
						},
					});
				}
			}

			// The reward's cards as faces (Game Flow 7.0), each taken by a press; or none, the back road.
			void rewardCards(ui::Ref<atlas::LegendBox> box) {
				const rules::Content&			  content = game().rules.content;
				const std::vector<rules::CardId>& reward = campaign().run->route->reward;
				const rules::map::Stop*			  stop = stopHere();
				ui::Ref<ui::Component>			  shelf = box.addChild<ui::Component>({
							   .id = "reward",
							   .layout = cardRow(),
							   .focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Horizontal},
				   });
				ui::Component*					  first = nullptr;
				for (size_t index = 0; index < reward.size(); ++index) {
					ui::Ref<cards::Card> card = shelf.addChild<cards::Card>({
						.id = "reward_" + std::to_string(index),
						.focusable = true,
						.card = &content.cards.at(reward[index]),
						.onPress = [this, card = reward[index]] {
							act([this, card](Campaign& played, const Session& on) {
								rules::campaign::takeReward(played, game().rules.content, on.layers(), card);
								notice = game().rules.content.cards.at(card).name + " rides home in the cargo.";
							});
						},
					});
					first = first != nullptr ? first : card.get();
				}
				const bool found = stop != nullptr && stop->type == rules::map::StopType::FindCards;
				box.addChild<atlas::AtlasButton>({
					.id = "take_none",
					.layout = {.alignSelf = ui::AlignItems::Start},
					.label = found ? "Leave them" : "Skip the card",
					.onPress = [this, found] {
						act([this, found](Campaign& played, const Session& on) {
							rules::campaign::takeReward(played, game().rules.content, on.layers(), std::nullopt);
							notice = found ? "Left the cards in the trailer." : "Took no card.";
						});
					},
				});
				if (first != nullptr) {
					first->focus();
				}
			}

			void crewBox(ui::Ref<ui::Component> ledgers) {
				const Campaign&			  played = game().session->campaign;
				const rules::Content&	  content = game().rules.content;
				ui::Ref<atlas::LegendBox> box = ledgers.addChild<atlas::LegendBox>({
					.id = "crew",
					.size = {0.0F, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.layout = {.flexGrow = 1.0F},
					.look = {.seed = atlas::paperSeed("run/crew"), .grab = atlas::Corner::BottomLeft},
					.title = "The crew",
				});
				for (size_t seat = 0; seat < played.run->seats.size(); ++seat) {
					const rules::campaign::DriverRecord& driver = played.driver(played.run->seats[seat].driver);
					const rules::DriverDefinition&		 archetype = content.drivers.at(driver.archetype);
					const std::string					 id = "seat_" + std::to_string(seat);
					ui::Ref<ui::Component> line = box.addChild<ui::Component>({.id = id, .layout = row(10.0F, ui::AlignItems::End)});
					line.addChild<ui::Text>({
						.id = id + "_name",
						.minSize = {0.0F, 0.0F},
						.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
						.style = styles::rowLabel,
						.text = rules::campaign::driverName(played, content, driver.id),
						.wrap = true,
					});
					line.addChild<ui::Text>({
						.id = id + "_hp",
						.layout = {.flexShrink = 0.0F},
						.style = styles::figure,
						.text = std::to_string(driver.hitpoints) + "/" + std::to_string(archetype.maxHitpoints) + " HP",
					});
					box.addChild<atlas::CasedBar>({
						.id = id + "_bar",
						.value =
							archetype.maxHitpoints > 0
								? std::clamp(static_cast<float>(driver.hitpoints) / static_cast<float>(archetype.maxHitpoints), 0.0F, 1.0F)
								: 0.0F,
						.seat = static_cast<int>(seat),
					});
					box.addChild<ui::Text>({
						.id = id + "_vehicle",
						.style = styles::caption,
						.text = archetype.vehicle.name + ", structure " + std::to_string(driver.vehicle.structure) + "/" +
								std::to_string(archetype.vehicle.maxStructure),
						.wrap = true,
					});
				}
				for (const rules::campaign::ConvoyId& escort : played.run->escorts) {
					if (const rules::campaign::ConvoyEscort* along = played.findEscort(escort)) {
						box.addChild<atlas::ContentsRow>({
							.id = "escort_" + escort.value,
							.label = content.escorts.at(along->type).name,
							.value = "STRUCTURE " + std::to_string(along->structure),
							.labelStyle = styles::body,
						});
					}
				}
			}

			void cargoBox(ui::Ref<ui::Component> ledgers) {
				const Campaign&				played = game().session->campaign;
				const rules::Content&		content = game().rules.content;
				const rules::campaign::Run& run = *played.run;
				ui::Ref<atlas::LegendBox>	box = ledgers.addChild<atlas::LegendBox>({
					  .id = "cargo",
					  .size = {0.0F, ui::kAuto},
					  .minSize = {0.0F, 0.0F},
					  .layout = {.flexGrow = 1.0F},
					  .look = {.seed = atlas::paperSeed("run/cargo"), .grab = atlas::Corner::BottomRight, .exposed = atlas::Side::Top},
					  .title = "Cargo",
				  });
				std::vector<atlas::Store>	stores;
				for (const auto& [id, name, amount] : {
						 std::tuple{"food", "Food", run.cargo.food},
						 std::tuple{"water", "Water", run.cargo.water},
						 std::tuple{"fuel", "Fuel", run.cargo.fuel},
						 std::tuple{"scrap", "Scrap", run.cargo.scrap},
						 std::tuple{"meds", "Meds", run.cargo.meds},
						 std::tuple{"people", "Settlers", run.cargo.people},
					 }) {
					if (amount > 0) {
						// The item's id is its icon's name too.
						stores.push_back({.id = id, .name = name, .value = std::to_string(amount)});
					}
				}
				if (!stores.empty()) {
					atlas::resourceStrip(box, stores);
				}
				int riders = 0;
				for (const rules::campaign::CrewId& found : run.found) {
					box.addChild<atlas::LegendRow>({
						.id = "rider_" + std::to_string(riders++),
						.symbol = atlas::MapSymbol::Ring,
						.text = rules::campaign::driverName(played, content, found) + ", found, rides home",
					});
				}
				for (const rules::DriverId& recruit : run.recruits) {
					std::string who = anArchetype(content, recruit);
					who.front() = static_cast<char>(std::toupper(static_cast<unsigned char>(who.front())));
					box.addChild<atlas::LegendRow>({
						.id = "rider_" + std::to_string(riders++),
						.symbol = atlas::MapSymbol::Ring,
						.text = who + " rides home to join the crew",
					});
				}
				if (!run.cargoCards.empty()) {
					ui::Ref<ui::Component> shelf = box.addChild<ui::Component>({.id = "cargo_cards", .layout = cardRow()});
					for (const auto& [card, copies] : run.cargoCards) {
						shelf.addChild<cards::Card>({
							.id = "cargo_" + card.value,
							.focusable = true,
							.card = &content.cards.at(card),
							.cardSize = cards::CardSize::Mini,
							.copies = copies,
						});
					}
				}
				if (stores.empty() && riders == 0 && run.cargoCards.empty()) {
					box.addChild<atlas::LegendRow>(
						{.id = "cargo_none", .symbol = atlas::MapSymbol::Dash, .text = "Nothing loaded yet", .textStyle = styles::quiet}
					);
				}
			}

			void roadBox(const rules::campaign::RunRoute& route, Ahead next) {
				const rules::map::StopLayer& layer = game().session->layers().stops;
				ui::Ref<ui::Component>		 scrolled = sheetPage.boxes.addChild<ui::Component>({
						  .id = "road_boxes",
						  .minSize = {0.0F, 0.0F},
						  .layout = grown(columnLayout(14.0F)),
						  .overflow = ui::Overflow::Scroll,
				  });
				ui::Ref<atlas::LegendBox>	 box = scrolled.addChild<atlas::LegendBox>({
					   .id = "road",
					   .layout = {.flexShrink = 0.0F},
					   .look = {.seed = atlas::paperSeed("run/road"), .grab = atlas::Corner::TopRight, .exposed = atlas::Side::Left},
					   .title = "The road",
				   });
				ui::Ref<ui::Component>		 rows = box.addChild<ui::Component>({.id = "road_rows", .layout = columnLayout(0.0F)});
				// The one the run is at in highlighter, the player's mark of where they are.
				const auto line = [&](const std::string& id,
									  const std::string& glyph,
									  const std::string& label,
									  const std::string& state,
									  bool				 behind,
									  bool				 here) {
					const atlas::ContentsRow::Args shown{
						.id = id,
						.label = label,
						.value = state,
						.glyph = glyph,
						.labelStyle =
							behind ? styles::rowLabel.extend({.color = ui().getTheme().get(palette::fadedPrint)}) : styles::rowLabel,
					};
					if (here) {
						rows.addChild<ui::Rectangle>({
														 .id = id + "_here",
														 .layout = columnLayout(0.0F),
														 .style = {.backgroundColor = ui().getTheme().get(palette::highlighterActive)},
													 })
							.addChild<atlas::ContentsRow>(shown);
					} else {
						rows.addChild<atlas::ContentsRow>(shown);
					}
				};
				const bool pastStops = route.next >= static_cast<int>(route.stops.size());
				for (size_t place = 0; place < route.stops.size(); ++place) {
					const int  at = static_cast<int>(place);
					const bool behind = at < route.next;
					const bool here = at == route.next;
					line(
						"stop_" + std::to_string(place),
						std::to_string(place + 1),
						stopText(layer.stops.at(static_cast<size_t>(route.stops[place]))),
						behind ? "PASSED"
						: here ? "HERE"
							   : "",
						behind,
						here
					);
				}
				const bool atPoi = pastStops && !route.objective;
				line("objective", "*", poiName(), route.objective ? "TAKEN" : atPoi ? "HERE" : "", route.objective, atPoi);
				const bool homeward = pastStops && route.objective;
				line("home", "", "Home", homeward ? (next == Ahead::Fight ? "AMBUSH" : "NEXT") : "", false, homeward);
				box.addChild<ui::Text>({
					.id = "road_note",
					.style = styles::note,
					.text = "Stops behind the run clear once it's home.",
					.wrap = true,
				});
			}

			void primary(Ahead next, const Step& step) {
				if (step.actionId.empty()) {
					sheetPage.primary.addChild<ui::Text>(
						{.id = "primary_line", .style = styles::caption, .text = "Pick one of the cards, or skip it.", .wrap = true}
					);
					return;
				}
				sheetPage.primary.addChild<atlas::AtlasButton>({
					.id = step.actionId,
					.label = step.action,
					.road = atlas::Road::Highway,
					.shield = true,
					.onPress = [this, next] { onPrimary(next); },
				});
				sheetPage.primary.addChild<ui::Text>({.id = "primary_line", .style = styles::caption, .text = step.after, .wrap = true});
			}

			void onPrimary(Ahead next) {
				switch (next) {
					case Ahead::Fight:
						fight();
						return;
					case Ahead::Find:
						act([this](Campaign& played, const Session& on) {
							const GameRules&				 loaded = game().rules;
							const rules::campaign::TakenFind found =
								rules::campaign::takeFind(played, loaded.content, loaded.campaign, on.layers(), loaded.unlocked);
							notice = found.haul ? "Loaded " + std::to_string(found.haul->amount) + " " +
													  std::string(nameOf(rules::map::kResourceNames, found.haul->resource)) + "."
									 : found.driver ? std::string("They ride home with the run.")
													: "Cards to look through.";
						});
						return;
					case Ahead::Event:
						app().scenes().push<EventScene>(EventArgs{.where = where()}, [this](EventNext after) { afterEvent(after); });
						return;
					case Ahead::Reward:
						return;
					case Ahead::Objective:
						act([this](Campaign& played, const Session& on) {
							const rules::campaign::ObjectiveTaken taken =
								rules::campaign::takeObjective(played, game().rules.campaign, on.layers());
							notice = "Loaded " + amountsText(taken.yields) + "." + (taken.ambush ? " Raiders wait on the road home." : "");
						});
						return;
					case Ahead::Home:
						driveHome();
						return;
				}
			}

			void fight() {
				const Session&						session = *game().session;
				rules::campaign::CampaignFightStart start =
					rules::campaign::startRunFight(session.campaign, game().rules.content, session.layers());
				app().scenes().push<BattleScene>(BattleArgs{.start = std::move(start)}, [this](rules::campaign::CampaignFight fought) {
					foughtThrough(std::move(fought));
				});
			}

			// Back from the event: into the fight it turned into at once, or the road as the choice left it.
			void afterEvent(EventNext after) {
				switch (after) {
					case EventNext::Fight:
						notice.clear();
						fight();
						return;
					case EventNext::PickCard:
						notice = "The event left cards to pick from.";
						break;
					case EventNext::DriveOn:
						notice = "The convoy drove on.";
						break;
					case EventNext::Back:
						notice.clear();
						break;
				}
				build();
			}

			// A step of the run on the campaign, saved once it's done.
			template <typename Change>
			void act(Change&& run) {
				Session& session = *game().session;
				try {
					run(session.campaign, session);
				} catch (const std::invalid_argument& error) {
					// The page offers only what the rules allow, so a refusal here is a bug.
					LOG_ERROR(Game, "RunScene: the rules refused a step the page offered: %s", error.what());
					notice = "That couldn't be done.";
				}
				saved();
				build();
			}

			void saved() {
				if (!game().store.save(campaign())) {
					notice = "The campaign couldn't be saved.";
				}
			}

			void foughtThrough(rules::campaign::CampaignFight fought) {
				Session&							  session = *game().session;
				const GameRules&					  loaded = game().rules;
				const rules::campaign::FightWriteBack back =
					rules::campaign::endRunFight(session.campaign, loaded.content, loaded.campaign, session.layers(), fought);
				if (back.outcome == rules::Outcome::Lost) {
					// A failed run ends the day (call 64), unless it ended the campaign.
					std::optional<rules::campaign::DayEnd> night;
					if (!session.campaign.end) {
						night = rules::campaign::endDay(session.campaign, loaded.content, loaded.campaign);
					}
					saved();
					app().scenes().replace<DebriefScene>(
						DebriefArgs{.home = std::nullopt, .lost = back.lost, .seats = back.seats, .night = night}
					);
					return;
				}
				notice.clear();
				saved();
				build();
				app().scenes().push<BattleResultScene>(BattleResultArgs{.fight = std::move(fought), .back = back});
			}

			void driveHome() {
				Session&							   session = *game().session;
				const GameRules&					   loaded = game().rules;
				rules::campaign::Unloaded			   home = rules::campaign::unloadRun(session.campaign, loaded.content, loaded.campaign);
				std::optional<rules::campaign::DayEnd> night = rules::campaign::endDay(session.campaign, loaded.content, loaded.campaign);
				saved();
				app().scenes().replace<DebriefScene>(
					DebriefArgs{.home = std::move(home), .lost = std::nullopt, .seats = {}, .night = night}
				);
			}

			MapPage					   sheetPage;
			std::optional<Destination> destination;
			std::string				   notice;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeRunScene() {
		return std::make_unique<RunScene>();
	}

} // namespace game
