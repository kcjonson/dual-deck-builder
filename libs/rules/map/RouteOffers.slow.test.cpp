#include <rules/map/MapTesting.h>
#include <rules/map/PoiNames.h>
#include <rules/map/RouteOffers.h>
#include <rules/map/RouteOutlook.h>
#include <rules/map/RouteTesting.h>
#include <rules/map/StopRoom.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <vector>

// The routes on offer over the mixed map's layers, as the stages make them on their first streams.
namespace {

	using namespace rules::map;

	std::vector<RouteOffer> offersOn(const MapParams& params, const MapToday& today) {
		const Ground  ground = fixtures::groundFor(params);
		const BiomeAt biomeAt = [ground](Point at) {
			return ground.biome(at.x, at.y);
		};
		return routeOffers({
			.network = fixtures::roadsFor(params).network(),
			.places = fixtures::placesFor(params),
			.pois = fixtures::poisFor(params),
			.stops = fixtures::stopsFor(params),
			.biomeAt = biomeAt,
			.params = params,
			.content = fixtures::content(),
			.routes = fixtures::routeTuning(),
			.today = today,
		});
	}

	TEST(RouteOffers, OfferEveryRouteToEveryPoiWithEveryStopARunMeetsOnIt) {
		const MapParams&			   params = fixtures::mixed();
		const PoiLayer&				   pois = fixtures::poisFor(params);
		const StopLayer&			   stops = fixtures::stopsFor(params);
		const MapContent&			   content = fixtures::content();
		const std::vector<RouteOffer>  offers = offersOn(params, {});
		const std::vector<std::string> names = poiNames(pois, fixtures::placesFor(params), content.pois, content.factions, params.radius);
		size_t						   at = 0;
		for (size_t poi = 0; poi < pois.pois.size(); ++poi) {
			const std::vector<Route> routes = routesTo(pois.legs, static_cast<int>(poi));
			for (size_t place = 0; place < routes.size(); ++place, ++at) {
				ASSERT_LT(at, offers.size());
				const RouteOffer& offer = offers[at];
				EXPECT_EQ(offer.destination.poi, static_cast<int>(poi));
				EXPECT_EQ(offer.destination.name, names[poi]);
				EXPECT_EQ(offer.destination.tier, pois.pois[poi].tier);
				const bool stronghold = pois.pois[poi].type == kStrongholdType;
				EXPECT_EQ(offer.destination.stronghold, stronghold);
				const std::array<int, 5> yields = stronghold ? std::array<int, 5>{} : content.pois.types.at(pois.pois[poi].type).yields;
				EXPECT_EQ(offer.destination.yields, yields);
				EXPECT_EQ(offer.route.route, static_cast<int>(place));
				EXPECT_EQ(offer.route.legs, routes[place].legs);
				EXPECT_FALSE(offer.outlook.estimated);
				EXPECT_EQ(offer.risk, std::max(offer.outlook.risk, 1));
				ASSERT_EQ(offer.legs.size(), routes[place].legs.size());
				size_t known = 0;
				for (const OfferedLeg& leg : offer.legs) {
					EXPECT_EQ(leg.length, pois.legs.legs[static_cast<size_t>(leg.leg)].length);
					std::vector<int> ids;
					for (const OfferedStop& stop : leg.stops) {
						ids.push_back(stop.stop);
						EXPECT_EQ(stop.type, stops.stops[static_cast<size_t>(stop.stop)].type);
						EXPECT_EQ(stop.haul.has_value(), stop.type == StopType::FindSupplies);
						EXPECT_EQ(stop.haul, rollStop(stops, stop.stop, 0, content.stops).supplies);
						EXPECT_FALSE(stop.cleared);
					}
					EXPECT_EQ(ids, stops.legs[static_cast<size_t>(leg.leg)].stops);
					known += ids.size();
				}
				// Every leg charted, so the route card knows every stop the run meets.
				EXPECT_EQ(offer.outlook.stops.size(), known);
			}
		}
		EXPECT_EQ(at, offers.size());
	}

	// Guarantees 10 on the route card: the daylight check counted every extra on, so a tier 1 to 3 POI has a route home
	// by dark at the last game stage too.
	TEST(RouteOffers, LeaveEveryPoiInTiersOneToThreeARouteHomeByDarkAtEveryGameStage) {
		const MapParams&			  params = fixtures::mixed();
		const std::vector<RouteOffer> offers = offersOn(params, {.gameStage = 6});
		for (const RouteOffer& offer : offers) {
			if (offer.destination.tier > kDaylightTiers) {
				continue;
			}
			EXPECT_TRUE(std::ranges::any_of(offers, [&](const RouteOffer& other) {
				return other.destination.poi == offer.destination.poi && other.outlook.spare >= -1e-9;
			})) << offer.destination.name;
		}
		size_t extras = 0;
		for (const RouteOffer& offer : offers) {
			for (const OfferedLeg& leg : offer.legs) {
				for (const OfferedStop& stop : leg.stops) {
					extras += fixtures::stopsFor(params).stops[static_cast<size_t>(stop.stop)].stage > 0 ? 1 : 0;
				}
			}
		}
		EXPECT_GT(extras, 0U);
	}

	TEST(RouteOffers, MarkAStopClearedAndRollAStopThatsComeBackAtItsRoll) {
		const MapParams& params = fixtures::mixed();
		const StopLayer& stops = fixtures::stopsFor(params);
		const auto		 find = std::ranges::find(stops.stops, StopType::FindSupplies, &Stop::type);
		ASSERT_NE(find, stops.stops.end());
		const int supplies = static_cast<int>(find - stops.stops.begin());
		const int fight =
			static_cast<int>(std::ranges::find_if(stops.stops, [](const Stop& stop) { return isFight(stop.type); }) - stops.stops.begin());
		const std::vector<RouteOffer> offers = offersOn(params, {.cleared = {fight}, .rolls = {{supplies, 3}}});
		bool						  sawFight = false;
		bool						  sawSupplies = false;
		for (const RouteOffer& offer : offers) {
			for (const OfferedLeg& leg : offer.legs) {
				for (const OfferedStop& stop : leg.stops) {
					if (stop.stop == fight) {
						EXPECT_TRUE(stop.cleared);
						sawFight = true;
					}
					if (stop.stop == supplies) {
						EXPECT_EQ(stop.roll, 3);
						EXPECT_EQ(stop.haul, rollStop(stops, supplies, 3, fixtures::content().stops).supplies);
						sawSupplies = true;
					}
				}
			}
		}
		EXPECT_TRUE(sawFight && sawSupplies);
	}

} // namespace
