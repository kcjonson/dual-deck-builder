#pragma once

#include "Campaign.h"

#include <rules/packs/Pack.h>

#include <optional>

namespace rules::campaign {

	// Escorts joining the convoy and leaving it (Combat Rules, Escorts; escorts.md), at the compound or out on a run:
	// founding's starters, the garage's hires, and on the road an event's or a roadside garage's, which the map's stops
	// offer.

	// Why an escort can't join or leave, in the order checked:
	//   CampaignOver  the campaign is over
	//   ConvoyFull    the convoy holds kMostEscorts, so one is dismissed first
	//   NotAlong      a run is out and the escort stayed home, out of the road's reach (call 403)
	enum class ConvoyRefusal { CampaignOver, ConvoyFull, NotAlong };

	[[nodiscard]] std::optional<ConvoyRefusal> joinBlocker(const Campaign& campaign);

	// An escort of `type` joins: the next escort id, at its type's full structure, last in roster order. With a run out
	// it comes along at once, last among the run's escorts, and brings its signature card into Driver 1's run deck, as
	// at load out, which moveEscortCard gives to Driver 2 (call 402). Returns its id. Throws std::invalid_argument for a
	// join joinBlocker refuses and a type no loaded pack defines.
	ConvoyId joinConvoy(Campaign& campaign, const Content& content, const EscortId& type);

	// Throws std::invalid_argument for an escort outside the convoy.
	[[nodiscard]] std::optional<ConvoyRefusal> dismissBlocker(const Campaign& campaign, const ConvoyId& escort);

	// The escort leaves the convoy for good, and pays nothing. One along on the run leaves it too, and the card it
	// brought leaves whichever run deck holds it, another escort of its type keeping its own copy. Throws
	// std::invalid_argument for a dismissal dismissBlocker refuses.
	void dismissEscort(Campaign& campaign, const ConvoyId& escort);

} // namespace rules::campaign
