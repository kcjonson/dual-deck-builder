#include "Escort.h"

namespace rules {

	namespace {

		CrewSkills readCrew(JsonReader reader) {
			const CrewSkills crew{
				.gunnery = reader.requireInt("gunnery"),
				.evade = reader.requireInt("evade"),
				.ramming = reader.requireInt("ramming"),
			};
			reader.finish();
			return crew;
		}

		std::optional<Dividend> readDividend(JsonReader& reader) {
			std::optional<JsonReader> object = reader.optionalObject("dividend");
			if (!object) {
				return std::nullopt;
			}
			const Dividend dividend{.kind = object->requireEnum("kind", kDividendKindNames), .amount = object->requireInt("amount")};
			object->finish();
			if (dividend.amount < 1) {
				reader.failAt("dividend", "amount must be at least 1");
			}
			return dividend;
		}

	} // namespace

	EscortDefinition readEscort(JsonReader reader) {
		EscortDefinition escort{
			.id = EscortId{reader.requireString("id")},
			.pack = {},
			.name = reader.requireString("name"),
			.role = reader.requireEnum("role", kEscortRoleNames),
			.crew = readCrew(reader.requireObject("crew")),
			.armor = reader.requireInt("armor"),
			.structure = reader.requireInt("structure"),
			.speed = reader.requireInt("speed"),
			.preferredSlot = readFormationSlot(reader.requireObject("preferredSlot")),
			.signatureCard = CardId{reader.requireString("signatureCard")},
			.dividend = readDividend(reader),
		};
		reader.finish();
		if (escort.structure < 1) {
			reader.failAt("structure", "must be at least 1");
		}
		if (escort.dividend && escort.role != EscortRole::Hauler) {
			reader.failAt("dividend", "is only for haulers");
		}
		return escort;
	}

} // namespace rules
