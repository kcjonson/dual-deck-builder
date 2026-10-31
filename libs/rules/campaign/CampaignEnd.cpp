#include "CampaignEnd.h"

#include <algorithm>
#include <cassert>
#include <string>

namespace rules::campaign {

	bool nobodyAtCompound(const Campaign& campaign) {
		return !campaign.drivers.empty() && std::ranges::none_of(campaign.drivers, [](const DriverRecord& driver) {
			return driver.status == DriverStatus::Ready || driver.status == DriverStatus::Injured;
		});
	}

	Ending fallOf(const Campaign& campaign, const CompoundRules& rules) {
		if (campaign.stores.food <= rules.starveAtFood) {
			return Ending::Starved;
		}
		return campaign.unrest >= rules.riotAtUnrest ? Ending::Rioted : Ending::Disbanded;
	}

	void endCampaign(Campaign& campaign, const CompoundRules& rules, EndCause cause) {
		assert(!campaign.end && !campaign.run && "endCampaign: a campaign ends once, with its run settled");
		campaign.end = CampaignEnd{.ending = fallOf(campaign, rules), .cause = cause};
		const char* fell = "disbanded";
		if (campaign.end->ending == Ending::Starved) {
			fell = "starved";
		} else if (campaign.end->ending == Ending::Rioted) {
			fell = "rioted";
		}
		addLog(
			campaign,
			std::string(cause == EndCause::LastDriver ? "No drivers are left" : "No people are left") + ", and the compound " + fell + "."
		);
	}

} // namespace rules::campaign
