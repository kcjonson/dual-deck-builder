#include "Opponent.h"

#include <cmath>

namespace rules {

	namespace {

		Behavior readBehavior(JsonReader reader) {
			Behavior behavior{
				.policy = reader.optionalString("policy").value_or(""),
				.weights = {},
				.script = reader.optionalString("script").value_or(""),
				.difficulty = reader.optionalString("difficulty").value_or(""),
			};
			if (reader.has("weights")) {
				const nlohmann::json& weights = reader.requireValue("weights");
				if (!weights.is_object()) {
					reader.failAt("weights", "must be an object of numbers");
				}
				for (const auto& [name, weight] : weights.items()) {
					if (!weight.is_number() || !std::isfinite(weight.get<double>())) {
						reader.failAt("weights." + name, "must be a number");
					}
					behavior.weights.emplace(name, weight.get<double>());
				}
			}
			reader.finish();
			if (behavior.policy.empty() == behavior.script.empty()) {
				reader.fail("names a policy or a script, not both or neither");
			}
			if (!behavior.script.empty() && !behavior.weights.empty()) {
				reader.failAt("weights", "are for a policy; a script carries its own");
			}
			return behavior;
		}

	} // namespace

	OpponentDefinition readOpponent(JsonReader reader, OpponentId id) {
		OpponentDefinition opponent{
			.id = std::move(id),
			.pack = {},
			.name = reader.requireString("name"),
			.opponentClass = reader.requireEnum("class", kOpponentClassNames),
			.specialty = reader.requireString("specialty"),
			.flavorText = reader.requireString("flavorText"),
			.targets = reader.optionalEnum("targets", kTargetPreferenceNames).value_or(TargetPreference::None),
			.threat = reader.requireInt("threat"),
			.intentTier = reader.requireEnum("intentTier", kIntentTierNames),
			.skills = readSkills(reader.requireObject("skills")),
			.vehicle = readVehicleStats(reader.requireObject("vehicle")),
			.hitpoints = reader.requireInt("hitpoints"),
			.maxAdrenaline = reader.requireInt("maxAdrenaline"),
			.handLimit = reader.requireInt("handLimit"),
			.deck = readDeckList(reader, "deck"),
			.behavior = readBehavior(reader.requireObject("behavior")),
		};
		reader.finish();
		if (opponent.threat < 0) {
			reader.failAt("threat", "can't be negative");
		}
		if (opponent.hitpoints < 1) {
			reader.failAt("hitpoints", "must be at least 1");
		}
		if (opponent.maxAdrenaline < 0) {
			reader.failAt("maxAdrenaline", "can't be negative");
		}
		if (opponent.handLimit < 1) {
			reader.failAt("handLimit", "must be at least 1");
		}
		return opponent;
	}

} // namespace rules
