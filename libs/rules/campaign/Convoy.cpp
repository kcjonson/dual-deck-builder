#include "Convoy.h"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	std::optional<ConvoyRefusal> joinBlocker(const Campaign& campaign) {
		if (campaign.end) {
			return ConvoyRefusal::CampaignOver;
		}
		if (static_cast<int>(campaign.convoy.size()) >= kMostEscorts) {
			return ConvoyRefusal::ConvoyFull;
		}
		return std::nullopt;
	}

	ConvoyId joinConvoy(Campaign& campaign, const Content& content, const EscortId& type) {
		if (joinBlocker(campaign)) {
			throw std::invalid_argument("joinConvoy: no escort can join, with the campaign over or the convoy full");
		}
		const auto found = content.escorts.find(type);
		if (found == content.escorts.end()) {
			throw std::invalid_argument("joinConvoy: no loaded pack defines escort " + type.value);
		}
		const EscortDefinition& escort = found->second;
		const ConvoyId			id{std::string(kConvoyPrefix) + std::to_string(campaign.nextEscortNumber++)};
		campaign.convoy.push_back(ConvoyEscort{.id = id, .type = type, .structure = escort.structure});
		if (campaign.run) {
			campaign.run->escorts.push_back(id);
			campaign.run->seats.front().escortCards.push_back(EscortCard{.card = escort.signatureCard, .broughtBy = id});
		}
		return id;
	}

	std::optional<ConvoyRefusal> dismissBlocker(const Campaign& campaign, const ConvoyId& escort) {
		if (campaign.findEscort(escort) == nullptr) {
			throw std::invalid_argument("dismissBlocker: " + escort.value + " isn't in the convoy");
		}
		if (campaign.end) {
			return ConvoyRefusal::CampaignOver;
		}
		if (campaign.run && std::ranges::find(campaign.run->escorts, escort) == campaign.run->escorts.end()) {
			return ConvoyRefusal::NotAlong;
		}
		return std::nullopt;
	}

	void dismissEscort(Campaign& campaign, const ConvoyId& escort) {
		if (dismissBlocker(campaign, escort)) {
			throw std::invalid_argument("dismissEscort: " + escort.value + " can't be dismissed, with the campaign over or it at home");
		}
		std::erase_if(campaign.convoy, [&](const ConvoyEscort& held) { return held.id == escort; });
		if (campaign.run) {
			std::erase(campaign.run->escorts, escort);
			for (RunDeck& deck : campaign.run->seats) {
				std::erase_if(deck.escortCards, [&](const EscortCard& card) { return card.broughtBy == escort; });
			}
		}
	}

} // namespace rules::campaign
