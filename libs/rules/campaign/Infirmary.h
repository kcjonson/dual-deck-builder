#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

#include <rules/packs/Pack.h>

#include <optional>
#include <vector>

namespace rules::campaign {

	// Injuries and the infirmary (injuries.md): a driver who comes home hurt is out for days, a night takes one off, and
	// meds buy more.

	// The driver's max HP, their archetype's (call 394). Throws std::invalid_argument for an archetype no loaded pack defines.
	[[nodiscard]] int maxHitpointsOf(const Content& content, const DriverRecord& driver);

	// How long a driver at `hitpoints` is out: the HP missing over the infirmary's HP a day, rounded up (call 128), and 0
	// for none missing.
	[[nodiscard]] int injuryDays(int hitpoints, int maxHitpoints, const CompoundRules& rules);

	// Takes `days` off an injured driver, as a night or a med does, the one place a day comes off; one with none left is
	// ready at full HP (call 112), and HP stays where it was until then (call 131).
	void healDays(DriverRecord& driver, int days, int maxHitpoints);

	struct Injury {
		CrewId driver;
		int	   hitpointsMissing{0};
		int	   days{0};

		bool operator==(const Injury&) const = default;
	};

	// The seats of a run just home: each one below max HP goes into the infirmary for injuryDays, any HP missing
	// included (call 129), the revived too (call 130). unloadRun calls it, before the night home, which is the first day
	// in the infirmary.
	std::vector<Injury>
	injureOnArrival(Campaign& campaign, const Content& content, const CompoundRules& rules, const std::vector<CrewId>& seats);

	// Why the infirmary won't treat a driver for `days`:
	//   CampaignOver  the campaign is over
	//   NotInjured    they aren't in the infirmary
	//   TooManyDays   they have fewer days left (`count`), which isn't clamped (call 133)
	//   TooFewMeds    the stores hold too few meds (`count`, the meds needed)
	enum class TreatmentRefusal { CampaignOver, NotInjured, TooManyDays, TooFewMeds };

	struct TreatmentBlocker {
		TreatmentRefusal reason{TreatmentRefusal::NotInjured};
		int				 count{0};

		bool operator==(const TreatmentBlocker&) const = default;
	};

	// Throws std::invalid_argument for a driver outside the pool, or days under 1.
	[[nodiscard]] std::optional<TreatmentBlocker>
	treatmentBlocker(const Campaign& campaign, const CompoundRules& rules, const CrewId& driver, int days);

	// Spends medsPerDay meds a day to take days off, any time, so a driver can be made fit and seated the same day
	// (call 132). Throws std::invalid_argument for a treatment treatmentBlocker refuses.
	void treatDriver(Campaign& campaign, const Content& content, const CompoundRules& rules, const CrewId& driver, int days);

} // namespace rules::campaign
