#pragma once

#include <rules/core/Card.h>
#include <rules/core/Driver.h>
#include <rules/core/Escort.h>
#include <rules/core/Ids.h>
#include <rules/core/Opponent.h>

#include <filesystem>
#include <map>
#include <span>
#include <string>
#include <vector>

namespace rules {

	// A pack's pack.json. The base game is a pack; so is every expansion and mod.
	struct PackManifest {
		PackId		id;
		std::string name;
		std::string version;
		// Packs that have to load before this one. A pack can only override content from packs it requires.
		std::vector<PackId>	  requiredPacks;
		std::filesystem::path root;
	};

	// Everything the loaded packs define, by id, after every override.
	struct Content {
		// In load order.
		std::vector<PackManifest>			   packs;
		std::map<CardId, CardDefinition>	   cards;
		std::map<DriverId, DriverDefinition>   drivers;
		std::map<EscortId, EscortDefinition>   escorts;
		std::map<OpponentId, OpponentDefinition> opponents;
	};

	// Loads packs in the order given, each a folder holding pack.json and its content folders:
	//
	//   cards/*.json            {"cards": [...]}
	//   drivers/*.json          {"drivers": [...]}
	//   escorts/*.json          {"escorts": [...]}
	//   opponents/<id>/opponent.json, plus anything its behavior names
	//
	// A later pack adds content or overrides it by id, but only content from a pack it requires, directly or
	// through another; two packs overriding the same id without one requiring the other fails, naming both.
	// Once every pack is in, every reference between content has to resolve. Anything wrong throws a
	// ContentError naming the file. Other folders (map, campaign, events) are read by their own loaders.
	[[nodiscard]] Content loadPacks(std::span<const std::filesystem::path> packRoots);

} // namespace rules
