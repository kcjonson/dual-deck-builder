// The main menu (Game Flow 1.1): Continue with the campaign's state, or disabled with the line under it saying why;
// New Campaign, which asks first over a campaign in progress; Settings; Quit; and Campaign History.

#include "scenes/GameScene.h"
#include "scenes/founding/FoundingScene.h"

#include <ui/components/Dialog.h>

#include <nlohmann/json.hpp>

#include <string>

namespace game {

	namespace {

		std::string historyLine(const HistoryEntry& entry) {
			std::string ending = entry.ending;
			if (!ending.empty()) {
				ending[0] = static_cast<char>(ending[0] - 'a' + 'A');
			}
			return ending + " on day " + std::to_string(entry.day) + " - " + std::to_string(entry.strongholdsTaken) +
				   (entry.strongholdsTaken == 1 ? " stronghold taken" : " strongholds taken");
		}

		class MainMenuScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kMainMenu; }

			std::string exportState() const override {
				return nlohmann::json{
					{"continue", {{"enabled", status.state == SaveState::Saved}, {"line", status.line}}},
					{"history", static_cast<int>(history.size())},
					{"confirming", confirming},
				}
					.dump();
			}

		  protected:
			void enter() override {
				status = game().store.status();
				history = game().store.history();
				build();
			}

		  private:
			void build() {
				page = kit::openPage(*this, page, "Wasteland Wheels", "Early alpha");
				ui::Ref<ui::Component> menu = kit::panel(page, "", "menu");
				const bool			   saved = status.state == SaveState::Saved;
				kit::button(menu, "continue", "Continue", [this] { continueCampaign(); }, ui::ButtonVariant::Primary, saved);
				kit::caption(menu, status.line, "continue_line");
				kit::button(
					menu,
					"new_campaign",
					"New Campaign",
					[this] { newCampaign(); },
					saved ? ui::ButtonVariant::Secondary : ui::ButtonVariant::Primary
				);
				kit::button(menu, "settings", "Settings", [this] { app().scenes().switchTo(scenes::kSettings); });
				kit::button(menu, "quit", "Quit", [this] { app().requestExit(); }, ui::ButtonVariant::Ghost);

				ui::Ref<ui::Component> past = kit::panel(page, "Campaign History", "history");
				if (history.empty()) {
					kit::caption(past, "No campaigns yet.");
				}
				for (size_t index = 0; index < history.size(); ++index) {
					kit::listRow(
						past,
						"history_" + std::to_string(index),
						historyLine(history[index]),
						"seed " + std::to_string(history[index].seed),
						[] {}
					);
				}
			}

			void continueCampaign() {
				// The session already holds the saved campaign and its map when the menu was left from it.
				const std::optional<Session>& session = game().session;
				if (session && status.campaign && session->campaign == *status.campaign) {
					app().scenes().switchTo(session->campaign.run ? scenes::kRun : scenes::kCompound);
					return;
				}
				app().scenes().switchTo(scenes::kLoading);
			}

			void newCampaign() {
				if (status.state != SaveState::Saved) {
					app().scenes().reset<FoundingScene>();
					return;
				}
				confirming = true;
				ui::Ref<ui::Dialog> dialog = ui::Dialog::open(
					*page.frame.get(),
					{.id = "confirm", .title = "Start a new campaign?", .footer = true, .onClose = [this] { confirming = false; }}
				);
				kit::text(dialog.get()->content(), "The campaign in progress (" + status.line + ") goes into the history as abandoned.");
				kit::button(dialog.get()->footer(), "keep", "Keep it", [this, dialog] {
					confirming = false;
					ui().closeOverlay(dialog);
				});
				kit::button(
					dialog.get()->footer(),
					"confirm_new",
					"Start a new campaign",
					[this] { app().scenes().reset<FoundingScene>(); },
					ui::ButtonVariant::Danger
				);
			}

			SaveStatus				  status;
			std::vector<HistoryEntry> history;
			bool					  confirming = false;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeMainMenuScene() {
		return std::make_unique<MainMenuScene>();
	}

} // namespace game
