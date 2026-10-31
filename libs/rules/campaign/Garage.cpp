#include "Garage.h"

#include "CardOffers.h"
#include "Convoy.h"

#include <random/Rng.h>

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		// What the vehicle has short of whole, structure and armor; an escort's armor refills between fights.
		struct Shortfall {
			int structure{0};
			int armor{0};
		};

		Shortfall shortfallOf(const Campaign& campaign, const Content& content, const RepairTarget& target) {
			if (const auto* escort = std::get_if<ConvoyId>(&target)) {
				const ConvoyEscort* held = campaign.findEscort(*escort);
				if (held == nullptr) {
					throw std::invalid_argument("the garage: " + escort->value + " isn't in the convoy");
				}
				return Shortfall{.structure = std::max(0, content.escorts.at(held->type).structure - held->structure)};
			}
			const DriverRecord& driver = campaign.driver(std::get<CrewId>(target));
			const VehicleStats& whole = content.drivers.at(driver.archetype).vehicle;
			return Shortfall{
				.structure = std::max(0, whole.maxStructure - driver.vehicle.structure),
				.armor = std::max(0, whole.armor - driver.vehicle.armor),
			};
		}

		std::optional<GarageBlocker> shutBlocker(const Campaign& campaign) {
			if (campaign.end) {
				return GarageBlocker{.reason = GarageRefusal::CampaignOver};
			}
			if (campaign.run) {
				return GarageBlocker{.reason = GarageRefusal::RunOut};
			}
			return std::nullopt;
		}

		std::optional<GarageBlocker> priceBlocker(const Campaign& campaign, int price) {
			if (campaign.stores.scrap < price) {
				return GarageBlocker{.reason = GarageRefusal::TooLittleScrap, .count = price};
			}
			return std::nullopt;
		}

		size_t offerIndex(const std::vector<GarageOffer>& stock, const CardId& card) {
			const auto found = std::ranges::find(stock, card, &GarageOffer::card);
			if (found == stock.end()) {
				throw std::invalid_argument("the garage: " + card.value + " isn't in today's stock");
			}
			return static_cast<size_t>(found - stock.begin());
		}

		int hirePrice(const GarageRules& rules, const EscortId& type) {
			const auto found = rules.hirePrices.find(type);
			if (found == rules.hirePrices.end()) {
				throw std::invalid_argument("the garage: " + type.value + " isn't for hire");
			}
			return found->second;
		}

	} // namespace

	std::vector<GarageOffer> rollGarageStock(const Campaign& campaign, const Content& content, const GarageRules& rules) {
		foundation::Rng			 rng = foundation::Rng(campaign.seed).fork("garage", campaign.day);
		std::vector<GarageOffer> stock;
		for (CardId& card : rollCardOffers(rng, content, rules.stock, !campaign.convoy.empty())) {
			stock.push_back(GarageOffer{.card = std::move(card), .sold = false});
		}
		return stock;
	}

	int cardPrice(const Content& content, const GarageRules& rules, const CardId& card) {
		const auto found = content.cards.find(card);
		if (found == content.cards.end() || !isOffered(found->second)) {
			throw std::invalid_argument("cardPrice: no shop sells " + card.value);
		}
		return rules.cardPrices.at(found->second.rarity);
	}

	std::optional<GarageBlocker>
	buyBlocker(const Campaign& campaign, const Content& content, const GarageRules& rules, const CardId& card) {
		const GarageOffer& offer = campaign.garage[offerIndex(campaign.garage, card)];
		if (std::optional<GarageBlocker> shut = shutBlocker(campaign)) {
			return shut;
		}
		if (offer.sold) {
			return GarageBlocker{.reason = GarageRefusal::SoldOut};
		}
		return priceBlocker(campaign, cardPrice(content, rules, card));
	}

	void buyCard(Campaign& campaign, const Content& content, const GarageRules& rules, const CardId& card) {
		if (buyBlocker(campaign, content, rules, card)) {
			throw std::invalid_argument("buyCard: the garage won't sell " + card.value + " now");
		}
		campaign.garage[offerIndex(campaign.garage, card)].sold = true;
		campaign.stores.scrap -= cardPrice(content, rules, card);
		addCards(campaign.locker, card, 1);
	}

	std::optional<GarageBlocker> hireBlocker(const Campaign& campaign, const GarageRules& rules, const EscortId& type) {
		const int price = hirePrice(rules, type);
		if (std::optional<GarageBlocker> shut = shutBlocker(campaign)) {
			return shut;
		}
		if (static_cast<int>(campaign.convoy.size()) >= kMostEscorts) {
			return GarageBlocker{.reason = GarageRefusal::ConvoyFull, .count = kMostEscorts};
		}
		return priceBlocker(campaign, price);
	}

	ConvoyId hireEscort(Campaign& campaign, const Content& content, const GarageRules& rules, const EscortId& type) {
		if (hireBlocker(campaign, rules, type)) {
			throw std::invalid_argument("hireEscort: the garage won't hire out a " + type.value + " now");
		}
		campaign.stores.scrap -= hirePrice(rules, type);
		return joinConvoy(campaign, content, type);
	}

	int pointsToRepair(const Campaign& campaign, const Content& content, const RepairTarget& target) {
		const Shortfall shortfall = shortfallOf(campaign, content, target);
		return shortfall.structure + shortfall.armor;
	}

	std::optional<GarageBlocker>
	repairBlocker(const Campaign& campaign, const Content& content, const GarageRules& rules, const RepairTarget& target, int points) {
		const int missing = pointsToRepair(campaign, content, target);
		if (points < 1) {
			throw std::invalid_argument("repairBlocker: a repair puts back 1 or more points");
		}
		if (std::optional<GarageBlocker> shut = shutBlocker(campaign)) {
			return shut;
		}
		if (const auto* driver = std::get_if<CrewId>(&target)) {
			const DriverStatus status = campaign.driver(*driver).status;
			if (status == DriverStatus::Dead || status == DriverStatus::Missing) {
				return GarageBlocker{.reason = GarageRefusal::DriverAway};
			}
		}
		if (missing == 0) {
			return GarageBlocker{.reason = GarageRefusal::Undamaged};
		}
		if (points > missing) {
			return GarageBlocker{.reason = GarageRefusal::TooManyPoints, .count = missing};
		}
		return priceBlocker(campaign, points * rules.repairPerPoint);
	}

	void repairVehicle(Campaign& campaign, const Content& content, const GarageRules& rules, const RepairTarget& target, int points) {
		if (repairBlocker(campaign, content, rules, target, points)) {
			throw std::invalid_argument("repairVehicle: the garage won't put " + std::to_string(points) + " points back now");
		}
		campaign.stores.scrap -= points * rules.repairPerPoint;
		if (const auto* escort = std::get_if<ConvoyId>(&target)) {
			campaign.findEscort(*escort)->structure += points;
			return;
		}
		VehicleCondition& vehicle = campaign.driver(std::get<CrewId>(target)).vehicle;
		const int		  structure = std::min(points, shortfallOf(campaign, content, target).structure);
		vehicle.structure += structure;
		vehicle.armor += points - structure;
	}

} // namespace rules::campaign
