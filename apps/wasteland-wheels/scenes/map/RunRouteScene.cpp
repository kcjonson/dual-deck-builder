#include "scenes/map/RunRouteScene.h"

#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Glyphs.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/Tokens.h"
#include "scenes/loadout/LoadOutScene.h"
#include "scenes/map/MapPage.h"
#include "scenes/map/MapView.h"
#include "scenes/map/PlanRows.h"

#include <nlohmann/json.hpp>

#include <algorithm>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		using rules::map::RouteOffer;

		bool fuelled(const rules::campaign::Campaign& campaign, const RouteOffer& offer) {
			return campaign.stores.fuel >= offer.route.fuel;
		}

		std::string homeText(const RouteOffer& offer) {
			const rules::map::RouteOutlook& outlook = offer.outlook;
			const std::string				back = (outlook.estimated ? "about " : "") + clockText(outlook.back);
			return outlook.spare >= 0.0 ? "Home by " + back + ", dark at " + clockText(outlook.dark) + "."
										: "Back after dark, " + back + ", dark at " + clockText(outlook.dark) + ".";
		}

	} // namespace

	RunRouteScene::RunRouteScene(RunRouteArgs args)
		: poi(args.poi) {}

	const ui::Theme& RunRouteScene::sceneTheme() const {
		return atlas::theme();
	}

	std::string RunRouteScene::exportState() const {
		return nlohmann::json{
			{"poi", poi},
			{"routes", destination != nullptr ? destination->routes.size() : 0},
			{"picked",
			 destination != nullptr && !destination->routes.empty() ? nlohmann::json(pickedOffer().route.route) : nlohmann::json(nullptr)},
			{"loadOut", !loadOutBlocker().has_value()},
		}
			.dump();
	}

	void RunRouteScene::enter() {
		if (!ui().icons().has("food")) {
			ui().icons().add(icons::iconAtlas());
		}
		const Session* session = sessionOrMenu();
		if (session == nullptr) {
			return;
		}
		planned = planning(*session);
		destination = planned.find(poi);
		if (destination == nullptr || destination->routes.empty()) {
			LOG_ERROR(Game, "run_route: POI %d isn't a destination with routes; back to the area map", poi);
			app().scenes().switchTo(scenes::kAreaMap);
			return;
		}
		// The quickest route the stores can fuel, or the quickest of all when none can be.
		const auto fuelledRoute =
			std::ranges::find_if(destination->routes, [&](const RouteOffer& offer) { return fuelled(session->campaign, offer); });
		picked = fuelledRoute == destination->routes.end() ? 0 : static_cast<int>(fuelledRoute - destination->routes.begin());
		build();
	}

	const RouteOffer& RunRouteScene::pickedOffer() const {
		return destination->routes.at(static_cast<size_t>(picked));
	}

	std::optional<std::string> RunRouteScene::loadOutBlocker() const {
		if (destination == nullptr || destination->routes.empty() || !game().session) {
			return "There's no route to load out on.";
		}
		const rules::campaign::Campaign& campaign = game().session->campaign;
		if (std::optional<std::string> blocker = planBlocker(campaign, *destination)) {
			return blocker;
		}
		// Departure refuses it for want of fuel at load out; the card says so before the crew is seated.
		const RouteOffer& offer = pickedOffer();
		if (!fuelled(campaign, offer)) {
			return "The stores hold " + std::to_string(campaign.stores.fuel) + " fuel, and this route burns " +
				   std::to_string(offer.route.fuel) + " out and back.";
		}
		return std::nullopt;
	}

	void RunRouteScene::build() {
		const Session& session = *game().session;
		const MapPage  page = openMapPage(
			 root(),
			 "run_route",
			 {
				 {.id = "main_menu", .label = "Menu", .onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); }},
				 {.id = "tab_compound", .label = "Compound", .onPress = [this] { app().scenes().switchTo(scenes::kCompound); }},
				 {.id = "tab_area_map", .label = "Area map", .active = true},
				 {.id = "tab_crew", .label = "Crew", .enabled = false, .deckGlyph = true},
			 }
		 );
		// The back link on a line of its own over the title, so neither squeezes the other on a narrow plate.
		ui::Layout heading = columnLayout(6.0F);
		heading.alignItems = ui::AlignItems::Start;
		heading.flexShrink = 0.0F;
		page.heading.get()->setLayout(heading);
		page.heading.addChild<atlas::AtlasButton>({
			.id = "back_to_map",
			.layout = {.flexShrink = 0.0F},
			.label = "Back to the area map",
			.onPress = [this] { app().scenes().pop(); },
		});
		page.heading.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = "The run route"});
		map = page.plate.addChild<MapView>({
			.id = "map",
			.minSize = {0.0F, 160.0F},
			.layout = {.flexGrow = 1.0F},
			.layers = &session.layers(),
			.area = session.map->areaMap(),
			.picture = session.map->picture(),
			.planning = &planned,
			.routesOf = poi,
			.picked = picked,
			.selected = poi,
		});
		page.plate.addChild<ui::Text>({
			.id = "status",
			.layout = {.flexShrink = 0.0F},
			.style = styles::caption,
			.text = counted(static_cast<int>(destination->routes.size()), "route", "routes") + " to " + destination->name +
					", the picked one in highlighter",
			.wrap = true,
		});

		ui::Ref<atlas::LegendBox> box = page.boxes.addChild<atlas::LegendBox>({
			.id = "destination",
			.layout = {.flexShrink = 0.0F},
			.style = {.backgroundColor = ui().getTheme().get(atlas::tokens::palette::freshPaper)},
			.look = {.seed = atlas::paperSeed("run_route/destination"), .wear = atlas::Wear::Clean},
		});
		ui::Ref<ui::Component>	  head = box.addChild<ui::Component>(
			   {.layout = {
					.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = 10.0F, .alignItems = ui::AlignItems::Center
				}}
		   );
		head.addChild<atlas::Circled>({.size = {30.0F, 30.0F}, .text = destination->glyph});
		head.addChild<ui::Text>({
			.id = "destination_name",
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
			.style = styles::boxTitle,
			.text = destination->name,
			.wrap = true,
		});
		box.addChild<ui::Text>({
			.id = "destination_kind",
			.style = styles::kicker,
			.text = destination->kind + " \xC2\xB7 tier " + std::to_string(destination->tier) + " \xC2\xB7 day " +
					std::to_string(session.campaign.day) + ", dawn",
		});
		box.addChild<ui::Text>(
			{.id = "destination_yields", .style = styles::body, .text = "Yields " + yieldsText(destination->yields) + ".", .wrap = true}
		);

		// The routes and their stops scroll together under the destination.
		ui::Ref<ui::Component>	  scrolled = page.boxes.addChild<ui::Component>({
			   .id = "route_boxes",
			   .minSize = {0.0F, 0.0F},
			   .layout =
				   [] {
					   ui::Layout layout = columnLayout(14.0F);
					   layout.flexGrow = 1.0F;
					   return layout;
				   }(),
			   .overflow = ui::Overflow::Scroll,
		   });
		ui::Ref<atlas::LegendBox> routes = scrolled.addChild<atlas::LegendBox>({
			.id = "routes",
			.layout = {.flexShrink = 0.0F},
			.look = {.seed = atlas::paperSeed("run_route/routes"), .grab = atlas::Corner::BottomLeft},
			.title = "Routes",
		});
		ui::Ref<ui::Component>	  list = routes.addChild<ui::Component>({
			   .id = "route_list",
			   .layout = columnLayout(0.0F),
			   .focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Vertical},
		   });
		cards.clear();
		for (size_t index = 0; index < destination->routes.size(); ++index) {
			const RouteOffer& offer = destination->routes[index];
			const bool		  canFuel = fuelled(session.campaign, offer);
			const int		  at = static_cast<int>(index);
			cards.push_back(list.addChild<RouteCard>({
				.id = "route_" + std::to_string(poi) + "_" + std::to_string(offer.route.route),
				.focusable = true,
				.name = offer.route.name,
				.facts = routeFacts(offer),
				.note = canFuel ? (offer.outlook.spare >= 0.0 ? homeText(offer) : "Back after dark.")
								: "Needs " + std::to_string(offer.route.fuel) + " fuel; the stores hold " +
									  std::to_string(session.campaign.stores.fuel) + ".",
				.warn = !canFuel || offer.outlook.spare < 0.0,
				.dim = !canFuel,
				.chosen = at == picked,
				.onPress = [this, at] { pickRoute(at); },
			}));
		}
		stopsBox = scrolled.addChild<atlas::LegendBox>({
			.id = "stops",
			.layout = {.flexShrink = 0.0F},
			.look = {.seed = atlas::paperSeed("run_route/stops"), .grab = atlas::Corner::TopRight},
			.title = "Stops in order",
		});
		fillStops();

		homeLine = page.primary.addChild<ui::Text>({.id = "home_by", .style = styles::caption, .text = " ", .wrap = true});
		loadOut = page.primary.addChild<atlas::AtlasButton>({
			.id = "load_out_crew",
			.label = "Load out the crew",
			.road = atlas::Road::Highway,
			.shield = true,
			.onPress = [this] {
				if (loadOutBlocker()) {
					return;
				}
				app().scenes().replace<LoadOutScene>(LoadOutArgs{.route = {.poi = poi, .route = pickedOffer().route.route}});
			},
		});
		loadOutReason = page.primary.addChild<ui::Text>({
			.id = "load_out_reason",
			.minSize = {0.0F, 34.0F},
			.style = styles::warning.extend({.fontSize = 13.0F}),
			.text = " ",
			.wrap = true,
		});
		fillFoot();
	}

	void RunRouteScene::pickRoute(int index) {
		if (index == picked) {
			return;
		}
		if (RouteCard* card = cards.at(static_cast<size_t>(picked)).get()) {
			card->setChosen(false);
		}
		picked = index;
		if (RouteCard* card = cards.at(static_cast<size_t>(picked)).get()) {
			card->setChosen(true);
		}
		if (MapView* view = map.get()) {
			view->pick(picked);
		}
		fillStops();
		fillFoot();
	}

	void RunRouteScene::fillStops() {
		ui::Component* box = stopsBox.get();
		if (box == nullptr) {
			return;
		}
		if (stopsBody.get() != nullptr) {
			box->removeChild(stopsBody);
		}
		stopsBody = stopsBox.addChild<ui::Component>({.id = "stop_list", .layout = columnLayout(0.0F)});
		const rules::map::RouteOutlook& outlook = pickedOffer().outlook;
		if (outlook.stops.empty()) {
			stopsBody.addChild<atlas::LegendRow>(
				{.id = "stop_none", .symbol = atlas::MapSymbol::Dash, .text = "No stops known on the road.", .textStyle = styles::quiet}
			);
			return;
		}
		const rules::map::StopLayer& layer = game().session->layers().stops;
		int							 index = 0;
		for (const rules::map::KnownStop& stop : outlook.stops) {
			std::string words = stop.type ? stopText(layer.stops.at(static_cast<size_t>(stop.stop))) : "A stop, not known yet";
			if (stop.cleared) {
				words += ", cleared";
			}
			const bool fight = stop.type && rules::map::isFight(*stop.type);
			stopsBody.addChild<atlas::LegendRow>({
				.id = "stop_" + std::to_string(index++),
				.symbol = fight ? atlas::MapSymbol::Diamond : (stop.cleared ? atlas::MapSymbol::Dash : atlas::MapSymbol::Ring),
				.text = words,
				.textStyle = stop.cleared ? styles::quiet : styles::body,
			});
		}
	}

	void RunRouteScene::fillFoot() {
		const RouteOffer& offer = pickedOffer();
		if (ui::Text* line = homeLine.get()) {
			line->setText(homeText(offer));
			line->setStyle(offer.outlook.spare >= 0.0 ? styles::caption : styles::warning.extend({.fontSize = 13.0F}));
		}
		const std::optional<std::string> blocker = loadOutBlocker();
		if (ui::Component* button = loadOut.get()) {
			button->setEnabled(!blocker.has_value());
		}
		if (ui::Text* reason = loadOutReason.get()) {
			reason->setText(blocker.value_or(" "));
		}
	}

} // namespace game
