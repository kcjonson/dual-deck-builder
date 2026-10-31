#include "Infirmary.h"

#include <algorithm>
#include <cassert>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	int maxHitpointsOf(const Content& content, const DriverRecord& driver) {
		const auto found = content.drivers.find(driver.archetype);
		if (found == content.drivers.end()) {
			throw std::invalid_argument(driver.id.value + " is a " + driver.archetype.value + ", which no loaded pack defines");
		}
		return found->second.maxHitpoints;
	}

	int injuryDays(int hitpoints, int maxHitpoints, const CompoundRules& rules) {
		assert(hitpoints > 0 && "injuryDays: the dead aren't injured");
		const int missing = std::max(0, maxHitpoints - hitpoints);
		return (missing + rules.hitpointsPerDay - 1) / rules.hitpointsPerDay;
	}

	void healDays(DriverRecord& driver, int days, int maxHitpoints) {
		assert(driver.status == DriverStatus::Injured && days >= 1 && days <= driver.injuredDays && "healDays: days an injury has");
		driver.injuredDays -= days;
		if (driver.injuredDays == 0) {
			driver.status = DriverStatus::Ready;
			driver.hitpoints = maxHitpoints;
		}
	}

	std::vector<Injury>
	injureOnArrival(Campaign& campaign, const Content& content, const CompoundRules& rules, const std::vector<CrewId>& seats) {
		std::vector<Injury> injuries;
		for (const CrewId& seat : seats) {
			DriverRecord& driver = campaign.driver(seat);
			assert(driver.status == DriverStatus::Ready && "injureOnArrival: a run home brings its drivers home ready");
			const int most = maxHitpointsOf(content, driver);
			const int days = injuryDays(driver.hitpoints, most, rules);
			if (days == 0) {
				continue;
			}
			driver.status = DriverStatus::Injured;
			driver.injuredDays = days;
			injuries.push_back(Injury{.driver = seat, .hitpointsMissing = most - driver.hitpoints, .days = days});
		}
		return injuries;
	}

	std::optional<TreatmentBlocker> treatmentBlocker(const Campaign& campaign, const CompoundRules& rules, const CrewId& driver, int days) {
		const DriverRecord& record = campaign.driver(driver);
		if (days < 1) {
			throw std::invalid_argument("treatmentBlocker: a treatment takes 1 or more days");
		}
		if (campaign.end) {
			return TreatmentBlocker{.reason = TreatmentRefusal::CampaignOver};
		}
		if (record.status != DriverStatus::Injured) {
			return TreatmentBlocker{.reason = TreatmentRefusal::NotInjured};
		}
		if (days > record.injuredDays) {
			return TreatmentBlocker{.reason = TreatmentRefusal::TooManyDays, .count = record.injuredDays};
		}
		if (campaign.stores.meds < days * rules.medsPerDay) {
			return TreatmentBlocker{.reason = TreatmentRefusal::TooFewMeds, .count = days * rules.medsPerDay};
		}
		return std::nullopt;
	}

	void treatDriver(Campaign& campaign, const Content& content, const CompoundRules& rules, const CrewId& driver, int days) {
		if (treatmentBlocker(campaign, rules, driver, days)) {
			throw std::invalid_argument(
				"treatDriver: the infirmary can't treat " + driver.value + " for " + std::to_string(days) + " days"
			);
		}
		DriverRecord& record = campaign.driver(driver);
		campaign.stores.meds -= days * rules.medsPerDay;
		healDays(record, days, maxHitpointsOf(content, record));
	}

} // namespace rules::campaign
