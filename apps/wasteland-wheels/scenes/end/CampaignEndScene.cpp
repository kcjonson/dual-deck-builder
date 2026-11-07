// The campaign's end (Game Flow 6.3; campaign-end.md), in the atlas: a burnt sheet, FALLEN struck beside how the
// compound fell and why, then the last day's log beside the campaign's record, with the campaign put into the history
// and its save gone as the scene opens. The rules have no win yet (strongholds aren't built), so a fall is the only end.

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "scenes/GameScene.h"
#include "scenes/result/ResultPage.h"

#include <rules/campaign/CampaignEnd.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

namespace game {

	namespace {

		using rules::campaign::Campaign;
		using rules::campaign::DriverStatus;
		using rules::campaign::Ending;

		constexpr float kLastDayWidth = 400.0F;
		constexpr float kRecordWidth = 500.0F;
		// The most of the last day's log shown, the latest, so the fall's own line, always last, is among them.
		constexpr size_t kLastDayLines = 4;

		std::string fallTitle(Ending ending) {
			switch (ending) {
				case Ending::Starved:
					return "The compound starved";
				case Ending::Rioted:
					return "The compound rioted";
				case Ending::Disbanded:
					return "The compound disbanded";
			}
			return "The compound fell";
		}

		// What lost the campaign, then the state that chose how it fell.
		std::string fallStory(const rules::campaign::CampaignEnd& end) {
			const std::string cause = end.cause == rules::campaign::EndCause::LastDriver
										  ? "No drivers were left at the compound to send out."
										  : "No people were left at the compound.";
			switch (end.ending) {
				case Ending::Starved:
					return cause + " The stores had run out of food.";
				case Ending::Rioted:
					return cause + " Unrest boiled over, and the last of them fought over what was left.";
				case Ending::Disbanded:
					return cause + " The gates were left open as the settlers walked away.";
			}
			return cause;
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
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				if (!ui().icons().has("shield-mark")) {
					ui().icons().add(icons::iconAtlas());
				}
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
				const Campaign&						campaign = *ended;
				const rules::campaign::CampaignEnd& end = *campaign.end;
				const result::Page					sheet = result::openPage(
					 root(),
					 {
										 .identity = std::string(scenes::kCampaignEnd),
										 .mark = atlas::HeroMark::Burn,
										 .heading = {
											 .kicker = "Fell on day " + std::to_string(campaign.day),
											 .title = fallTitle(end.ending),
											 .story = fallStory(end),
											 .hostile = true,
											 .stamp = "stamp-fallen",
						 },
					 }
				 );
				lastDay(sheet, campaign);
				record(sheet, campaign);
				if (!recorded) {
					result::footLine(sheet, "unrecorded", "The campaign couldn't be put into the history.", true);
				}
				ui::Ref<atlas::AtlasButton> menu =
					result::highway(sheet, "main_menu", "Main menu", [this] { app().scenes().switchTo(scenes::kMainMenu); });
				menu.get()->focus();
			}

			// The log's lines dated the day it fell, standing in for Game Flow 6.3's final moments: the haul and the
			// shortfall then the fall, or what a failed run lost then the fall.
			static void lastDay(const result::Page& sheet, const Campaign& campaign) {
				std::vector<const rules::campaign::LogEntry*> lines;
				for (const rules::campaign::LogEntry& entry : campaign.log) {
					if (entry.day == campaign.day) {
						lines.push_back(&entry);
					}
				}
				if (lines.empty()) {
					return;
				}
				const size_t			  from = lines.size() > kLastDayLines ? lines.size() - kLastDayLines : 0;
				ui::Ref<atlas::LegendBox> box = result::box(sheet, "last_day", "The last day", kLastDayWidth);
				for (size_t index = from; index < lines.size(); ++index) {
					const bool fall = index + 1 == lines.size();
					result::row(
						box,
						"last_day_" + std::to_string(index - from),
						fall ? atlas::MapSymbol::Diamond : atlas::MapSymbol::Ring,
						lines[index]->text,
						fall
					);
				}
			}

			// The campaign's record (Game Flow 6.3, Partial Progress), then what the compound held at the end, which is
			// what chose how it fell.
			static void record(const result::Page& sheet, const Campaign& campaign) {
				const auto count = [&](DriverStatus status) {
					return static_cast<int>(std::ranges::count(campaign.drivers, status, &rules::campaign::DriverRecord::status));
				};
				const rules::campaign::Tally&	  tally = campaign.tally;
				const rules::campaign::Resources& stores = campaign.stores;
				// A run fails in the one fight it loses, and only then.
				const int											   fightsLost = tally.runsFailed;
				const std::vector<std::pair<std::string, std::string>> rows{
					{"Days held", counted(campaign.day, "day", "days")},
					{"Supply runs", std::to_string(tally.runsHome) + " home, " + std::to_string(tally.runsFailed) + " failed"},
					{"Fights", std::to_string(tally.fightsWon) + " won, " + std::to_string(fightsLost) + " lost"},
					{"Drivers lost",
					 std::to_string(count(DriverStatus::Dead)) + " killed, " + std::to_string(count(DriverStatus::Missing)) + " missing"},
					{"Strongholds taken", std::to_string(campaign.mapState.strongholdsTaken.size())},
					{"At the end",
					 std::to_string(stores.people) + " people, " + std::to_string(stores.food) + " food, " + std::to_string(stores.water) +
						 " water, unrest " + std::to_string(campaign.unrest)},
					{"Seed", std::to_string(campaign.seed)},
				};
				ui::Ref<atlas::LegendBox> box = result::box(sheet, "record", "Campaign record", kRecordWidth);
				for (size_t index = 0; index < rows.size(); ++index) {
					box.addChild<atlas::ContentsRow>(
						{.id = "record_" + std::to_string(index), .label = rows[index].first, .value = rows[index].second}
					);
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
