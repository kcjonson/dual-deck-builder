// The compound (Game Flow 3.1): the day, the stores, the needs, the pool and the convoy, and the log, with the day's
// actions: plan a supply run, send a scavenging party, or rest. Each action is the rules' own, saved as it ends; a
// night that ends the campaign goes to its end.

#include "Words.h"
#include "scenes/GameScene.h"

#include <rules/campaign/CampaignEnd.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <string>

namespace game {

	namespace {

		using rules::campaign::Campaign;

		std::string needLine(const char* what, const rules::campaign::Need& need) {
			if (!need.days) {
				return std::string(what) + ": nobody to feed";
			}
			if (need.shortTonight) {
				return std::string(what) + " runs short tonight";
			}
			return std::string(what) + " runs out in " + counted(*need.days, "day", "days");
		}

		class CompoundScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kCompound; }

			std::string exportState() const override {
				if (!game().session) {
					return "null";
				}
				const Campaign& campaign = game().session->campaign;
				return nlohmann::json{
					{"day", campaign.day},
					{"summary", campaignSummary(campaign)},
					{"runOut", campaign.run.has_value()},
					{"notice", notice},
				}
					.dump();
			}

		  protected:
			void enter() override {
				if (sessionOrMenu() == nullptr) {
					return;
				}
				if (game().session->campaign.end) {
					app().scenes().switchTo(scenes::kCampaignEnd);
					return;
				}
				build();
			}

		  private:
			void build() {
				const GameRules& loaded = game().rules;
				const Campaign&	 campaign = game().session->campaign;
				page = kit::openPage(*this, page, "The compound", campaignSummary(campaign));

				ui::Ref<ui::Component> stores = kit::panel(page, "Stores", "stores");
				kit::text(stores, storesText(campaign.stores), "stores_line");
				kit::caption(stores, "Unrest " + std::to_string(campaign.unrest));
				const rules::campaign::Forecast forecast = rules::campaign::forecastNeeds(campaign.stores, loaded.campaign.compound);
				kit::caption(stores, needLine("Food", forecast.food));
				kit::caption(stores, needLine("Water", forecast.water));

				ui::Ref<ui::Component> crew = kit::panel(page, "Drivers", "drivers");
				for (const rules::campaign::DriverRecord& driver : campaign.drivers) {
					kit::listRow(crew, "driver_" + driver.id.value, driverStanding(campaign, loaded.content, driver), "", [] {});
				}
				if (!campaign.convoy.empty()) {
					kit::caption(crew, "Convoy");
				}
				for (const rules::campaign::ConvoyEscort& escort : campaign.convoy) {
					const rules::EscortDefinition& type = loaded.content.escorts.at(escort.type);
					kit::listRow(
						crew,
						"escort_" + escort.id.value,
						type.name,
						std::to_string(escort.structure) + "/" + std::to_string(type.structure) + " structure",
						[] {}
					);
				}

				ui::Ref<ui::Component> log = kit::panel(page, "Log", "log");
				const size_t		   shownLines = std::min<size_t>(campaign.log.size(), 8);
				for (size_t index = campaign.log.size() - shownLines; index < campaign.log.size(); ++index) {
					kit::caption(log, "Day " + std::to_string(campaign.log[index].day) + ": " + campaign.log[index].text);
				}

				actions(campaign);
				kit::setNotice(page, notice);
			}

			void actions(const Campaign& campaign) {
				if (campaign.run && campaign.run->route) {
					kit::button(
						page.footer,
						"back_on_the_road",
						"Back on the road",
						[this] { app().scenes().switchTo(scenes::kRun); },
						ui::ButtonVariant::Primary
					);
				} else if (campaign.run) {
					kit::button(page.footer, "give_up_load_out", "Give up the load out", [this] {
						step([this](Campaign& played) {
							rules::campaign::giveUpLoadOut(played);
							notice = "The load out was given up.";
						});
					});
				} else {
					kit::button(
						page.footer,
						"plan_run",
						"Plan a supply run",
						[this] { app().scenes().switchTo(scenes::kAreaMap); },
						ui::ButtonVariant::Primary
					);
				}
				const GameRules&  loaded = game().rules;
				const auto		  scavengeRefused = rules::campaign::scavengeBlocker(campaign);
				const std::string scavengeLabel =
					scavengeRefused
						? "Send a scavenging party (" + scavengeRefusalText(*scavengeRefused) + ")"
						: "Send a scavenging party (" +
							  amountsText(rules::campaign::rollHaul(campaign.seed, campaign.day, loaded.campaign.compound)) + ")";
				kit::button(
					page.footer,
					"scavenge",
					scavengeLabel,
					[this] {
						step([this](Campaign& played) {
							const rules::campaign::DayEnd ended =
								rules::campaign::scavenge(played, game().rules.content, game().rules.campaign);
							notice = "The party brought back " + amountsText(ended.haul) + ".";
						});
					},
					ui::ButtonVariant::Secondary,
					!scavengeRefused
				);
				kit::button(
					page.footer,
					"rest",
					"Rest a day",
					[this] {
						step([this](Campaign& played) {
							(void)rules::campaign::endDay(played, game().rules.content, game().rules.campaign);
							notice = "The compound rested.";
						});
					},
					ui::ButtonVariant::Secondary,
					!campaign.run.has_value()
				);
				kit::button(
					page.footer, "main_menu", "Main menu", [this] { app().scenes().switchTo(scenes::kMainMenu); }, ui::ButtonVariant::Ghost
				);
			}

			// One of the compound's actions on the campaign, saved once it's done; the campaign's end if it ended it.
			template <typename Action>
			void step(Action&& action) {
				Campaign& campaign = game().session->campaign;
				action(campaign);
				if (!game().store.save(campaign)) {
					notice = "The campaign couldn't be saved.";
				}
				if (campaign.end) {
					app().scenes().switchTo(scenes::kCampaignEnd);
					return;
				}
				build();
			}

			std::string notice;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCompoundScene() {
		return std::make_unique<CompoundScene>();
	}

} // namespace game
