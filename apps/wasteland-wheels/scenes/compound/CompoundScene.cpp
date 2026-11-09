// The compound (Game Flow 3.1, compound-screen.md), in the atlas (UI Art Direction, Screens): the plate of the yard on
// the left two thirds under the title, the day and the resource strip; on the right the chosen building's box, Needs,
// The day (rest or scavenge, with what each costs), and the log, with Plan a supply run pinned to the foot. Each action
// is the rules' own, saved as it ends; a night that ends the campaign goes to its end.

#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Glyphs.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/ResourceStrip.h"
#include "atlas/SectionTabs.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "scenes/GameScene.h"
#include "scenes/compound/CompoundPlate.h"
#include "scenes/map/Planning.h"

#include <rules/campaign/CampaignEnd.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <tuple>
#include <vector>

namespace game {

	namespace {

		using rules::campaign::Campaign;
		using rules::campaign::DriverStatus;
		namespace styles = atlas::styles::print;

		// A store runs short when it runs out within this many day ends: the strip turns it red and Needs leads it with a
		// diamond.
		constexpr int	 kShortWithinDays = 2;
		constexpr size_t kLogLines = 5;
		// The least the log box is given, its head and a wrapped entry; Needs and the rest scroll instead of squeezing it past that.
		constexpr float kLogMinHeight = 150.0F;
		constexpr float kOrdersWidth = 452.0F;

		ui::Layout column(float gap) {
			return {
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Stretch
			};
		}

		ui::Layout row(float gap, ui::AlignItems align = ui::AlignItems::Center) {
			return {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = align};
		}

		// A store in at most four characters, two at least as a ledger has them: "06", "1450", "12k".
		std::string ledger(int amount) {
			if (amount < 10) {
				return "0" + std::to_string(std::max(0, amount));
			}
			if (amount < 10000) {
				return std::to_string(amount);
			}
			constexpr std::array<const char*, 4> kSuffixes{"k", "M", "B", "T"};
			long long							 scaled = amount / 1000;
			size_t								 suffix = 0;
			while (scaled >= 1000 && suffix + 1 < kSuffixes.size()) {
				scaled /= 1000;
				++suffix;
			}
			return std::to_string(scaled) + kSuffixes.at(suffix);
		}

		bool runsShort(const rules::campaign::Need& need) {
			return need.days.has_value() && (need.shortTonight || *need.days <= kShortWithinDays);
		}

		struct NeedLine {
			std::string		 text;
			atlas::MapSymbol symbol;
			bool			 urgent = false;
		};

		std::optional<NeedLine> forecastLine(const char* name, const char* resource, const rules::campaign::Need& need) {
			if (!need.days) {
				return std::nullopt;
			}
			if (need.stock == 0) {
				return NeedLine{
					.text = "No " + std::string(resource) + ": " + std::to_string(need.daily) + " short tonight",
					.symbol = atlas::MapSymbol::Diamond,
					.urgent = true,
				};
			}
			if (need.shortTonight) {
				return NeedLine{
					.text = std::string(name) + " runs out tonight, " + std::to_string(need.daily - need.stock) + " short",
					.symbol = atlas::MapSymbol::Diamond,
					.urgent = true,
				};
			}
			return NeedLine{
				.text = std::string(name) + " runs out in " + counted(*need.days, "day", "days"),
				.symbol = runsShort(need) ? atlas::MapSymbol::Diamond : atlas::MapSymbol::Ring,
			};
		}

		// "Water and food run out in 2 days", under the strip when either runs short.
		std::string shortfallLine(const rules::campaign::Forecast& forecast) {
			std::vector<std::pair<std::string, int>> short_;
			if (runsShort(forecast.food)) {
				short_.emplace_back("food", *forecast.food.days);
			}
			if (runsShort(forecast.water)) {
				short_.emplace_back("water", *forecast.water.days);
			}
			if (short_.empty()) {
				return {};
			}
			std::ranges::sort(short_, [](const auto& a, const auto& b) { return a.second < b.second; });
			const int	soonest = short_.front().second;
			std::string what =
				short_.size() == 2 && short_[1].second == soonest ? short_[0].first + " and " + short_[1].first : short_[0].first;
			what[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(what[0])));
			const bool both = what.find(" and ") != std::string::npos;
			return what + (both ? " run out " : " runs out ") +
				   (soonest == 0 ? std::string("tonight") : "in " + counted(soonest, "day", "days"));
		}

		// The log shows the newest entries that fit whole in the room its box is given, the rest hidden; a hidden entry's height
		// is kept from when it last showed, and a new width starts the count again.
		struct LogFit {
			std::vector<float> heights;
			float			   width = -1.0F;
		};

		void fitLog(ui::Component& box, ui::Component& rows, LogFit& fit) {
			ui::Context* context = rows.getContext();
			const auto&	 entries = rows.getChildren();
			if (context == nullptr || entries.empty()) {
				return;
			}
			bool reshown = false;
			if (rows.getSize().x != fit.width) {
				fit.width = rows.getSize().x;
				fit.heights.assign(entries.size(), 0.0F);
				for (const ui::ComponentId id : entries) {
					ui::Component* entry = context->find(id);
					reshown = reshown || !entry->isVisible();
					entry->setVisible(true);
				}
			}
			if (reshown) {
				return;
			}
			for (size_t index = 0; index < entries.size(); ++index) {
				const ui::Component* entry = context->find(entries[index]);
				if (entry->isVisible()) {
					fit.heights[index] = entry->getSize().y;
				}
			}
			const float below = box.getLayout().padding.bottom;
			const float top = rows.getBounds().y;
			const float room = box.getSize().y - below - top;
			float		used = 0.0F;
			size_t		count = 0;
			while (count < entries.size() && used + fit.heights[count] <= room + 0.5F) {
				used += fit.heights[count];
				++count;
			}
			for (size_t index = 0; index < entries.size(); ++index) {
				context->find(entries[index])->setVisible(index < count);
			}
			// Everything fitting, the box is as tall as its entries rather than as the room.
			box.setMaxSize({ui::kAuto, count == entries.size() ? ui::Length(top + used + below) : ui::kAuto});
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
					{"selected", std::string(buildingName(chosen))},
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
				if (game().session->campaign.end) {
					app().scenes().switchTo(scenes::kCampaignEnd);
					return;
				}
				const std::vector<Building>& built = game().session->campaign.buildings;
				chosen = built.empty() ? Building::Bunkhouse : built.front();
				build();
			}

		  private:
			void build() {
				const Campaign& campaign = game().session->campaign;
				if (sheet.get() != nullptr) {
					root().get()->removeChild(sheet);
				}
				ui::Layout sheetLayout = column(8.0F);
				sheetLayout.padding = ui::Edges(0.0F, 48.0F, 50.0F, 46.0F);
				sheet = root().addChild<atlas::Sheet>({
					.id = "sheet",
					.size = {ui::percent(100.0F), ui::percent(100.0F)},
					.layout = sheetLayout,
					.identity = std::string(scenes::kCompound),
				});
				tabs(campaign);
				ui::Ref<ui::Component> body = sheet.addChild<ui::Component>({
					.id = "body",
					.minSize = {0.0F, 0.0F},
					.layout = [] {
						ui::Layout layout = row(30.0F, ui::AlignItems::Stretch);
						layout.flexGrow = 1.0F;
						return layout;
					}(),
				});
				plateColumn(body, campaign);
				orders(body, campaign);
			}

			void tabs(const Campaign& campaign) {
				const bool			   planOpen = !campaign.run.has_value();
				ui::Ref<ui::Component> row = atlas::sectionTabs(
					sheet,
					{
						{.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
						{.id = "tab_compound", .label = "Compound", .active = true},
						{.id = "tab_area_map",
						 .label = "Area map",
						 .enabled = planOpen,
						 .onPress = [this] { app().scenes().switchTo(scenes::kAreaMap); }},
						{.id = "tab_crew", .label = "Crew", .deckGlyph = true, .onPress = [this] {
							 app().scenes().switchTo(scenes::kCrew);
						 }},
					}
				);
				ui::Layout layout = row.get()->getLayout();
				layout.alignSelf = ui::AlignItems::Center;
				layout.flexShrink = 0.0F;
				row.get()->setLayout(layout);
			}

			void plateColumn(ui::Ref<ui::Component> body, const Campaign& campaign) {
				const GameRules&	   loaded = game().rules;
				ui::Ref<ui::Component> left = body.addChild<ui::Component>({
					.id = "plate_column",
					.minSize = {0.0F, 0.0F},
					.layout = [] {
						ui::Layout layout = column(10.0F);
						layout.flexGrow = 1.0F;
						return layout;
					}(),
				});
				ui::Ref<ui::Component> heading = left.addChild<ui::Component>({.layout = row(16.0F, ui::AlignItems::End)});
				heading.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = "The compound"});
				heading.addChild<ui::Text>(
					{.id = "dawn", .style = styles::subtitle, .text = "day " + std::to_string(campaign.day) + ", dawn"}
				);

				const rules::campaign::Forecast	  forecast = rules::campaign::forecastNeeds(campaign.stores, loaded.campaign.compound);
				const rules::campaign::Resources& stores = campaign.stores;
				atlas::resourceStrip(
					left,
					{
						{.id = "food", .name = "Food", .value = ledger(stores.food), .shortfall = runsShort(forecast.food)},
						{.id = "water", .name = "Water", .value = ledger(stores.water), .shortfall = runsShort(forecast.water)},
						{.id = "fuel", .name = "Fuel", .value = ledger(stores.fuel)},
						{.id = "scrap", .name = "Scrap", .value = ledger(stores.scrap)},
						{.id = "meds", .name = "Meds", .value = ledger(stores.meds)},
						{.id = "people", .name = "People", .value = ledger(stores.people)},
					}
				);
				if (const std::string shortfall = shortfallLine(forecast); !shortfall.empty()) {
					left.addChild<ui::Text>({.id = "shortfall", .style = styles::warning, .text = shortfall});
				}
				left.addChild<CompoundPlate>({
					.id = "plate",
					.minSize = {0.0F, 0.0F},
					.layout = {.flexGrow = 1.0F},
					.built = campaign.buildings,
					.selected = chosen,
					.seed = campaign.seed,
					.onChoose = [this](Building building) { choose(building); },
				});
				left.addChild<ui::Text>(
					{.id = "plate_caption", .style = styles::kicker, .text = "Plate 1 \xC2\xB7 the compound from above, at dawn"}
				);
			}

			void orders(ui::Ref<ui::Component> body, const Campaign& campaign) {
				ui::Ref<ui::Component> right = body.addChild<ui::Component>({
					.id = "orders",
					.size = {kOrdersWidth, ui::kAuto},
					.minSize = {0.0F, 0.0F},
					.layout = [] {
						ui::Layout layout = column(14.0F);
						layout.flexShrink = 0.0F;
						return layout;
					}(),
				});
				ui::Ref<ui::Component> boxes = right.addChild<ui::Component>({
					.id = "boxes",
					.minSize = {0.0F, 0.0F},
					.layout =
						[] {
							ui::Layout layout = column(14.0F);
							layout.flexGrow = 1.0F;
							return layout;
						}(),
					.overflow = ui::Overflow::Scroll,
				});
				buildingBox(boxes, campaign);
				needsBox(boxes, campaign);
				dayBox(boxes, campaign);
				logBox(right, campaign);
				primary(right, campaign);
			}

			void buildingBox(ui::Ref<ui::Component> boxes, const Campaign& campaign) {
				const bool				  standing = std::ranges::find(campaign.buildings, chosen) != campaign.buildings.end();
				ui::Ref<atlas::LegendBox> box = boxes.addChild<atlas::LegendBox>({
					.id = "building",
					.style = {.backgroundColor = ui().getTheme().get(atlas::tokens::palette::freshPaper)},
					.look = {.seed = atlas::paperSeed("compound/building"), .wear = atlas::Wear::Clean},
				});
				ui::Ref<ui::Component>	  head = box.addChild<ui::Component>({.layout = row(10.0F)});
				head.addChild<atlas::Circled>({.size = {30.0F, 30.0F}, .text = std::to_string(buildingNumber(chosen))});
				head.addChild<ui::Text>(
					{.id = "building_name",
					 .layout = {.flexGrow = 1.0F},
					 .style = styles::boxTitle,
					 .text = std::string(buildingName(chosen))}
				);
				head.addChild<ui::Text>({.id = "building_state", .style = styles::kicker, .text = standing ? "Built" : "Not built"});
				box.addChild<ui::Text>(
					{.id = "building_description", .style = styles::body, .text = std::string(buildingDescription(chosen)), .wrap = true}
				);
				if (!standing) {
					box.addChild<ui::Text>({
						.id = "building_reason",
						.style = styles::quiet,
						.text = "The " + lowered(buildingName(chosen)) + " isn't built yet.",
						.wrap = true,
					});
					return;
				}
				if (chosen == Building::Bunkhouse) {
					ui::Ref<ui::Component> crew = box.addChild<ui::Component>({.layout = row(8.0F)});
					crew.addChild<atlas::IconStack>(atlas::deckGlyph("crew_glyph"));
					crew.addChild<ui::Text>(
						{.id = "crew_line",
						 .style = styles::caption.extend({.textTransform = Foundation::TextTransform::Uppercase}),
						 .text = crewLine(campaign)}
					);
				}
				const bool mapRoom = chosen == Building::MapRoom;
				const bool bunkhouse = chosen == Building::Bunkhouse;
				box.addChild<atlas::AtlasButton>({
					.id = "open_building",
					.enabled = bunkhouse || (mapRoom && !campaign.run.has_value()),
					.label = "Open the " + lowered(buildingName(chosen)),
					.onPress = [this, bunkhouse] { app().scenes().switchTo(bunkhouse ? scenes::kCrew : scenes::kAreaMap); },
				});
				if (!mapRoom && !bunkhouse) {
					box.addChild<ui::Text>({
						.id = "building_reason",
						.style = styles::note,
						.text = "The " + lowered(buildingName(chosen)) + "'s screen isn't in the alpha yet.",
						.wrap = true,
					});
				}
			}

			void needsBox(ui::Ref<ui::Component> boxes, const Campaign& campaign) {
				const GameRules&				loaded = game().rules;
				ui::Ref<atlas::LegendBox>		box = boxes.addChild<atlas::LegendBox>({
						  .id = "needs",
						  .look = {.seed = atlas::paperSeed("compound/needs"), .grab = atlas::Corner::BottomLeft},
						  .title = "Needs",
				  });
				ui::Ref<ui::Component>			rows = box.addChild<ui::Component>({.layout = column(0.0F)});
				const rules::campaign::Forecast forecast = rules::campaign::forecastNeeds(campaign.stores, loaded.campaign.compound);
				int								index = 0;
				const auto						line = [&](const NeedLine& need, const ui::Style& style) {
					 rows.addChild<atlas::LegendRow>({
											 .id = "need_" + std::to_string(index++),
											 .symbol = need.symbol,
											 .text = need.text,
											 .textStyle = style,
					 });
				};
				for (const auto& [name, resource, need] : {
						 std::tuple{"Food", "food", forecast.food},
						 std::tuple{"Water", "water", forecast.water},
					 }) {
					if (const std::optional<NeedLine> shown = forecastLine(name, resource, need)) {
						line(*shown, shown->urgent ? styles::warning : styles::body);
					}
				}
				for (const rules::campaign::DriverRecord& driver : campaign.drivers) {
					if (driver.status == DriverStatus::Injured) {
						const std::string who = rules::campaign::driverName(campaign, loaded.content, driver.id);
						line(
							{.text = who + " is injured, fit in " + counted(driver.injuredDays, "day", "days"),
							 .symbol = atlas::MapSymbol::Ring},
							styles::body
						);
					}
				}
				line({.text = "Radio: no new rumors", .symbol = atlas::MapSymbol::Dash}, styles::quiet);
			}

			void dayBox(ui::Ref<ui::Component> boxes, const Campaign& campaign) {
				const GameRules&		  loaded = game().rules;
				ui::Ref<atlas::LegendBox> box = boxes.addChild<atlas::LegendBox>({
					.id = "the_day",
					.look = {.seed = atlas::paperSeed("compound/the_day"), .grab = atlas::Corner::BottomRight},
					.title = "The day",
				});
				const bool				  runOut = campaign.run.has_value();
				const auto				  refused = rules::campaign::scavengeBlocker(campaign);
				ui::Ref<ui::Component>	  buttons = box.addChild<ui::Component>({.layout = row(10.0F, ui::AlignItems::Stretch)});
				buttons.addChild<atlas::AtlasButton>({
					.id = "rest",
					.enabled = !runOut,
					.layout = {.flexGrow = 1.0F},
					.label = "Rest a day",
					.onPress = [this] {
						step([this](Campaign& played) {
							(void)rules::campaign::endDay(played, game().rules.content, game().rules.campaign);
							notice.clear();
						});
					},
				});
				buttons.addChild<atlas::AtlasButton>({
					.id = "scavenge",
					.enabled = !refused,
					.layout = {.flexGrow = 1.0F},
					.label = "Scavenge",
					.onPress = [this] {
						step([this](Campaign& played) {
							(void)rules::campaign::scavenge(played, game().rules.content, game().rules.campaign);
							notice.clear();
						});
					},
				});
				const rules::campaign::Resources upkeep = rules::campaign::upkeepFor(campaign.stores.people, loaded.campaign.compound);
				const std::string				 rest =
					   runOut ? "A run is out, and its return ends the day."
										  : "Ends day " + std::to_string(campaign.day) + ". The compound eats " + amountsText(upkeep) + ".";
				const std::string party =
					refused ? scavengeRefusalText(*refused) + ", so no party goes out."
							: "Scavenging ends it too, with " +
								  amountsText(rules::campaign::rollHaul(campaign.seed, campaign.day, loaded.campaign.compound)) + ".";
				box.addChild<ui::Text>({.id = "day_line", .style = styles::note, .text = rest + " " + party, .wrap = true});
				if (!notice.empty()) {
					box.addChild<ui::Text>({.id = "notice", .style = styles::warning, .text = notice, .wrap = true});
				}
			}

			void logBox(ui::Ref<ui::Component> right, const Campaign& campaign) {
				auto					  fit = std::make_shared<LogFit>();
				ui::Ref<atlas::LegendBox> box = right.addChild<atlas::LegendBox>({
					.id = "log",
					.minSize = {0.0F, kLogMinHeight},
					.layout = {.flexGrow = 1.0F, .flexShrink = 1000.0F},
					.look = {.seed = atlas::paperSeed("compound/log"), .grab = atlas::Corner::TopRight},
					.title = "Log",
				});
				ui::Ref<ui::Component>	  rows = box.addChild<ui::Component>({
					   .id = "log_rows",
					   .layout = [] {
						   ui::Layout layout = column(0.0F);
						   layout.flexShrink = 0.0F;
						   return layout;
					   }(),
				   });
				const auto				  refit = [box, rows, fit](ui::Component&) {
					   fitLog(*box.get(), *rows.get(), *fit);
				};
				box.get()->setOnLayout(refit);
				rows.get()->setOnLayout(refit);
				const size_t shown = std::min(campaign.log.size(), kLogLines);
				for (size_t index = 0; index < shown; ++index) {
					const rules::campaign::LogEntry& entry = campaign.log[campaign.log.size() - 1 - index];
					rows.addChild<atlas::ContentsRow>({
						.id = "log_" + std::to_string(index),
						.layout = {.flexShrink = 0.0F},
						.label = entry.text,
						.value = "DAY " + std::to_string(entry.day),
						.labelStyle = styles::logLine,
					});
				}
			}

			void primary(ui::Ref<ui::Component> right, const Campaign& campaign) {
				ui::Ref<ui::Component> foot = right.addChild<ui::Component>({
					.id = "primary",
					.layout = [] {
						ui::Layout layout = column(8.0F);
						layout.flexShrink = 0.0F;
						return layout;
					}(),
				});
				std::string			   line;
				if (campaign.run && campaign.run->route) {
					foot.addChild<atlas::AtlasButton>({
						.id = "back_on_the_road",
						.label = "Back on the road",
						.road = atlas::Road::Highway,
						.shield = true,
						.onPress = [this] { app().scenes().switchTo(scenes::kRun); },
					});
					line = "A run is out on the road.";
				} else if (campaign.run) {
					foot.addChild<atlas::AtlasButton>({
						.id = "give_up_load_out",
						.label = "Give up the load out",
						.road = atlas::Road::Highway,
						.shield = true,
						.onPress = [this] {
							step([this](Campaign& played) {
								rules::campaign::giveUpLoadOut(played);
								notice = "The load out was given up.";
							});
						},
					});
					line = "A load out was left half made.";
				} else {
					foot.addChild<atlas::AtlasButton>({
						.id = "plan_run",
						.label = "Plan a supply run",
						.road = atlas::Road::Highway,
						.shield = true,
						.onPress = [this] { app().scenes().switchTo(scenes::kAreaMap); },
					});
					line = destinationsLine();
				}
				foot.addChild<ui::Text>({.id = "primary_line", .style = styles::caption, .text = line});
			}

			// "12 destinations on the area map": the POIs found there a run can go to.
			std::string destinationsLine() const {
				int destinations = 0;
				for (const Destination& destination : planning(*game().session).destinations) {
					destinations += destination.stronghold || destination.cleared ? 0 : 1;
				}
				return counted(destinations, "destination", "destinations") + " on the area map";
			}

			// "3 drivers · 3 default decks": the drivers standing, and the decks they hold, a run's seats' included.
			static std::string crewLine(const Campaign& campaign) {
				int drivers = 0;
				int decks = 0;
				for (const rules::campaign::DriverRecord& driver : campaign.drivers) {
					if (driver.status == DriverStatus::Ready || driver.status == DriverStatus::Injured) {
						++drivers;
						decks += !driver.defaultDeck.empty() || campaign.run.has_value() ? 1 : 0;
					}
				}
				return counted(drivers, "driver", "drivers") + " \xC2\xB7 " + counted(decks, "default deck", "default decks");
			}

			static std::string lowered(std::string_view words) {
				std::string lower(words);
				std::ranges::transform(lower, lower.begin(), [](unsigned char letter) { return static_cast<char>(std::tolower(letter)); });
				return lower;
			}

			void choose(Building building) {
				chosen = building;
				build();
				if (ui::Component* spot = find(plotId(building))) {
					spot->focus();
				}
			}

			ui::Component* find(const std::string& id) {
				std::vector<ui::Component*> open{sheet.get()};
				while (!open.empty()) {
					ui::Component* at = open.back();
					open.pop_back();
					if (at == nullptr) {
						continue;
					}
					if (at->getId() == id) {
						return at;
					}
					for (const ui::ComponentId child : at->getChildren()) {
						open.push_back(ui().find(child));
					}
				}
				return nullptr;
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

			ui::Ref<atlas::Sheet> sheet;
			Building			  chosen = Building::Bunkhouse;
			std::string			  notice;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeCompoundScene() {
		return std::make_unique<CompoundScene>();
	}

} // namespace game
