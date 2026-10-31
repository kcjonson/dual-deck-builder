#include "Recruits.h"

#include <random/Rng.h>

#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		const DriverDefinition& archetypeNamed(const Content& content, const DriverId& archetype, std::string_view action) {
			const auto found = content.drivers.find(archetype);
			if (found == content.drivers.end()) {
				throw std::invalid_argument(std::string(action) + ": no loaded pack defines driver " + archetype.value);
			}
			return found->second;
		}

		// "THE ROAD WARRIOR" as a title: "Road Warrior".
		std::string titleOf(std::string_view name) {
			constexpr std::string_view kThe = "THE ";
			if (name.size() > kThe.size() && std::ranges::equal(name.substr(0, kThe.size()), kThe, [](char left, char right) {
					return std::toupper(static_cast<unsigned char>(left)) == right;
				})) {
				name.remove_prefix(kThe.size());
			}
			std::string title;
			bool		wordStart = true;
			for (const char letter : name) {
				const auto byte = static_cast<unsigned char>(letter);
				title += static_cast<char>(wordStart ? std::toupper(byte) : std::tolower(byte));
				wordStart = letter == ' ';
			}
			return title;
		}

	} // namespace

	std::string driverName(const Campaign& campaign, const Content& content, const CrewId& driver) {
		const DriverRecord& record = campaign.driver(driver);
		int					ordinal = 0;
		for (const DriverRecord& earlier : campaign.drivers) {
			ordinal += earlier.archetype == record.archetype ? 1 : 0;
			if (earlier.id == driver) {
				break;
			}
		}
		return titleOf(archetypeNamed(content, record.archetype, "driverName").name) + " " + std::to_string(ordinal);
	}

	CrewId recruitDriver(Campaign& campaign, const Content& content, const DriverId& archetype) {
		refuseOver(campaign, "recruitDriver");
		const DriverDefinition& definition = archetypeNamed(content, archetype, "recruitDriver");
		CardCounts				deck;
		for (const DeckEntry& entry : definition.startingDeck) {
			addCards(deck, entry.card, entry.count);
		}
		const CrewId id{std::string(kCrewPrefix) + std::to_string(campaign.nextDriverNumber++)};
		campaign.drivers.push_back(
			DriverRecord{
				.id = id,
				.archetype = archetype,
				.status = DriverStatus::Ready,
				.hitpoints = definition.maxHitpoints,
				.injuredDays = 0,
				.vehicle = {.structure = definition.vehicle.maxStructure, .armor = definition.vehicle.armor},
				.defaultDeck = std::move(deck),
			}
		);
		return id;
	}

	DriverId recruitArchetype(const Campaign& campaign, const Content& content, const std::vector<DriverId>& unlocked, uint32_t seed) {
		std::vector<DriverId> archetypes = unlocked;
		std::ranges::sort(archetypes);
		const auto repeats = std::ranges::unique(archetypes);
		archetypes.erase(repeats.begin(), repeats.end());
		if (archetypes.empty()) {
			throw std::invalid_argument("recruitArchetype: no archetype is unlocked to recruit");
		}
		const auto living = [&](const DriverId& archetype) {
			(void)archetypeNamed(content, archetype, "recruitArchetype");
			const auto inPool = std::ranges::count_if(campaign.drivers, [&](const DriverRecord& driver) {
				return driver.archetype == archetype && driver.status != DriverStatus::Dead;
			});
			const auto ridingHome = campaign.run ? std::ranges::count(campaign.run->recruits, archetype) : 0;
			return inPool + ridingHome;
		};
		std::vector<DriverId> fewest;
		auto				  least = living(archetypes.front());
		for (const DriverId& archetype : archetypes) {
			const auto count = living(archetype);
			if (count < least) {
				least = count;
				fewest.clear();
			}
			if (count == least) {
				fewest.push_back(archetype);
			}
		}
		foundation::Rng rng(seed);
		return rng.pick(fewest);
	}

	FoundDriver whoIsFound(const Campaign& campaign, const Content& content, const std::vector<DriverId>& unlocked, uint32_t seed) {
		if (!campaign.run) {
			throw std::invalid_argument("whoIsFound: no run is out to find anyone");
		}
		for (const DriverRecord& driver : campaign.drivers) {
			if (driver.status == DriverStatus::Missing && std::ranges::find(campaign.run->found, driver.id) == campaign.run->found.end()) {
				return driver.id;
			}
		}
		return recruitArchetype(campaign, content, unlocked, seed);
	}

	void takeFoundDriver(Campaign& campaign, const Content& content, const FoundDriver& found) {
		if (!campaign.run) {
			throw std::invalid_argument("takeFoundDriver: no run is out to bring anyone home");
		}
		Run& run = *campaign.run;
		if (const auto* archetype = std::get_if<DriverId>(&found)) {
			(void)archetypeNamed(content, *archetype, "takeFoundDriver");
			run.recruits.push_back(*archetype);
			return;
		}
		const CrewId& driver = std::get<CrewId>(found);
		if (campaign.driver(driver).status != DriverStatus::Missing) {
			throw std::invalid_argument("takeFoundDriver: " + driver.value + " isn't missing, so there's nobody to find");
		}
		if (std::ranges::find(run.found, driver) != run.found.end()) {
			throw std::invalid_argument("takeFoundDriver: " + driver.value + " is found on this run already");
		}
		run.found.push_back(driver);
	}

} // namespace rules::campaign
