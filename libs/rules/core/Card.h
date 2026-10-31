#pragma once

#include "Effect.h"
#include "Ids.h"
#include "JsonReader.h"

#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace rules {

	// Signature cards come with their escort, never from the reward pool or a shop.
	enum class Rarity { Starter, Common, Uncommon, Rare, Legendary, Signature };

	inline constexpr EnumNames<Rarity, 6> kRarityNames{{
		{"starter", Rarity::Starter},
		{"common", Rarity::Common},
		{"uncommon", Rarity::Uncommon},
		{"rare", Rarity::Rare},
		{"legendary", Rarity::Legendary},
		{"signature", Rarity::Signature},
	}};

	// What a card is played at.
	enum class CardTarget { EnemySingle, EnemyAll, Self, Ally, BothDrivers, Any, Escort };

	inline constexpr EnumNames<CardTarget, 7> kCardTargetNames{{
		{"enemy_single", CardTarget::EnemySingle},
		{"enemy_all", CardTarget::EnemyAll},
		{"self", CardTarget::Self},
		{"ally", CardTarget::Ally},
		{"both_drivers", CardTarget::BothDrivers},
		{"any", CardTarget::Any},
		{"escort", CardTarget::Escort},
	}};

	// A number a card's text shows as {name}, with its upgraded value.
	struct CardVariable {
		int					   base{0};
		std::optional<int>	   upgraded;
		std::optional<Scaling> scaling;

		bool operator==(const CardVariable&) const = default;
	};

	// What upgrading a card replaces. Anything left out stays as it was.
	struct CardUpgrade {
		std::optional<int>						cost;
		std::optional<std::vector<Effect>>		effects;
		std::optional<std::string>				summary;
		std::optional<std::string>				description;
		std::optional<std::vector<std::string>> tags;

		bool operator==(const CardUpgrade&) const = default;
	};

	struct CardDefinition {
		CardId id;
		// The pack that defined it, or the last one to override it.
		PackId		pack;
		std::string name;
		// Card face text: keywords in [brackets], {variables} filled in.
		std::string summary;
		// Full rules text for the detail view.
		std::string							description;
		Rarity								rarity{Rarity::Common};
		int									cost{0};
		CardTarget							target{CardTarget::EnemySingle};
		std::vector<Effect>					effects;
		std::map<std::string, CardVariable> variables;
		std::optional<CardUpgrade>			upgrade;
		std::vector<std::string>			tags;
		// Relative to the pack's root.
		std::string image;
		// The one driver archetype that can take it; none for any driver.
		std::optional<DriverId> driverRestriction;
		// The escort whose signature order card this is.
		std::optional<EscortId> signatureOf;
		// Playing it leaves the escort it commands spent.
		bool spendsEscort{false};

		[[nodiscard]] bool hasTag(std::string_view tag) const;

		bool operator==(const CardDefinition&) const = default;
	};

	// A card, checked on its own: texts, tags against its target and rarity, and every {variable} its texts
	// name. What it refers to in other content is checked once every pack has loaded.
	[[nodiscard]] CardDefinition readCard(JsonReader reader);

} // namespace rules
