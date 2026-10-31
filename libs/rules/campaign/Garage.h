#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

#include <rules/packs/Pack.h>

#include <optional>
#include <variant>
#include <vector>

namespace rules::campaign {

	// The compound's garage (Compound and Supply Runs, Buildings; Game Flow 4): cards for the locker, escorts hired into
	// the convoy, and repairs, all for scrap from the stores, between runs. It works whether or not its building stands
	// (call 396). A roadside garage is a stop on the map. There are no vehicle mods to sell: nothing defines one yet.

	// The day's stock: `stock` different cards from rollCardOffers on the seed's fork("garage", day), one copy each,
	// order cards only while the convoy has an escort (call 398). Founding and each dawn (endDay) put it on the campaign.
	[[nodiscard]] std::vector<GarageOffer> rollGarageStock(const Campaign& campaign, const Content& content, const GarageRules& rules);

	// A card's price, by its rarity. Throws std::invalid_argument for a card no shop sells.
	[[nodiscard]] int cardPrice(const Content& content, const GarageRules& rules, const CardId& card);

	// Why the garage refuses, in the order checked:
	//   CampaignOver    the campaign is over
	//   RunOut          a run is out, and the garage at home works between runs (call 397)
	//   SoldOut         today's copy of the card is sold
	//   ConvoyFull      the convoy holds kMostEscorts, so one is dismissed first
	//   DriverAway      the vehicle's driver is dead or missing, and it went with them
	//   Undamaged       the vehicle has nothing to put back
	//   TooManyPoints   it has fewer points to put back (`count`), which isn't clamped
	//   TooLittleScrap  the stores hold less scrap than it costs (`count`, the price)
	enum class GarageRefusal { CampaignOver, RunOut, SoldOut, ConvoyFull, DriverAway, Undamaged, TooManyPoints, TooLittleScrap };

	struct GarageBlocker {
		GarageRefusal reason{GarageRefusal::TooLittleScrap};
		int			  count{0};

		bool operator==(const GarageBlocker&) const = default;
	};

	// Throws std::invalid_argument for a card that isn't in today's stock.
	[[nodiscard]] std::optional<GarageBlocker>
	buyBlocker(const Campaign& campaign, const Content& content, const GarageRules& rules, const CardId& card);

	// Today's copy into the locker, for its price. Throws std::invalid_argument for a purchase buyBlocker refuses.
	void buyCard(Campaign& campaign, const Content& content, const GarageRules& rules, const CardId& card);

	// Every type the garage file prices is for hire, any day (call 399). Throws std::invalid_argument for a type it
	// doesn't price.
	[[nodiscard]] std::optional<GarageBlocker> hireBlocker(const Campaign& campaign, const GarageRules& rules, const EscortId& type);

	// Pays for the escort and joins it to the convoy (joinConvoy), returning its id. Throws std::invalid_argument for a
	// hire hireBlocker refuses.
	ConvoyId hireEscort(Campaign& campaign, const Content& content, const GarageRules& rules, const EscortId& type);

	// A convoy escort, whose structure the garage puts back, or a driver in the pool, whose own vehicle's structure and
	// armor it puts back (call 400).
	using RepairTarget = std::variant<ConvoyId, CrewId>;

	// The points short of whole: an escort's structure under its type's, or a driver's vehicle's structure and armor
	// under their archetype's. Throws std::invalid_argument for an escort outside the convoy or a driver outside the pool.
	[[nodiscard]] int pointsToRepair(const Campaign& campaign, const Content& content, const RepairTarget& target);

	// Throws std::invalid_argument as pointsToRepair does, and for points under 1.
	[[nodiscard]] std::optional<GarageBlocker>
	repairBlocker(const Campaign& campaign, const Content& content, const GarageRules& rules, const RepairTarget& target, int points);

	// Puts `points` back for repairPerPoint scrap each: a driver's vehicle gets its structure back before its armor.
	// Throws std::invalid_argument for a repair repairBlocker refuses.
	void repairVehicle(Campaign& campaign, const Content& content, const GarageRules& rules, const RepairTarget& target, int points);

} // namespace rules::campaign
