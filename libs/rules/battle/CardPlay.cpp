#include "CardPlay.h"

#include "Damage.h"
#include "Hands.h"

#include <algorithm>
#include <cassert>
#include <functional>
#include <initializer_list>
#include <stdexcept>

namespace rules {

	namespace {

		using Gap = std::optional<std::string>;

		template <typename... Visitors>
		struct Overloaded : Visitors... {
			using Visitors::operator()...;
		};

		template <typename Enum, std::size_t Count>
		std::string nameOf(const EnumNames<Enum, Count>& names, Enum value) {
			for (const auto& [name, candidate] : names) {
				if (candidate == value) {
					return std::string(name);
				}
			}
			return "?";
		}

		// Every effect, a conditional's own included.
		void forEachEffect(const std::vector<Effect>& effects, const std::function<void(const Effect&)>& visit) {
			for (const Effect& effect : effects) {
				visit(effect);
				if (const auto* conditional = std::get_if<effect::Conditional>(&effect.kind)) {
					forEachEffect(conditional->effects, visit);
				}
			}
		}

		// Listed in full, so a condition the data learns has to be sorted here before it compiles.
		Gap conditionGap(const Condition& condition) {
			const auto movement = [](std::string_view name) -> Gap {
				return std::string(name) + " needs movement, which isn't implemented yet";
			};
			const auto statuses = [](std::string_view name) -> Gap {
				return std::string(name) + " needs statuses, which aren't implemented yet";
			};
			return std::visit(
				Overloaded{
					[&](const condition::TargetFlanking&) { return movement("target_flanking"); },
					[&](const condition::TargetFlankingInRow&) { return movement("target_flanking_in_row"); },
					[&](const condition::TargetInFormation&) { return movement("target_in_formation"); },
					[&](const condition::TargetAmbusher&) { return movement("target_ambusher"); },
					[&](const condition::CasterSwerved&) { return movement("caster_swerved"); },
					[](const condition::DrivenVehiclesWithin&) -> Gap { return "driven_vehicles_within isn't implemented yet"; },
					[&](const condition::TargetHasStatus&) { return statuses("target_has_status"); },
					[&](const condition::SelfHasStatus&) { return statuses("self_has_status"); },
					[](const condition::PartnerAttacked&) -> Gap { return std::nullopt; },
					[](const condition::CasterRow&) -> Gap { return std::nullopt; },
					[](const condition::TargetRow&) -> Gap { return std::nullopt; },
				},
				condition
			);
		}

		Gap effectGap(const Effect& effect, CardTarget cardTarget) {
			const auto lands = [&](EffectTarget target, std::initializer_list<EffectTarget> allowed, std::string_view type) -> Gap {
				if (std::ranges::find(allowed, target) == allowed.end()) {
					return std::string(type) + " on " + nameOf(kEffectTargetNames, target) + " isn't implemented yet";
				}
				if ((target == EffectTarget::Target || target == EffectTarget::Driver) && !takesTarget(cardTarget)) {
					return std::string(type) + " lands on the card's target, but the card takes none";
				}
				return std::nullopt;
			};
			using enum EffectTarget;
			return std::visit(
				Overloaded{
					[&](const effect::Damage& damage) -> Gap {
						if (Gap gap = lands(damage.target, {Target, Driver, Self, SelfDriver, EnemyAll}, "damage")) {
							return gap;
						}
						if (damage.condition) {
							if (Gap gap = conditionGap(*damage.condition)) {
								return gap;
							}
						}
						if (damage.bonus) {
							if (Gap gap = conditionGap(damage.bonus->condition)) {
								return gap;
							}
						}
						if (damage.formula && (damage.target == Self || damage.target == SelfDriver)) {
							return "a ram formula on the caster isn't implemented yet";
						}
						return std::nullopt;
					},
					[](const effect::ApplyStatus&) -> Gap { return "statuses aren't implemented yet"; },
					[](const effect::ChangePosition&) -> Gap { return "movement isn't implemented yet"; },
					[&](const effect::DrawCards& draw) { return lands(draw.target, {Self}, "draw_cards"); },
					[&](const effect::GainShield& gain) { return lands(gain.target, {Self, Target}, "gain_shield"); },
					[&](const effect::GainArmor& gain) { return lands(gain.target, {Self, Target}, "gain_armor"); },
					[&](const effect::GainResource& gain) { return lands(gain.target, {Self}, "gain_resource"); },
					[&](const effect::GrantAdrenaline& grant) {
						return lands(grant.target, {Target, SameVehicle, SelfDriver}, "grant_adrenaline");
					},
					[&](const effect::Heal& heal) { return lands(heal.target, {Self, Target}, "heal"); },
					[&](const effect::HealDriver& heal) { return lands(heal.target, {Target, SameVehicle, SelfDriver}, "heal_driver"); },
					[](const effect::DrawFire&) -> Gap { return "draw_fire isn't implemented yet"; },
					[&](const effect::Conditional& conditional) -> Gap {
						if (Gap gap = conditionGap(conditional.condition)) {
							return gap;
						}
						for (const Effect& inner : conditional.effects) {
							if (Gap gap = effectGap(inner, cardTarget)) {
								return gap;
							}
						}
						return std::nullopt;
					},
				},
				effect.kind
			);
		}

		// Where an effect for one person aboard looks for them: the caster's vehicle or the card's target.
		std::optional<EffectTarget> occupantTargetOf(const Effect& effect) {
			EffectTarget target = EffectTarget::Self;
			if (const auto* heal = std::get_if<effect::HealDriver>(&effect.kind)) {
				target = heal->target;
			} else if (const auto* grant = std::get_if<effect::GrantAdrenaline>(&effect.kind)) {
				target = grant->target;
			}
			if (target == EffectTarget::Target || target == EffectTarget::SameVehicle) {
				return target;
			}
			return std::nullopt;
		}

		// Who a driver-only hit lands on: the driver, or the passenger riding in an escort.
		std::optional<DriverIndex> personToHit(const BattleVehicle& vehicle) {
			if (vehicle.driver) {
				return vehicle.driver;
			}
			return vehicle.isEscort() ? vehicle.passenger : std::nullopt;
		}

		int rowIndex(Row row) {
			return static_cast<int>(row);
		}

		struct Resolution {
			const CardPlay&		play;
			std::vector<Event>& events;
			// An effect has landed on someone other than the caster, which an on-hit effect needs.
			bool landed{false};
		};

		bool
		conditionHolds(const BattleState& state, const Condition& condition, const CardPlay& play, std::optional<VehicleIndex> recipient) {
			return std::visit(
				Overloaded{
					[&](const condition::PartnerAttacked&) {
						const std::optional<DriverIndex> partner = partnerOf(state, play.caster);
						return partner && state.driver(*partner).attackedThisTurn;
					},
					[&](const condition::CasterRow& casterRow) { return state.vehicle(play.actor).slot.row == casterRow.row; },
					[&](const condition::TargetRow& targetRow) {
						assert(recipient && "conditionHolds: target_row needs a vehicle to measure");
						const int apart = rowIndex(state.vehicle(*recipient).slot.row) - rowIndex(state.vehicle(play.actor).slot.row);
						switch (targetRow.relation) {
							case RowRelation::Ahead:
								return apart < 0;
							case RowRelation::Behind:
								return apart > 0;
							case RowRelation::Same:
								return apart == 0;
						}
						return false;
					},
					[](const auto&) -> bool {
						throw std::logic_error("conditionHolds: a condition unimplementedPart refuses reached play");
					},
				},
				condition
			);
		}

		int bonusOf(const BattleState& state, const std::optional<Bonus>& bonus, const CardPlay& play, VehicleIndex recipient) {
			return bonus && conditionHolds(state, bonus->condition, play, recipient) ? bonus->value : 0;
		}

		void resolveEffects(BattleState& state, const std::vector<Effect>& effects, Resolution& resolution);

		void resolveDamage(BattleState& state, const effect::Damage& damage, Resolution& resolution) {
			const CardPlay&		play = resolution.play;
			std::vector<Event>& events = resolution.events;
			assert(!damage.condition && "resolveDamage: unimplementedPart refuses damage with a condition");
			if (damage.onHit && !resolution.landed) {
				return;
			}
			if (damage.target == EffectTarget::SelfDriver) {
				if (driverInFight(state, play.caster)) {
					damageDriver(state, play.caster, damage.value + bonusOf(state, damage.bonus, play, play.actor), events);
				}
				return;
			}
			if (damage.target == EffectTarget::Self) {
				if (vehicleInFight(state, play.actor)) {
					damageVehicle(
						state, play.actor, damage.value + bonusOf(state, damage.bonus, play, play.actor), damage.structureOnly, events
					);
				}
				return;
			}

			std::vector<VehicleIndex> recipients;
			if (damage.target == EffectTarget::EnemyAll) {
				for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
					const VehicleIndex vehicle{index};
					if (state.vehicle(vehicle).side != state.vehicle(play.actor).side && vehicleInFight(state, vehicle)) {
						recipients.push_back(vehicle);
					}
				}
			} else {
				assert(play.target && "resolveDamage: targetBlocker passes a targeted card only with its target");
				recipients.push_back(*play.target);
			}

			for (const VehicleIndex recipient : recipients) {
				if (!vehicleInFight(state, play.actor) || !vehicleInFight(state, recipient)) {
					continue;
				}
				const BattleVehicle& attacker = state.vehicle(play.actor);
				const int			 range = slotRange(attacker.slot, state.vehicle(recipient).slot);
				if (damage.range && range > *damage.range) {
					events.emplace_back(
						event::OutOfRange{.attacker = play.actor, .defender = recipient, .range = range, .reach = *damage.range}
					);
					continue;
				}
				if (!damage.alwaysHits) {
					const Skills&	 casterSkills = state.driver(play.caster).skills;
					const CrewSkills attack = attacker.crew.value_or(
						CrewSkills{.gunnery = casterSkills.gunnery, .evade = casterSkills.evade, .ramming = casterSkills.ramming}
					);
					const bool ram = damage.attackType == AttackType::Ramming;
					const int  skill = ram ? attack.ramming : attack.gunnery;
					const int  evade = defenseOf(state, recipient).evade + damage.hitModifier;
					const bool hit = ram ? skill >= evade : skill > evade;
					events.emplace_back(
						event::HitChecked{
							.attacker = play.actor,
							.defender = recipient,
							.attackType = damage.attackType,
							.skill = skill,
							.evade = evade,
							.hit = hit,
						}
					);
					if (!hit) {
						continue;
					}
				}
				resolution.landed = true;

				int value = damage.value + bonusOf(state, damage.bonus, play, recipient);
				if (damage.formula) {
					const int fromArmor = damage.formula->armorPer > 0 ? attacker.armor / damage.formula->armorPer : 0;
					value += fromArmor + damage.formula->speedDiff * (speedOf(state, play.actor) - speedOf(state, recipient));
				}
				value = std::max(0, value);
				if (isFlanking(attacker)) {
					value = value * 3 / 2;
				}

				if (damage.target == EffectTarget::Driver) {
					if (const std::optional<DriverIndex> person = personToHit(state.vehicle(recipient))) {
						damageDriver(state, *person, value, events);
					}
				} else {
					damageVehicle(state, recipient, value, damage.structureOnly, events);
				}
			}
		}

		// An effect on a vehicle: the caster's own, or the card's target. Nothing lands on one out of the fight.
		template <typename Land>
		void onVehicle(BattleState& state, EffectTarget target, Resolution& resolution, Land&& land) {
			const std::optional<VehicleIndex> recipient = target == EffectTarget::Self ? resolution.play.actor : resolution.play.target;
			assert(recipient && "onVehicle: targetBlocker passes a targeted card only with its target");
			if (!vehicleInFight(state, *recipient)) {
				return;
			}
			land(state.vehicle(*recipient), *recipient);
			resolution.landed = resolution.landed || target == EffectTarget::Target;
		}

		// An effect on one person: the caster, or whoever the play picked aboard.
		template <typename Land>
		void onPerson(BattleState& state, EffectTarget target, Resolution& resolution, Land&& land) {
			const std::optional<DriverIndex> person =
				target == EffectTarget::SelfDriver ? resolution.play.caster : resolution.play.occupant;
			assert(person && "onPerson: targetBlocker passes an occupant card only with its occupant");
			if (!driverInFight(state, *person)) {
				return;
			}
			land(state.driver(*person), *person);
			resolution.landed = resolution.landed || target == EffectTarget::Target;
		}

		void gainAdrenaline(BattleDriver& driver, DriverIndex index, int amount, std::vector<Event>& events) {
			const int gained = std::clamp(driver.maxAdrenaline - driver.adrenaline, 0, amount);
			driver.adrenaline += gained;
			events.emplace_back(event::AdrenalineGained{.driver = index, .adrenaline = gained});
		}

		void resolveEffect(BattleState& state, const Effect& effect, Resolution& resolution) {
			const CardPlay&		play = resolution.play;
			std::vector<Event>& events = resolution.events;
			const auto			unimplemented = [](std::string_view type) {
				 throw std::logic_error("resolveEffect: " + std::string(type) + " reached play past unimplementedPart");
			};
			std::visit(
				Overloaded{
					[&](const effect::Damage& damage) { resolveDamage(state, damage, resolution); },
					[&](const effect::ApplyStatus&) { unimplemented("apply_status"); },
					[&](const effect::ChangePosition&) { unimplemented("change_position"); },
					[&](const effect::DrawFire&) { unimplemented("draw_fire"); },
					[&](const effect::DrawCards& draw) {
						if (driverInFight(state, play.caster)) {
							drawCards(state, play.caster, draw.value, events);
						}
					},
					[&](const effect::GainShield& gain) {
						onVehicle(state, gain.target, resolution, [&](BattleVehicle& vehicle, VehicleIndex index) {
							vehicle.shield += gain.value;
							events.emplace_back(event::ShieldGained{.vehicle = index, .shield = gain.value});
						});
					},
					[&](const effect::GainArmor& gain) {
						onVehicle(state, gain.target, resolution, [&](BattleVehicle& vehicle, VehicleIndex index) {
							vehicle.armor += gain.value;
							events.emplace_back(event::ArmorGained{.vehicle = index, .armor = gain.value});
						});
					},
					[&](const effect::Heal& heal) {
						onVehicle(state, heal.target, resolution, [&](BattleVehicle& vehicle, VehicleIndex index) {
							const int structure = std::min(heal.value, vehicle.maxStructure - vehicle.structure);
							const int armor = heal.overflowToArmor ? heal.value - structure : 0;
							vehicle.structure += structure;
							vehicle.armor += armor;
							events.emplace_back(event::Repaired{.vehicle = index, .structure = structure, .armor = armor});
						});
					},
					[&](const effect::GainResource& gain) {
						assert(gain.resource == Resource::Adrenaline && "resolveEffect: adrenaline is the only resource");
						onPerson(state, EffectTarget::SelfDriver, resolution, [&](BattleDriver& driver, DriverIndex index) {
							gainAdrenaline(driver, index, gain.value, events);
						});
					},
					[&](const effect::GrantAdrenaline& grant) {
						onPerson(state, grant.target, resolution, [&](BattleDriver& driver, DriverIndex index) {
							gainAdrenaline(driver, index, grant.value, events);
						});
					},
					[&](const effect::HealDriver& heal) {
						onPerson(state, heal.target, resolution, [&](BattleDriver& driver, DriverIndex index) {
							const int healed = std::clamp(driver.maxHitpoints - driver.hitpoints, 0, heal.value);
							driver.hitpoints += healed;
							events.emplace_back(event::DriverHealed{.driver = index, .hitpoints = healed});
						});
					},
					[&](const effect::Conditional& conditional) {
						if (conditionHolds(state, conditional.condition, play, play.target)) {
							resolveEffects(state, conditional.effects, resolution);
						}
					},
				},
				effect.kind
			);
		}

		void resolveEffects(BattleState& state, const std::vector<Effect>& effects, Resolution& resolution) {
			for (const Effect& effect : effects) {
				resolveEffect(state, effect, resolution);
			}
		}

	} // namespace

	const CardDefinition& definitionOf(const Content& content, const CardId& card) {
		const auto found = content.cards.find(card);
		if (found == content.cards.end()) {
			throw std::logic_error("the fight holds card " + card.value + ", which no loaded pack defines");
		}
		return found->second;
	}

	int cardCost(const CardDefinition& card, bool upgraded) {
		return upgraded && card.upgrade && card.upgrade->cost ? *card.upgrade->cost : card.cost;
	}

	const std::vector<Effect>& cardEffects(const CardDefinition& card, bool upgraded) {
		return upgraded && card.upgrade && card.upgrade->effects ? *card.upgrade->effects : card.effects;
	}

	bool cardHasTag(const CardDefinition& card, bool upgraded, std::string_view tag) {
		const std::vector<std::string>& tags = upgraded && card.upgrade && card.upgrade->tags ? *card.upgrade->tags : card.tags;
		return std::ranges::find(tags, tag) != tags.end();
	}

	bool takesTarget(CardTarget target) {
		return target == CardTarget::EnemySingle || target == CardTarget::Ally;
	}

	bool picksOccupant(const std::vector<Effect>& effects) {
		bool picks = false;
		forEachEffect(effects, [&](const Effect& effect) { picks = picks || occupantTargetOf(effect).has_value(); });
		return picks;
	}

	std::optional<std::string> unimplementedPart(const CardDefinition& card, bool upgraded) {
		if (cardHasTag(card, upgraded, "order")) {
			return "orders need escorts, which fights don't seat yet";
		}
		if (card.target == CardTarget::BothDrivers || card.target == CardTarget::Any || card.target == CardTarget::Escort) {
			return "the " + nameOf(kCardTargetNames, card.target) + " target type isn't implemented yet";
		}
		const std::vector<Effect>& effects = cardEffects(card, upgraded);
		for (const Effect& effect : effects) {
			if (Gap gap = effectGap(effect, card.target)) {
				return gap;
			}
		}
		bool onCaster = false;
		bool onTarget = false;
		forEachEffect(effects, [&](const Effect& effect) {
			const std::optional<EffectTarget> occupant = occupantTargetOf(effect);
			onCaster = onCaster || occupant == EffectTarget::SameVehicle;
			onTarget = onTarget || occupant == EffectTarget::Target;
		});
		if (onCaster && onTarget && card.target != CardTarget::Ally) {
			return "landing on people aboard two vehicles isn't implemented yet";
		}
		return std::nullopt;
	}

	std::optional<std::string> targetBlocker(const BattleState& state, const CardDefinition& card, bool upgraded, const CardPlay& play) {
		const std::vector<Effect>& effects = cardEffects(card, upgraded);
		const BattleVehicle&	   actor = state.vehicle(play.actor);
		bool					   ownVehicleOnly = false;
		forEachEffect(effects, [&](const Effect& effect) {
			ownVehicleOnly = ownVehicleOnly || occupantTargetOf(effect) == EffectTarget::SameVehicle;
		});

		if (!takesTarget(card.target)) {
			if (play.target) {
				return card.name + " takes no target";
			}
		} else {
			if (!play.target) {
				return card.name + " needs a target";
			}
			if (play.target->value < 0 || play.target->value >= static_cast<int>(state.vehicles.size())) {
				return "there's no vehicle " + std::to_string(play.target->value);
			}
			if (!vehicleInFight(state, *play.target)) {
				return "the target is out of the fight";
			}
			const BattleVehicle& target = state.vehicle(*play.target);
			if (card.target == CardTarget::EnemySingle && target.side == actor.side) {
				return card.name + " targets an enemy";
			}
			if (card.target == CardTarget::Ally && target.side != actor.side) {
				return card.name + " targets a vehicle on your side";
			}
			if (ownVehicleOnly && *play.target != play.actor) {
				return card.name + " only targets the vehicle you're in";
			}
			const int  range = slotRange(actor.slot, target.slot);
			Gap		   blocker;
			const auto checkReach = [&](const Effect& effect) {
				const auto* damage = std::get_if<effect::Damage>(&effect.kind);
				if (blocker || !damage || (damage->target != EffectTarget::Target && damage->target != EffectTarget::Driver)) {
					return;
				}
				if (damage->range && range > *damage->range) {
					blocker = "the target is out of range (" + std::to_string(range) + " away, " + card.name + " reaches " +
							  std::to_string(*damage->range) + ")";
				} else if (damage->target == EffectTarget::Driver && !personToHit(target)) {
					blocker = "the target has nobody aboard to hit";
				}
			};
			forEachEffect(effects, checkReach);
			if (blocker) {
				return blocker;
			}
		}

		if (!picksOccupant(effects)) {
			if (play.occupant) {
				return card.name + " doesn't land on one person";
			}
			return std::nullopt;
		}
		if (!play.occupant) {
			return card.name + " needs who aboard it lands on";
		}
		const BattleVehicle& aboard = state.vehicle(ownVehicleOnly ? play.actor : *play.target);
		if (aboard.driver != play.occupant && aboard.passenger != play.occupant) {
			return "they aren't aboard that vehicle";
		}
		return std::nullopt;
	}

	void resolveCard(BattleState& state, const std::vector<Effect>& effects, const CardPlay& play, std::vector<Event>& events) {
		Resolution resolution{.play = play, .events = events};
		resolveEffects(state, effects, resolution);
	}

} // namespace rules
