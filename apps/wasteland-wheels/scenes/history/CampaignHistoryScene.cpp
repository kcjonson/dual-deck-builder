// Campaign history (Game Flow 1.1), an appendix of the atlas: past campaigns, newest first, as the contents page lists
// things, each a numbered entry with how it ended, the days it held out at the right, and the strongholds it took and
// its seed under it, in a legend box that scrolls once it outgrows the room the title leaves. Nothing in it is pressed;
// the tabs go back to the menu, as Escape does.

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/ContentsEntry.h"
#include "atlas/LegendBox.h"
#include "atlas/Tokens.h"
#include "scenes/AtlasPage.h"
#include "scenes/GameScene.h"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace game {

	namespace {

		constexpr float kListWidth = 600.0F;

		// How an ending reads: how the compound fell, or that it didn't.
		std::string endingLabel(const std::string& ending) {
			if (ending.empty()) {
				return "Ended";
			}
			std::string label = ending;
			label[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(label[0])));
			return label;
		}

		class CampaignHistoryScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kCampaignHistory; }

			std::string exportState() const override { return nlohmann::json{{"campaigns", history.size()}}.dump(); }

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				history = game().store.history();
				const AtlasPage opened = openAtlasPage(
					*this,
					sheetPage,
					{
						.identity = scenes::kCampaignHistory,
						.title = "Campaign history",
						.subtitle =
							history.empty() ? std::string() : counted(static_cast<int>(history.size()), "campaign", "campaigns") + " ended",
						.tabs = appendixTabs(app(), "tab_campaign_history"),
						.onKeyDown = [this](ui::KeyEvent& event) { keys(event); },
					}
				);
				ui::Ref<atlas::LegendBox> box = opened.body.addChild<atlas::LegendBox>({
					.id = "history",
					.size = {kListWidth, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.maxSize = {ui::percent(100.0F), ui::kAuto},
					.look = {.seed = atlas::paperSeed("campaign_history/list")},
				});
				if (history.empty()) {
					box.addChild<atlas::LegendRow>({
						.id = "history_empty",
						.symbol = atlas::MapSymbol::Dash,
						.text = "No campaign has ended yet. One is listed here when its compound falls, or a new campaign replaces it.",
						.textStyle = atlas::styles::print::quiet,
					});
					return;
				}
				list = box.addChild<ui::Component>({
					.id = "history_list",
					.minSize = {0.0F, 0.0F},
					.layout =
						[] {
							ui::Layout layout{
								.display = ui::Display::Flex,
								.flexDirection = ui::FlexDirection::Column,
								.alignItems = ui::AlignItems::Stretch
							};
							layout.flexShrink = 1.0F;
							return layout;
						}(),
					.overflow = ui::Overflow::Scroll,
				});
				for (size_t index = 0; index < history.size(); ++index) {
					const HistoryEntry& entry = history[index];
					list.addChild<atlas::ContentsEntry>({
						.id = "history_" + std::to_string(index),
						.label = endingLabel(entry.ending),
						.line =
							counted(entry.strongholdsTaken, "stronghold", "strongholds") + " taken / Seed " + std::to_string(entry.seed),
						.value = counted(entry.day, "day", "days"),
						.lead = atlas::EntryLead::Circled,
						.leadText = std::to_string(index + 1),
						.record = true,
					});
				}
			}

		  private:
			void keys(ui::KeyEvent& event) {
				if (event.type == ui::KeyEvent::Type::Cancel) {
					app().scenes().switchTo(scenes::kMainMenu);
					event.consume();
					return;
				}
				if (event.type == ui::KeyEvent::Type::Down &&
					(event.key == foundation::Key::PageDown || event.key == foundation::Key::PageUp)) {
					if (ui::Component* scrolled = list.get()) {
						const float page = scrolled->getSize().y * 0.9F;
						scrolled->scrollBy({0.0F, event.key == foundation::Key::PageDown ? page : -page});
					}
					event.consume();
				}
			}

			AtlasPage				  sheetPage;
			ui::Ref<ui::Component>	  list;
			std::vector<HistoryEntry> history;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCampaignHistoryScene() {
		return std::make_unique<CampaignHistoryScene>();
	}

} // namespace game
