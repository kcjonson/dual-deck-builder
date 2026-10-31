#pragma once

#include "Deck.h"
#include "Ids.h"
#include "JsonReader.h"
#include "Vehicle.h"

#include <map>
#include <string>
#include <vector>

namespace rules {

	// An opponent's place in a group (Runs and Encounters, Raider classes). A leader's fall routs the rest.
	enum class OpponentClass { Mook, Regular, Heavy, Leader };

	inline constexpr EnumNames<OpponentClass, 4> kOpponentClassNames{{
		{"mook", OpponentClass::Mook},
		{"regular", OpponentClass::Regular},
		{"heavy", OpponentClass::Heavy},
		{"leader", OpponentClass::Leader},
	}};

	// Who it goes for when a card can reach more than one target: a looter goes for haulers, a killer for
	// driven vehicles.
	enum class TargetPreference { None, Looter, Killer };

	inline constexpr EnumNames<TargetPreference, 2> kTargetPreferenceNames{
		{{"looter", TargetPreference::Looter}, {"killer", TargetPreference::Killer}}
	};

	// How much of its plan the player sees: an elite hides its values and cards.
	enum class IntentTier { Basic, Elite, Boss };

	inline constexpr EnumNames<IntentTier, 3> kIntentTierNames{
		{{"basic", IntentTier::Basic}, {"elite", IntentTier::Elite}, {"boss", IntentTier::Boss}}
	};

	// How an opponent plans: a policy the AI library provides, with its weights, or a script in the
	// opponent's folder. Exactly one is set. The rules read the shape; the AI checks the names.
	struct Behavior {
		std::string					  policy;
		std::map<std::string, double> weights;
		// Relative to the opponent's folder.
		std::string script;

		bool operator==(const Behavior&) const = default;
	};

	struct OpponentDefinition {
		OpponentId id;
		// The pack that defined it, or the last one to override it.
		PackId			 pack;
		std::string		 name;
		OpponentClass	 opponentClass{OpponentClass::Regular};
		std::string		 specialty;
		std::string		 flavorText;
		TargetPreference targets{TargetPreference::None};
		// Nominal threat, which a rout counts.
		int			 threat{0};
		IntentTier	 intentTier{IntentTier::Basic};
		Skills		 skills;
		VehicleStats vehicle;
		int			 hitpoints{0};
		// Adrenaline it refills to every turn, the first included.
		int					   maxAdrenaline{0};
		int					   handLimit{0};
		std::vector<DeckEntry> deck;
		Behavior			   behavior;

		bool operator==(const OpponentDefinition&) const = default;
	};

	// An opponent's opponent.json; its id is its folder's name.
	[[nodiscard]] OpponentDefinition readOpponent(JsonReader reader, OpponentId id);

} // namespace rules
