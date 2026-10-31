#include "RouteOffers.h"

#include "PoiNames.h"

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <utility>

namespace rules::map {

	namespace {

		// The class with the most length on the leg, ties to the earlier.
		RoadClass mostOf(const RoadNetwork& network, const Leg& leg) {
			std::array<double, 3> lengths{};
			for (const LegPiece& piece : leg.pieces) {
				lengths[static_cast<size_t>(network.stretches[static_cast<size_t>(piece.stretch)].roadClass)] += piece.length;
			}
			return static_cast<RoadClass>(std::ranges::max_element(lengths) - lengths.begin());
		}

		std::vector<OfferedLeg> legsOf(const OfferArgs& args, const RouteDescriptor& route) {
			std::vector<OfferedLeg> legs;
			for (const int id : route.legs) {
				const Leg&	leg = args.pois.legs.legs[static_cast<size_t>(id)];
				OfferedLeg& offered = legs.emplace_back(
					OfferedLeg{
						.leg = id,
						.roadClass = mostOf(args.network, leg),
						.length = leg.length,
						.hours = leg.hours,
						.stops = {},
					}
				);
				for (const int stop : stopsAtStage(args.stops.legs[static_cast<size_t>(id)], args.stops, args.today.gameStage)) {
					const Stop& placed = args.stops.stops[static_cast<size_t>(stop)];
					const auto	rolled = args.today.rolls.find(stop);
					const int	roll = rolled == args.today.rolls.end() ? 0 : rolled->second;
					offered.stops.push_back({
						.stop = stop,
						.at = placed.at,
						.type = placed.type,
						.skulls = placed.skulls,
						.roll = roll,
						.haul = placed.type == StopType::FindSupplies ? rollStop(args.stops, stop, roll, args.content.stops).supplies
																	  : std::nullopt,
						.cleared = args.today.cleared.contains(stop),
					});
				}
			}
			return legs;
		}

	} // namespace

	std::vector<RouteOffer> routeOffers(const OfferArgs& args) {
		assert(args.stops.legs.size() == args.pois.legs.legs.size() && "routeOffers: the stops are the POIs' legs'");
		const std::vector<std::string> names =
			poiNames(args.pois, args.places, args.content.pois, args.content.factions, args.params.radius);
		std::vector<RouteOffer> offers;
		for (size_t poi = 0; poi < args.pois.pois.size(); ++poi) {
			const Poi&		   site = args.pois.pois[poi];
			OfferedDestination destination{
				.poi = static_cast<int>(poi),
				.name = names[poi],
				.tier = site.tier,
				.stronghold = site.type == kStrongholdType,
				.yields = {},
			};
			if (!destination.stronghold) {
				destination.yields = args.content.pois.types.find(site.type)->second.yields;
			}
			const double objective = objectiveHours(site, args.content.stops);
			for (RouteDescriptor& route : describeRoutes({
					 .network = args.network,
					 .routeLegs = args.pois.legs,
					 .destination = static_cast<int>(poi),
					 .biomeAt = args.biomeAt,
					 .tuning = args.routes,
				 })) {
				RouteOutlook			outlook = outlookOf({
							   .network = args.network,
							   .routeLegs = args.pois.legs,
							   .stops = args.stops,
							   .route = route,
							   .objectiveHours = objective,
							   .params = args.params,
							   .tuning = args.content.stops,
							   .today = args.today,
				   });
				std::vector<OfferedLeg> legs = legsOf(args, route);
				const int				risk = std::max(outlook.risk, 1);
				offers.push_back({
					.destination = destination,
					.route = std::move(route),
					.outlook = std::move(outlook),
					.legs = std::move(legs),
					.risk = risk,
				});
			}
		}
		return offers;
	}

} // namespace rules::map
