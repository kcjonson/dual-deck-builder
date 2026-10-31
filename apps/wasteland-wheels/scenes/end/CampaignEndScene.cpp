// The campaign's end (Game Flow 6.3; campaign-end.md): how the compound fell and why, the days it held, and what the
// tally counts, with the campaign put into the history and its save gone as the scene opens. The rules have no win yet
// (strongholds aren't built), so a fall is the only end there is.

#include "Words.h"
#include "scenes/GameScene.h"

#include <rules/campaign/CampaignEnd.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <optional>

namespace game {

	namespace {

		using rules::campaign::Campaign;
		using rules::campaign::DriverStatus;

		std::string fallText(rules::campaign::Ending ending) {
			using rules::campaign::Ending;
			switch (ending) {
				case Ending::Starved:
					return "The compound starved.";
				case Ending::Rioted:
					return "The compound rioted over what was left.";
				case Ending::Disbanded:
					return "The compound disbanded.";
			}
			return "The compound fell.";
		}

		std::string causeText(rules::campaign::EndCause cause) {
			return cause == rules::campaign::EndCause::LastDriver ? "No drivers were left to send out."
																  : "Nobody was left at the compound.";
		}

		class CampaignEndScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kCampaignEnd; }

			std::string exportState() const override {
				if (!ended) {
					return "null";
				}
				return nlohmann::json{
					{"ending", std::string(nameOf(rules::campaign::kEndingNames, ended->end->ending))},
					{"day", ended->day},
					{"recorded", recorded},
				}
					.dump();
			}

		  protected:
			void enter() override {
				if (sessionOrMenu() == nullptr) {
					return;
				}
				if (!game().session->campaign.end) {
					LOG_ERROR(Game, "CampaignEndScene: the campaign isn't over; to the compound");
					app().scenes().switchTo(scenes::kCompound);
					return;
				}
				ended = std::move(game().session->campaign);
				game().session.reset();
				recorded = game().store.end(*ended, "");
				build();
			}

		  private:
			void build() {
				const Campaign& campaign = *ended;
				page = kit::openPage(*this, page, "The end", fallText(campaign.end->ending));
				ui::Ref<ui::Component> story = kit::panel(page, "How it ended", "story");
				kit::text(story, causeText(campaign.end->cause));
				kit::text(story, "Held out for " + counted(campaign.day, "day", "days") + ".");
				const auto count = [&](DriverStatus status) {
					return static_cast<int>(std::ranges::count(campaign.drivers, status, &rules::campaign::DriverRecord::status));
				};
				ui::Ref<ui::Component> record = kit::panel(page, "The record", "record");
				kit::text(
					record,
					counted(campaign.tally.runsHome, "run", "runs") + " home, " + counted(campaign.tally.runsFailed, "run", "runs") +
						" failed, " + counted(campaign.tally.fightsWon, "fight", "fights") + " won"
				);
				kit::text(
					record,
					counted(count(DriverStatus::Dead), "driver", "drivers") + " dead, " + std::to_string(count(DriverStatus::Missing)) +
						" missing, of " + std::to_string(campaign.drivers.size())
				);
				kit::text(
					record, counted(static_cast<int>(campaign.mapState.strongholdsTaken.size()), "stronghold", "strongholds") + " taken"
				);
				kit::caption(record, "Seed " + std::to_string(campaign.seed));
				kit::button(
					page.footer,
					"main_menu",
					"Main menu",
					[this] { app().scenes().switchTo(scenes::kMainMenu); },
					ui::ButtonVariant::Primary
				);
				if (!recorded) {
					kit::setNotice(page, "The campaign couldn't be put into the history.");
				}
			}

			std::optional<Campaign> ended;
			bool					recorded = false;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCampaignEndScene() {
		return std::make_unique<CampaignEndScene>();
	}

} // namespace game
