// The main menu (Game Flow 1.1; UI Art Direction, Screens: Main menu), in the atlas: one sheet on the table, the atlas
// cover lying on its left half with the two decks set down on it, and the contents page on its right. Continue leads
// when there's a campaign to continue, a highway shield with the day in it and the save's summary under the label;
// otherwise New campaign leads, and Continue keeps its place in faded print with why there's nothing to continue.
// Campaign history follows, then the appendices in two columns: settings, the card showcase, credits, developer tools
// in a development build, and Exit. New campaign over a campaign in progress asks first.

#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/ContentsEntry.h"
#include "atlas/Icons.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "scenes/AtlasPage.h"
#include "scenes/GameScene.h"
#include "scenes/founding/FoundingScene.h"
#include "scenes/menu/MenuCover.h"

#include <ui/components/Dialog.h>

#include <nlohmann/json.hpp>

#include <array>
#include <cstdio>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		using atlas::ContentsEntry;
		using atlas::EntryLead;
		using atlas::EntrySize;

		// The cover's share of the room inside the sheet, and the gap to the contents page.
		constexpr float kCoverShare = 47.0F;
		constexpr float kColumnGap = 46.0F;

		// "DAY 09", the map's counter.
		std::string dayValue(int day) {
			std::array<char, 16> text{};
			std::snprintf(text.data(), text.size(), "DAY %02d", day);
			return text.data();
		}

		// Continue's value at the end of its leaders when there's nothing to continue: what kind of save there isn't.
		std::string missingValue(SaveState state) {
			switch (state) {
				case SaveState::Damaged:
					return "DAMAGED";
				case SaveState::OtherFormat:
					return "OLD SAVE";
				case SaveState::None:
				case SaveState::Saved:
					break;
			}
			return "NO SAVE";
		}

		ui::Layout column(float gap) {
			return {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Stretch
			};
		}

		// A block of the page at its own height, which scrolls rather than squeezes it.
		ui::Layout fixed(ui::Layout layout) {
			layout.flexShrink = 0.0F;
			return layout;
		}

		class MainMenuScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kMainMenu; }

			std::string exportState() const override {
				return nlohmann::json{
					{"continue", {{"enabled", saved()}, {"line", status.line}}},
					{"primary", saved() ? "continue" : "new_campaign"},
					{"history", static_cast<int>(history.size())},
					{"confirming", confirming},
				}
					.dump();
			}

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				if (!ui().icons().has("deck-a")) {
					ui().icons().add(icons::iconAtlas());
				}
				status = game().store.status();
				history = game().store.history();
				build();
			}

		  private:
			[[nodiscard]] bool saved() const { return status.state == SaveState::Saved; }

			void build() {
				ui::Layout sheetLayout{
					.display = ui::Display::Flex,
					.flexDirection = ui::FlexDirection::Row,
					.gap = kColumnGap,
					.alignItems = ui::AlignItems::Stretch
				};
				sheetLayout.padding = ui::Edges(46.0F, 50.0F, 46.0F, 46.0F);
				sheet = root().addChild<atlas::Sheet>({
					.id = "sheet",
					.size = {ui::percent(100.0F), ui::percent(100.0F)},
					.layout = sheetLayout,
					.identity = std::string(scenes::kMainMenu),
				});
				sheet.addChild<MenuCover>({.id = "cover", .size = {ui::percent(kCoverShare), ui::kAuto}, .layout = {.flexShrink = 0.0F}});

				ui::Ref<ui::Component> contents = sheet.addChild<ui::Component>({
					.id = "contents",
					.minSize = {0.0F, 0.0F},
					.layout = [] {
						ui::Layout layout = column(0.0F);
						layout.justifyContent = ui::JustifyContent::SpaceBetween;
						layout.flexGrow = 1.0F;
						return layout;
					}(),
				});
				// The page scrolls when the window is too short for it, at a large ui scale say; the footer stays put.
				ui::Ref<ui::Component> page = contents.addChild<ui::Component>({
					.id = "page",
					.minSize = {0.0F, 0.0F},
					.layout =
						[] {
							ui::Layout layout = column(22.0F);
							layout.flexGrow = 1.0F;
							return layout;
						}(),
					.overflow = ui::Overflow::Scroll,
				});
				ui::Ref<ui::Component> heading = page.addChild<ui::Component>({.id = "heading", .layout = fixed(column(2.0F))});
				heading.addChild<ui::Text>({
					.id = "title",
					.style = styles::screenTitle.extend({.textTransform = Foundation::TextTransform::Uppercase}),
					.text = "Contents",
				});
				heading.addChild<ui::Text>({.id = "subtitle", .style = styles::subtitle, .text = "Where to open the book today"});

				ui::Ref<ui::Component> campaign = page.addChild<ui::Component>({.id = "campaign", .layout = fixed(column(0.0F))});
				ui::Ref<ContentsEntry> lead = campaignEntries(campaign);
				appendices(page);
				footer(contents);
				if (ContentsEntry* leading = lead.get()) {
					leading->focus();
				}
			}

			// Continue, New campaign and Campaign history; the leading entry back.
			ui::Ref<ContentsEntry> campaignEntries(ui::Ref<ui::Component> campaign) {
				const bool			   inProgress = saved();
				const bool			   unreadable = status.state == SaveState::Damaged || status.state == SaveState::OtherFormat;
				ui::Ref<ContentsEntry> continueEntry = campaign.addChild<ContentsEntry>({
					.id = "continue",
					.enabled = inProgress,
					.label = "Continue",
					.line = status.line,
					.value = inProgress ? dayValue(status.campaign->day) : missingValue(status.state),
					.lead = inProgress ? EntryLead::Shield : EntryLead::Ring,
					.leadText = inProgress ? std::to_string(status.campaign->day) : std::string(),
					.entrySize = inProgress ? EntrySize::Primary : EntrySize::Row,
					.warnLine = unreadable,
					.onPress = [this] { continueCampaign(); },
				});
				ui::Ref<ContentsEntry> newEntry = campaign.addChild<ContentsEntry>({
					.id = "new_campaign",
					.label = "New campaign",
					.value = dayValue(1),
					.lead = inProgress ? EntryLead::Circled : EntryLead::Shield,
					.leadText = "1",
					.entrySize = inProgress ? EntrySize::Row : EntrySize::Primary,
					.onPress = [this] { newCampaign(); },
				});
				campaign.addChild<ContentsEntry>({
					.id = "campaign_history",
					.label = "Campaign history",
					.value = "PAST RUNS",
					.lead = EntryLead::Circled,
					.leadText = "H",
					.onPress = [this] { app().scenes().switchTo(scenes::kCampaignHistory); },
				});
				return inProgress ? continueEntry : newEntry;
			}

			// The appendices in two columns, lettered in reading order as an atlas's are.
			void appendices(ui::Ref<ui::Component> page) {
				struct Appendix {
					const char*			  id;
					const char*			  label;
					bool				  deck = false;
					std::function<void()> open;
				};
				std::vector<Appendix> entries{
					{.id = "settings", .label = "Settings", .open = [this] { app().scenes().switchTo(scenes::kSettings); }},
					{.id = "card_showcase",
					 .label = "Card showcase",
					 .deck = true,
					 .open = [this] { app().scenes().switchTo(scenes::kCardShowcase); }},
					{.id = "credits", .label = "Credits", .open = [this] { app().scenes().switchTo(scenes::kCredits); }},
				};
#ifdef SALAL_DEV_SERVER
				// The developer's pages, which only a development build has; the dev server reaches the rest.
				entries.push_back({.id = "developer_tools", .label = "Developer tools", .open = [this] {
									   app().scenes().switchTo(scenes::kArtGallery);
								   }});
#endif
				entries.push_back({.id = "exit", .label = "Exit game", .open = [this] { app().requestExit(); }});

				ui::Ref<ui::Component> block = page.addChild<ui::Component>({.id = "appendices", .layout = fixed(column(6.0F))});
				block.addChild<ui::Text>({
					.id = "appendices_kicker",
					.style = styles::kicker.extend({.letterSpacing = 2.0F, .textTransform = Foundation::TextTransform::Uppercase}),
					.text = "Appendices",
				});
				ui::Ref<ui::Component>				  columns = block.addChild<ui::Component>({
								   .layout = {
									   .display = ui::Display::Flex,
									   .flexDirection = ui::FlexDirection::Row,
									   .gap = 30.0F,
									   .alignItems = ui::AlignItems::Start
					   },
				   });
				std::array<ui::Ref<ui::Component>, 2> halves{};
				for (ui::Ref<ui::Component>& half : halves) {
					// Half each, the gap shrunk out of both alike.
					half = columns.addChild<ui::Component>(
						{.size = {ui::percent(50.0F), ui::kAuto}, .minSize = {0.0F, 0.0F}, .layout = column(0.0F)}
					);
				}
				for (size_t index = 0; index < entries.size(); ++index) {
					halves.at(index % 2).addChild<ContentsEntry>({
						.id = entries[index].id,
						.label = entries[index].label,
						.value = std::string(1, static_cast<char>('A' + index)),
						.lead = entries[index].deck ? EntryLead::Deck : EntryLead::None,
						.entrySize = EntrySize::Appendix,
						.onPress = entries[index].open,
					});
				}
			}

			// The atlas's imprint and the build's line at the foot of the page.
			static void footer(ui::Ref<ui::Component> contents) {
				const ui::Style caption =
					styles::kicker.extend({.letterSpacing = 1.6F, .textTransform = Foundation::TextTransform::Uppercase});
				ui::Ref<ui::Component> foot = contents.addChild<ui::Component>({
					.id = "footer",
					.layout = [] {
						ui::Layout layout{
							.display = ui::Display::Flex,
							.flexDirection = ui::FlexDirection::Row,
							.gap = 16.0F,
							.alignItems = ui::AlignItems::End,
							.justifyContent = ui::JustifyContent::SpaceBetween,
						};
						layout.flexWrap = ui::FlexWrap::Wrap;
						layout.flexShrink = 0.0F;
						return layout;
					}(),
				});
				foot.addChild<ui::Text>({.id = "imprint", .style = caption, .text = "Printed before \xC2\xB7 revised by hand after"});
				foot.addChild<ui::Text>({.id = "build", .style = caption, .text = buildLine()});
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
				if (!saved()) {
					app().scenes().reset<FoundingScene>();
					return;
				}
				confirming = true;
				ui::Ref<ui::Dialog> dialog =
					ui::Dialog::open(*sheet.get(), {.id = "confirm", .title = "Abandon this campaign?", .footer = true, .onClose = [this] {
														confirming = false;
													}});
				dialog.get()->content().addChild<ui::Text>({
					.style = styles::body,
					.text = status.line + ". A new campaign replaces it, and it goes into Campaign history as abandoned.",
					.wrap = true,
				});
				dialog.get()->footer().addChild<atlas::AtlasButton>({
					.id = "keep",
					.label = "Keep it",
					.onPress = [this, dialog] {
						confirming = false;
						ui().closeOverlay(dialog);
					},
				});
				dialog.get()->footer().addChild<atlas::AtlasButton>({
					.id = "confirm_new",
					.label = "Abandon and start new",
					.onPress = [this] { app().scenes().reset<FoundingScene>(); },
				});
			}

			ui::Ref<atlas::Sheet>	  sheet;
			SaveStatus				  status;
			std::vector<HistoryEntry> history;
			bool					  confirming = false;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeMainMenuScene() {
		return std::make_unique<MainMenuScene>();
	}

} // namespace game
