// A supply run on the road (Game Flow 3.4 and 5; campaign.md, Supply runs), as rows: the route's stops in driving order
// with how far down them the run is, the crew and the cargo, and what the run meets next, which ahead() says. Each
// step is the rules' own call (a fight through the battle scene, a find, an event's choice, a reward, the objective,
// the road home), saved as it ends; a run home or failed goes to its debrief.

#include "Words.h"
#include "scenes/GameScene.h"
#include "scenes/battle/BattleScene.h"
#include "scenes/debrief/DebriefScene.h"

#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/EventStops.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>
#include <rules/map/RouteOffers.h>

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <string>
#include <utility>

namespace game {

	namespace {

		using rules::campaign::Ahead;
		using rules::campaign::Campaign;

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
			void enter() override {
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
				std::string						 poiName = "POI " + std::to_string(route.poi);
				std::string						 routeName;
				for (const rules::map::RouteOffer& offer : rules::campaign::offersToday(session.campaign, session.layers())) {
					if (offer.destination.poi == route.poi && offer.route.route == route.route) {
						poiName = offer.destination.name;
						routeName = offer.route.name;
					}
				}
				page = kit::openPage(*this, page, "Supply run to " + poiName, routeName);
				stops(route, poiName);
				crew();
				step(rules::campaign::ahead(session.campaign, session.layers()));
				kit::button(
					page.footer, "main_menu", "Main menu", [this] { app().scenes().switchTo(scenes::kMainMenu); }, ui::ButtonVariant::Ghost
				);
				kit::setNotice(page, notice);
			}

			void stops(const rules::campaign::RunRoute& route, const std::string& poiName) {
				const rules::map::StopLayer& layer = game().session->layers().stops;
				ui::Ref<ui::Component>		 list = kit::panel(page, "The route", "route");
				for (size_t place = 0; place < route.stops.size(); ++place) {
					const int		  at = route.next;
					const std::string where = static_cast<int>(place) < at ? "behind" : static_cast<int>(place) == at ? "here" : "ahead";
					kit::listRow(
						list,
						"stop_" + std::to_string(place),
						std::to_string(place + 1) + ". " + stopText(layer.stops[static_cast<size_t>(route.stops[place])]),
						where,
						[] {},
						false,
						static_cast<int>(place) == at
					);
				}
				kit::listRow(list, "objective", poiName, route.objective ? "objective taken" : "the objective", [] {});
				kit::listRow(list, "home", "The road home", route.ambush ? "an ambush waits" : "", [] {});
			}

			void crew() {
				const Campaign&		   played = game().session->campaign;
				const rules::Content&  content = game().rules.content;
				ui::Ref<ui::Component> list = kit::panel(page, "The crew", "crew");
				for (const rules::campaign::RunDeck& seat : played.run->seats) {
					const rules::campaign::DriverRecord& driver = played.driver(seat.driver);
					const rules::DriverDefinition&		 archetype = content.drivers.at(driver.archetype);
					kit::text(
						list,
						rules::campaign::driverName(played, content, driver.id) + ": " + std::to_string(driver.hitpoints) + "/" +
							std::to_string(archetype.maxHitpoints) + " HP, " + std::to_string(driver.vehicle.structure) + "/" +
							std::to_string(archetype.vehicle.maxStructure) + " structure"
					);
				}
				for (const rules::campaign::ConvoyId& escort : played.run->escorts) {
					if (const rules::campaign::ConvoyEscort* along = played.findEscort(escort)) {
						kit::caption(list, content.escorts.at(along->type).name + ": " + std::to_string(along->structure) + " structure");
					}
				}
				kit::caption(
					list,
					"Cargo: " + amountsText(played.run->cargo) + ", " +
						counted(rules::campaign::totalCards(played.run->cargoCards), "card", "cards") + " won"
				);
			}

			void step(Ahead next) {
				ui::Ref<ui::Component> here = kit::panel(page, "Ahead", "ahead");
				switch (next) {
					case Ahead::Fight:
						fightStep(here);
						return;
					case Ahead::Find:
						findStep(here);
						return;
					case Ahead::Event:
						eventStep(here);
						return;
					case Ahead::Reward:
						rewardStep(here);
						return;
					case Ahead::Objective:
						kit::text(here, "The run is at its POI.");
						kit::button(
							here,
							"take_objective",
							"Take the objective",
							[this] {
								act([this](Campaign& played, const Session& session) {
									const rules::campaign::ObjectiveTaken taken =
										rules::campaign::takeObjective(played, game().rules.campaign, session.layers());
									notice = "The yield: " + amountsText(taken.yields) + "." +
											 (taken.ambush ? " Raiders wait on the road home." : " The road home looks clear.");
								});
							},
							ui::ButtonVariant::Primary
						);
						return;
					case Ahead::Home:
						kit::text(here, "The road home is clear.");
						kit::button(here, "drive_home", "Drive home", [this] { driveHome(); }, ui::ButtonVariant::Primary);
						return;
				}
			}

			void fightStep(ui::Ref<ui::Component> here) {
				const rules::campaign::RunRoute& route = *campaign().run->route;
				const std::string				 what = route.handOff
															? "The event turned into a fight, " + counted(route.handOff->skulls, "skull", "skulls") + "."
														: route.objective ? "Raiders on the road home."
																		  : "Raiders ahead.";
				kit::text(here, what);
				kit::button(
					here,
					"fight",
					"Fight",
					[this] {
						const Session&						session = *game().session;
						rules::campaign::CampaignFightStart start =
							rules::campaign::startRunFight(session.campaign, game().rules.content, session.layers());
						app().scenes().push<BattleScene>(
							BattleArgs{.start = std::move(start)},
							[this](rules::campaign::CampaignFight fight) { foughtThrough(std::move(fight)); }
						);
					},
					ui::ButtonVariant::Primary
				);
			}

			void findStep(ui::Ref<ui::Component> here) {
				const Session&			 session = *game().session;
				const std::optional<int> stop = rules::campaign::stopAhead(session.campaign);
				kit::text(here, stop ? stopText(session.layers().stops.stops[static_cast<size_t>(*stop)]) : std::string("A find"));
				kit::button(
					here,
					"take_find",
					"Take it",
					[this] {
						act([this](Campaign& played, const Session& on) {
							const GameRules&				 loaded = game().rules;
							const rules::campaign::TakenFind found =
								rules::campaign::takeFind(played, loaded.content, loaded.campaign, on.layers(), loaded.unlocked);
							notice = found.haul ? "Found " + std::to_string(found.haul->amount) + " " +
													  std::string(nameOf(rules::map::kResourceNames, found.haul->resource)) + "."
									 : found.driver ? std::string("Found a driver, riding home with the run.")
													: "Cards to pick from.";
						});
					},
					ui::ButtonVariant::Primary
				);
				kit::button(here, "leave_find", "Leave it by the road", [this] {
					act([this](Campaign& played, const Session& on) {
						rules::campaign::driveOn(played, on.layers());
						notice = "Left it by the road.";
					});
				});
			}

			void eventStep(ui::Ref<ui::Component> here) {
				const Session&							session = *game().session;
				const GameRules&						loaded = game().rules;
				const rules::campaign::EventDefinition& event =
					rules::campaign::stopEvent(session.campaign, loaded.events, session.layers());
				kit::text(here, event.title, "event_title");
				kit::text(here, event.setup);
				kit::text(here, event.situation);
				for (const rules::campaign::EventChoice& choice : event.choices) {
					const std::optional<rules::campaign::ChoiceBlocker> blocked =
						rules::campaign::choiceBlocker(session.campaign, loaded.events, session.layers(), choice.id);
					kit::listRow(
						here,
						"choice_" + choice.id,
						choice.title,
						blocked ? choiceRefusalText(*blocked, choice.needs, loaded.content) : choice.preview,
						[this, id = choice.id, eventId = event.id] {
							act([this, id, eventId](Campaign& played, const Session& on) {
								const GameRules&				  packs = game().rules;
								const rules::campaign::EventTaken taken = rules::campaign::takeEventChoice(
									played, packs.content, packs.campaign, packs.events, on.layers(), packs.unlocked, id
								);
								for (const rules::campaign::EventChoice& made : packs.events.at(eventId).choices) {
									if (made.id == id) {
										notice = made.outcomes[static_cast<size_t>(taken.outcome)].text;
									}
								}
							});
						},
						blocked.has_value()
					);
				}
			}

			void rewardStep(ui::Ref<ui::Component> here) {
				const rules::Content&			  content = game().rules.content;
				const std::vector<rules::CardId>& reward = campaign().run->route->reward;
				kit::text(here, "Pick a card for the locker.");
				for (size_t index = 0; index < reward.size(); ++index) {
					kit::listRow(
						here,
						"reward_" + std::to_string(index),
						cardText(content, reward[index]),
						content.cards.at(reward[index]).summary,
						[this, card = reward[index]] {
							act([this, card](Campaign& played, const Session& on) {
								rules::campaign::takeReward(played, game().rules.content, on.layers(), card);
								notice = "Took " + game().rules.content.cards.at(card).name + ".";
							});
						}
					);
				}
				kit::button(here, "take_none", "Take none", [this] {
					act([this](Campaign& played, const Session& on) {
						rules::campaign::takeReward(played, game().rules.content, on.layers(), std::nullopt);
						notice = "Took nothing.";
					});
				});
			}

			// A step of the run on the campaign, saved once it's done.
			template <typename Step>
			void act(Step&& run) {
				Session& session = *game().session;
				try {
					run(session.campaign, session);
				} catch (const std::invalid_argument& error) {
					// The page offers only what the rules allow, so a refusal here is a bug.
					LOG_ERROR(Game, "RunScene: the rules refused a step the page offered: %s", error.what());
					notice = error.what();
				}
				saved();
				build();
			}

			void saved() {
				if (!game().store.save(campaign())) {
					notice = "The campaign couldn't be saved.";
				}
			}

			void foughtThrough(rules::campaign::CampaignFight fight) {
				Session&							  session = *game().session;
				const GameRules&					  loaded = game().rules;
				const rules::campaign::FightWriteBack back =
					rules::campaign::endRunFight(session.campaign, loaded.content, loaded.campaign, session.layers(), fight);
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
				notice = back.outcome == rules::Outcome::Won ? "The fight is won." : "The fight was broken off.";
				saved();
				build();
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

			std::string notice;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeRunScene() {
		return std::make_unique<RunScene>();
	}

} // namespace game
