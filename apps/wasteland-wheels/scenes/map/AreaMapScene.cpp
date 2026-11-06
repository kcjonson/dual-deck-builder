// The area map (Game Flow 3.3; area-map-route-pick.md, area-map-atlas-panels.md), on the atlas sheet: the map, fitted to
// what's been revealed, in a plate under the title and the day, what's found and explored under it; on the right the
// destinations as contents rows, nearest first, the chosen one's box, and Plan a run here as the primary. A POI is
// chosen by its marker or its row, focus moving onto a row choosing it; Plan a run here opens its run route.

#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Glyphs.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/Tokens.h"
#include "scenes/GameScene.h"
#include "scenes/map/MapPage.h"
#include "scenes/map/MapView.h"
#include "scenes/map/PlanRows.h"
#include "scenes/map/Planning.h"
#include "scenes/map/RunRouteScene.h"

#include <nlohmann/json.hpp>

#include <cmath>
#include <map>
#include <optional>
#include <string>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;

		// "Tier 2", "tier 2, past dark", "cleared", "stronghold".
		std::string rowValue(const Destination& destination) {
			if (destination.stronghold) {
				return "STRONGHOLD";
			}
			if (destination.cleared) {
				return "CLEARED";
			}
			return "TIER " + std::to_string(destination.tier) + (destination.homeByDark() ? "" : ", PAST DARK");
		}

		class AreaMapScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kAreaMap; }

			std::string exportState() const override {
				nlohmann::json pois = nlohmann::json::array();
				for (const Destination& destination : planned.destinations) {
					pois.push_back({{"poi", destination.poi}, {"routes", destination.routes.size()}});
				}
				return nlohmann::json{
					{"pois", pois},
					{"selected", chosen ? nlohmann::json(*chosen) : nlohmann::json(nullptr)},
					{"explored", planned.explored},
				}
					.dump();
			}

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				if (!ui().icons().has("food")) {
					ui().icons().add(icons::iconAtlas());
				}
				const Session* session = sessionOrMenu();
				if (session == nullptr) {
					return;
				}
				planned = planning(*session);
				build();
			}

		  private:
			void build() {
				const Session& session = *game().session;
				const bool	   runOut = session.campaign.run.has_value();
				const MapPage  page = openMapPage(
					 root(),
					 scenes::kAreaMap,
					 {
						 {.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
						 {.id = "tab_compound", .label = "Compound", .onPress = [this] { app().scenes().switchTo(scenes::kCompound); }},
						 {.id = "tab_area_map", .label = "Area map", .active = true, .enabled = !runOut},
						 {.id = "tab_crew", .label = "Crew", .enabled = false, .deckGlyph = true},
					 }
				 );
				page.heading.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = "The area map"});
				page.heading.addChild<ui::Text>(
					{.id = "dawn", .style = styles::subtitle, .text = "day " + std::to_string(session.campaign.day) + ", dawn"}
				);
				map = page.plate.addChild<MapView>({
					.id = "map",
					.minSize = {0.0F, 160.0F},
					.layout = {.flexGrow = 1.0F},
					.layers = &session.layers(),
					.area = session.map->areaMap(),
					.picture = session.map->picture(),
					.planning = &planned,
					.selected = chosen,
					.onPick = [this](std::optional<int> poi) { pickOnMap(poi); },
				});
				page.plate.addChild<ui::Text>(
					{.id = "status", .layout = {.flexShrink = 0.0F}, .style = styles::caption, .text = statusLine(), .wrap = true}
				);

				destinationsBox(page);
				chosenBox = page.boxes.addChild<atlas::LegendBox>({
					.id = "chosen",
					.layout = {.flexShrink = 0.0F},
					.style = {.backgroundColor = ui().getTheme().get(atlas::tokens::palette::freshPaper)},
					.look = {.seed = atlas::paperSeed("area_map/chosen"), .wear = atlas::Wear::Clean},
				});
				plan = page.primary.addChild<atlas::AtlasButton>({
					.id = "plan_here",
					.label = "Plan a run here",
					.road = atlas::Road::Highway,
					.shield = true,
					.onPress = [this] { planHere(); },
				});
				// Two lines of note, held whatever it says, so the button never moves.
				planReason = page.primary.addChild<ui::Text>({
					.id = "plan_reason",
					.minSize = {0.0F, 34.0F},
					.style = styles::warning.extend({.fontSize = 13.0F}),
					.text = " ",
					.wrap = true,
				});
				fillChosen();
			}

			void destinationsBox(const MapPage& page) {
				ui::Ref<atlas::LegendBox> box = page.boxes.addChild<atlas::LegendBox>({
					.id = "destinations",
					.minSize = {0.0F, 0.0F},
					.layout = {.flexGrow = 1.0F},
					.look = {.seed = atlas::paperSeed("area_map/destinations"), .grab = atlas::Corner::BottomLeft},
					.title = "Destinations",
				});
				ui::Ref<ui::Component>	  list = box.addChild<ui::Component>({
					   .id = "destination_list",
					   .minSize = {0.0F, 0.0F},
					   .layout =
						   [] {
							   ui::Layout layout = columnLayout(0.0F);
							   layout.flexGrow = 1.0F;
							   return layout;
						   }(),
					   .overflow = ui::Overflow::Scroll,
					   .focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Vertical},
				   });
				rows.clear();
				if (planned.destinations.empty()) {
					list.addChild<ui::Text>(
						{.id = "no_destinations", .style = styles::quiet, .text = "Nothing found on the map yet.", .wrap = true}
					);
					return;
				}
				for (const Destination& destination : planned.destinations) {
					const int poi = destination.poi;
					rows[poi] = list.addChild<DestinationRow>({
						.id = "poi_" + std::to_string(poi),
						.focusable = true,
						.onFocus = [this, poi](ui::Component& /*row*/) { choose(poi); },
						.label = destination.name,
						.value = rowValue(destination),
						.glyph = destination.glyph,
						.stronghold = destination.stronghold,
						.dim = destination.stronghold || destination.cleared,
						.chosen = chosen == poi,
						.onPress = [this, poi] { choose(poi); },
					});
				}
			}

			void fillChosen() {
				atlas::LegendBox* box = chosenBox.get();
				if (box == nullptr) {
					return;
				}
				if (chosenBody.get() != nullptr) {
					box->removeChild(chosenBody);
				}
				chosenBody = chosenBox.addChild<ui::Component>({.id = "chosen_body", .layout = columnLayout(6.0F)});
				const Destination*		   destination = chosen ? planned.find(*chosen) : nullptr;
				const Session&			   session = *game().session;
				std::optional<std::string> blocker;
				if (destination == nullptr) {
					chosenBody.addChild<ui::Text>({
						.id = "chosen_none",
						.style = styles::quiet,
						.text = "Choose a destination on the map or in the list.",
						.wrap = true,
					});
					blocker = "Choose a destination first.";
				} else {
					ui::Ref<ui::Component> head = chosenBody.addChild<ui::Component>(
						{.layout = {
							 .display = ui::Display::Flex,
							 .flexDirection = ui::FlexDirection::Row,
							 .gap = 10.0F,
							 .alignItems = ui::AlignItems::Center
						 }}
					);
					if (!destination->stronghold) {
						head.addChild<atlas::Circled>({.size = {30.0F, 30.0F}, .text = destination->glyph});
					}
					head.addChild<ui::Text>({
						.id = "chosen_name",
						.minSize = {0.0F, 0.0F},
						.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
						.style = styles::boxTitle,
						.text = destination->name,
						.wrap = true,
					});
					chosenBody.addChild<ui::Text>({
						.id = "chosen_kind",
						.style = styles::kicker,
						.text = destination->kind + " \xC2\xB7 tier " + std::to_string(destination->tier),
					});
					const auto line = [&](const std::string& id, const std::string& words, const ui::Style& style) {
						chosenBody.addChild<ui::Text>({.id = id, .style = style, .text = words, .wrap = true});
					};
					line(
						"chosen_yields",
						destination->stronghold ? "Its yield isn't known." : "Yields " + yieldsText(destination->yields) + ".",
						styles::body
					);
					if (destination->cleared) {
						line("chosen_routes", "A run cleared it, for good.", styles::quiet);
					} else if (destination->routes.empty()) {
						line("chosen_routes", "No road reaches it.", styles::quiet);
					} else {
						const rules::map::RouteOffer& quickest = destination->routes.front();
						line(
							"chosen_routes",
							counted(static_cast<int>(destination->routes.size()), "route", "routes") + ", the quickest " +
								hoursText(quickest.outlook.hours.out) + " out.",
							styles::body
						);
						int home = 0;
						for (const rules::map::RouteOffer& offer : destination->routes) {
							home += offer.outlook.spare >= 0.0 ? 1 : 0;
						}
						line(
							"chosen_dark",
							home == 0
								? std::string("None gets home by dark.")
								: (home == static_cast<int>(destination->routes.size()) ? std::string("Every one gets home by dark.")
																						: std::to_string(home) + " get home by dark."),
							home == 0 ? styles::warning : styles::body
						);
					}
					blocker = planBlocker(session.campaign, *destination);
				}
				if (atlas::AtlasButton* button = plan.get()) {
					button->setEnabled(!blocker.has_value());
				}
				if (ui::Text* reason = planReason.get()) {
					reason->setText(blocker.value_or(" "));
				}
			}

			// "12 destinations and 2 strongholds found, 18% explored".
			std::string statusLine() const {
				int strongholds = 0;
				for (const Destination& destination : planned.destinations) {
					strongholds += destination.stronghold ? 1 : 0;
				}
				const int	destinations = static_cast<int>(planned.destinations.size()) - strongholds;
				const int	explored = static_cast<int>(std::lround(planned.explored * 100.0));
				std::string found = counted(destinations, "destination", "destinations");
				if (strongholds > 0) {
					found += " and " + counted(strongholds, "stronghold", "strongholds");
				}
				return found + " found \xC2\xB7 " + std::to_string(explored) + "% of the region explored";
			}

			void choose(std::optional<int> poi) {
				if (poi == chosen) {
					return;
				}
				if (chosen) {
					if (DestinationRow* row = rowOf(*chosen)) {
						row->setChosen(false);
					}
				}
				chosen = poi;
				if (chosen) {
					if (DestinationRow* row = rowOf(*chosen)) {
						row->setChosen(true);
					}
				}
				if (MapView* view = map.get()) {
					view->select(chosen);
				}
				fillChosen();
			}

			// A marker picks its POI and brings its row into view; anywhere else on the map picks none.
			void pickOnMap(std::optional<int> poi) {
				choose(poi);
				if (poi) {
					if (DestinationRow* row = rowOf(*poi)) {
						row->focus();
					}
				}
			}

			DestinationRow* rowOf(int poi) {
				const auto found = rows.find(poi);
				return found == rows.end() ? nullptr : found->second.get();
			}

			void planHere() {
				if (!chosen) {
					return;
				}
				const Destination* destination = planned.find(*chosen);
				if (destination == nullptr || planBlocker(game().session->campaign, *destination)) {
					return;
				}
				app().scenes().push<RunRouteScene>(RunRouteArgs{.poi = *chosen});
			}

			Planning							   planned;
			std::optional<int>					   chosen;
			ui::Ref<MapView>					   map;
			std::map<int, ui::Ref<DestinationRow>> rows;
			ui::Ref<atlas::LegendBox>			   chosenBox;
			ui::Ref<ui::Component>				   chosenBody;
			ui::Ref<atlas::AtlasButton>			   plan;
			ui::Ref<ui::Text>					   planReason;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeAreaMapScene() {
		return std::make_unique<AreaMapScene>();
	}

} // namespace game
