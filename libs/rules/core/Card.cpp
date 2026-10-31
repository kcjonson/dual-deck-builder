#include "Card.h"

#include <algorithm>

namespace rules {

	namespace {

		std::string readText(JsonReader& reader, std::string_view key) {
			std::string text = reader.requireString(key);
			if (text.find_first_not_of(" \t\r\n") == std::string::npos) {
				reader.failAt(key, "can't be empty");
			}
			return text;
		}

		// Every {name} in `text` has to be one of the card's variables.
		void checkPlaceholders(
			JsonReader&								   reader,
			std::string_view						   key,
			std::string_view						   text,
			const std::map<std::string, CardVariable>& variables
		) {
			for (size_t open = text.find('{'); open != std::string_view::npos; open = text.find('{', open + 1)) {
				const size_t close = text.find('}', open);
				if (close == std::string_view::npos) {
					reader.failAt(key, "has a { with no }");
				}
				const std::string name(text.substr(open + 1, close - open - 1));
				if (!variables.contains(name)) {
					reader.failAt(key, "shows {" + name + "}, which isn't one of the card's variables");
				}
			}
		}

		std::map<std::string, CardVariable> readVariables(JsonReader& reader) {
			std::map<std::string, CardVariable> variables;
			if (!reader.has("variables")) {
				return variables;
			}
			for (auto& [name, object] : reader.requireEntries("variables")) {
				variables.emplace(
					name,
					CardVariable{
						.base = object.requireInt("base"),
						.upgraded = object.optionalInt("upgraded"),
						.scaling = object.optionalEnum("scaling", kScalingNames),
					}
				);
				object.finish();
			}
			return variables;
		}

		std::optional<CardUpgrade> readUpgrade(JsonReader& reader) {
			std::optional<JsonReader> object = reader.optionalObject("upgrades");
			if (!object) {
				return std::nullopt;
			}
			CardUpgrade upgrade{
				.cost = object->optionalInt("cost"),
				.effects = object->has("effects") ? std::optional(readEffects(*object, "effects")) : std::nullopt,
				.summary = object->has("summary") ? std::optional(readText(*object, "summary")) : std::nullopt,
				.description = object->has("description") ? std::optional(readText(*object, "description")) : std::nullopt,
				.tags = object->has("tags") ? std::optional(object->requireStrings("tags")) : std::nullopt,
			};
			object->finish();
			if (upgrade == CardUpgrade{}) {
				reader.failAt("upgrades", "changes nothing; leave it out");
			}
			return upgrade;
		}

	} // namespace

	bool CardDefinition::hasTag(std::string_view tag) const {
		return std::ranges::find(tags, tag) != tags.end();
	}

	CardDefinition readCard(JsonReader reader) {
		CardDefinition card{
			.id = CardId{reader.requireString("id")},
			.pack = {},
			.name = readText(reader, "name"),
			.summary = readText(reader, "summary"),
			.description = readText(reader, "description"),
			.rarity = reader.requireEnum("rarity", kRarityNames),
			.cost = reader.requireInt("cost"),
			.target = reader.requireEnum("targetType", kCardTargetNames),
			.effects = readEffects(reader, "effects"),
			.variables = readVariables(reader),
			.upgrade = readUpgrade(reader),
			.tags = reader.requireStrings("tags"),
			.image = reader.requireString("image"),
			.driverRestriction =
				reader.has("driverRestriction") ? std::optional(DriverId{reader.requireString("driverRestriction")}) : std::nullopt,
			.signatureOf = reader.has("signatureOf") ? std::optional(EscortId{reader.requireString("signatureOf")}) : std::nullopt,
			.spendsEscort = reader.optionalBool("spendsEscort"),
		};
		reader.finish();

		if (card.cost < 0) {
			reader.failAt("cost", "can't be negative");
		}
		if (card.effects.empty()) {
			reader.failAt("effects", "can't be empty");
		}
		checkPlaceholders(reader, "summary", card.summary, card.variables);
		checkPlaceholders(reader, "description", card.description, card.variables);
		if (card.upgrade) {
			if (card.upgrade->cost && *card.upgrade->cost < 0) {
				reader.failAt("upgrades", "cost can't be negative");
			}
			checkPlaceholders(reader, "upgrades.summary", card.upgrade->summary.value_or(""), card.variables);
			checkPlaceholders(reader, "upgrades.description", card.upgrade->description.value_or(""), card.variables);
		}

		const bool order = card.hasTag("order");
		if (order && card.hasTag("attack")) {
			reader.fail("is an order, so it can't also be tagged attack");
		}
		if (!order && (card.target == CardTarget::Escort || card.signatureOf || card.spendsEscort)) {
			reader.fail("commands an escort, so it has to be tagged order");
		}
		if (card.signatureOf.has_value() != (card.rarity == Rarity::Signature)) {
			reader.fail("must have signature rarity exactly when it names signatureOf");
		}
		return card;
	}

} // namespace rules
