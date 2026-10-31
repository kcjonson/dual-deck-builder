#pragma once

#include "Ids.h"
#include "JsonReader.h"
#include "Road.h"

#include <optional>
#include <string>

namespace rules {

	// Escorts are undriven vehicles in the player's convoy that act when a driver plays an order card
	// (Combat Rules, Escorts).
	enum class EscortRole { Gun, Hauler };

	inline constexpr EnumNames<EscortRole, 2> kEscortRoleNames{{{"gun", EscortRole::Gun}, {"hauler", EscortRole::Hauler}}};

	enum class DividendKind { Fuel, Scrap, Heal };

	inline constexpr EnumNames<DividendKind, 3> kDividendKindNames{
		{{"fuel", DividendKind::Fuel}, {"scrap", DividendKind::Scrap}, {"heal", DividendKind::Heal}}
	};

	// What a hauler pays after every won fight it survives: fuel or scrap for the run's cargo, or HP for
	// every living driver on the run.
	struct Dividend {
		DividendKind kind{DividendKind::Fuel};
		int			 amount{0};

		bool operator==(const Dividend&) const = default;
	};

	// An escort has no driver, so its crew's skills come with it.
	struct CrewSkills {
		int gunnery{0};
		int evade{0};
		int ramming{0};

		bool operator==(const CrewSkills&) const = default;
	};

	struct EscortDefinition {
		EscortId id;
		// The pack that defined it, or the last one to override it.
		PackId		pack;
		std::string name;
		EscortRole	role{EscortRole::Gun};
		CrewSkills	crew;
		int			armor{0};
		int			structure{0};
		int			speed{0};
		// Where it opens when the encounter doesn't place it.
		FormationSlot preferredSlot;
		// The order card it brings into a driver's deck.
		CardId					signatureCard;
		std::optional<Dividend> dividend;

		bool operator==(const EscortDefinition&) const = default;
	};

	[[nodiscard]] EscortDefinition readEscort(JsonReader reader);

} // namespace rules
