#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

namespace rules::campaign {

	// The campaign's end (campaign-end.md). Each cause is checked by the one step that can bring it about: a lost run
	// that leaves nobody at the compound (the combat bridge's write-back), and a night that leaves no People with no run
	// out (endDay). Once it's set, nothing changes the campaign.

	// Every driver in the pool dead or missing, in a pool that had one (call 37).
	[[nodiscard]] bool nobodyAtCompound(const Campaign& campaign);

	// How the compound falls, read off the stores and unrest after the step that lost it: starved at or below
	// starveAtFood, rioted at or above riotAtUnrest, and otherwise disbanded, hunger first (call 40).
	[[nodiscard]] Ending fallOf(const Campaign& campaign, const CompoundRules& rules);

	// Ends the campaign for `cause` with the fall's one log line, dated the day it fell (call 42): "No drivers are left,
	// and the compound starved."
	void endCampaign(Campaign& campaign, const CompoundRules& rules, EndCause cause);

} // namespace rules::campaign
