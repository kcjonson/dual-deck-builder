// Picking a run (Game Flow 3.3 and 3.4), as rows until the area map view lands: every POI a run can be planned to
// today, with its tier and yields, and for the one picked, its routes with their hours, fuel, risk, and the stops a run
// meets, in driving order. "Load out the crew" goes to load out on the route picked.

#include "Words.h"
#include "scenes/GameScene.h"
#include "scenes/loadout/LoadOutScene.h"

#include <rules/campaign/SupplyRun.h>
#include <rules/map/RouteOffers.h>

#include <nlohmann/json.hpp>

#include <cmath>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace game {

	namespace {

		using rules::map::RouteOffer;

		std::string yieldsText(const rules::map::OfferedDestination& destination) {
			std::string text;
			for (size_t resource = 0; resource < destination.yields.size(); ++resource) {
				if (destination.yields[resource] > 0) {
					text += (text.empty() ? "" : ", ") + std::to_string(destination.yields[resource]) + " " +
							std::string(nameOf(rules::map::kResourceNames, static_cast<rules::map::Resource>(resource)));
				}
			}
			return text.empty() ? "nothing" : text;
		}

		std::string hoursText(double hours) {
			const double rounded = std::round(hours * 10.0) / 10.0;
			std::string	 text = std::to_string(rounded);
			text.erase(text.find_last_not_of('0') + 1);
			if (text.back() == '.') {
				text.pop_back();
			}
			return text + " h";
		}

		class AreaMapScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kAreaMap; }

			std::string exportState() const override {
				nlohmann::json pois = nlohmann::json::array();
				for (const auto& [poi, offers] : byPoi) {
					pois.push_back({{"poi", poi}, {"routes", offers.size()}});
				}
				return nlohmann::json{{"pois", pois}, {"selected", selected ? nlohmann::json(*selected) : nlohmann::json(nullptr)}}.dump();
			}

		  protected:
			void enter() override {
				Session* session = sessionOrMenu();
				if (session == nullptr) {
					return;
				}
				for (const RouteOffer& offer : rules::campaign::offersToday(session->campaign, session->layers())) {
					byPoi[offer.destination.poi].push_back(offer);
				}
				build();
			}

		  private:
			void build() {
				const Session& session = *game().session;
				page = kit::openPage(
					*this,
					page,
					"The area map",
					"Pick a POI, then a route. Fuel in the stores: " + std::to_string(session.campaign.stores.fuel)
				);
				ui::Ref<ui::Component> pois = kit::panel(page, "Points of interest", "pois");
				for (const auto& [poi, offers] : byPoi) {
					const rules::map::OfferedDestination& destination = offers.front().destination;
					const std::string					  label = destination.name + " (tier " + std::to_string(destination.tier) + ")";
					const std::string trailing = destination.stronghold ? "stronghold" : "yields " + yieldsText(destination);
					kit::listRow(
						pois,
						"poi_" + std::to_string(poi),
						label,
						trailing,
						[this, poi] {
							selected = poi;
							build();
						},
						false,
						selected == poi
					);
				}
				if (selected) {
					routes(*selected);
				}
				kit::button(page.footer, "back", "Back to the compound", [this] { app().scenes().switchTo(scenes::kCompound); });
			}

			void routes(int poi) {
				const std::vector<RouteOffer>& offers = byPoi.at(poi);
				ui::Ref<ui::Component>		   list = kit::panel(page, "Routes to " + offers.front().destination.name, "routes");
				for (const RouteOffer& offer : offers) {
					const std::string id = "route_" + std::to_string(poi) + "_" + std::to_string(offer.route.route);
					kit::text(
						list,
						offer.route.name + ": " + hoursText(offer.route.hours) + " out, " + std::to_string(offer.route.fuel) +
							" fuel, risk " + std::to_string(offer.risk)
					);
					std::string stops;
					for (const rules::map::OfferedLeg& leg : offer.legs) {
						for (const rules::map::OfferedStop& stop : leg.stops) {
							if (!stop.cleared) {
								const rules::map::Stop& met = game().session->layers().stops.stops[static_cast<size_t>(stop.stop)];
								stops += (stops.empty() ? "" : ", ") + stopText(met);
							}
						}
					}
					kit::caption(list, "Stops: " + (stops.empty() ? std::string("none") : stops));
					const rules::campaign::RouteChoice choice{.poi = poi, .route = offer.route.route};
					// Whether a run can leave on it is departure's to say, at load out, once someone is seated.
					kit::button(
						list,
						id,
						"Load out the crew",
						[this, choice] { app().scenes().replace<LoadOutScene>(LoadOutArgs{.route = choice}); },
						ui::ButtonVariant::Primary
					);
				}
			}

			std::map<int, std::vector<RouteOffer>> byPoi;
			std::optional<int>					   selected;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeAreaMapScene() {
		return std::make_unique<AreaMapScene>();
	}

} // namespace game
