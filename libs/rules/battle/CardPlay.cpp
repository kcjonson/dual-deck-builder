#include "CardPlay.h"

#include "Damage.h"
#include "Hands.h"
#include "Statuses.h"

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
			return std::visit(
				Overloaded{
					[&](const condition::TargetFlanking&) { return movement("target_flanking"); },
					[&](const condition::TargetFlankingInRow&) { return movement("target_flanking_in_row"); },
					[&](const condition::TargetInFormation&) { return movement("target_in_formation"); },
					[&](const condition::TargetAmbusher&) { return movement("target_ambusher"); },
					[&](const condition::CasterSwerved&) { return movement("caster_swerved"); },
					[](const condition::DrivenVehiclesWithin&) -> Gap { return std::nullopt; },
					[](const condition::TargetHasStatus&) -> Gap { return std::nullopt; },
					[](const condition::SelfHasStatus&) -> Gap { return std::nullopt; },
					[](const condition::PartnerAttacked&) -> Gap { return std::nullopt; },
					[](const condition::CasterRow&) -> Gap { return std::nullopt; },
					[](const condition::TargetRow&) -> Gap { return std::nullopt; },
				},
				condition
			);
		}

		// A boost, a slow, or a damage bonus is a number, a slow's below 0; the rest are on or off.
		Gap statusValueGap(const effect::ApplyStatus& apply) {
			const std::string name = nameOf(kStatusNames, apply.status);
			switch (apply.status) {
				case Status::SpeedBoost:
				case Status::EvadeBoost:
				case Status::DamageBonus:
					return apply.value && *apply.value > 0 ? Gap() : Gap(name + " needs a value above 0");
				case Status::SpeedReduction:
					return apply.value && *apply.value < 0 ? Gap() : Gap(name + " needs a value below 0");
				case Status::Vulnerable:
				case Status::Stunned:
				case Status::TripleDamage:
				case Status::DeathMark:
				case Status::BoxedIn:
					return apply.value || apply.bonus ? Gap(name + " takes no value") : Gap();
			}
			return Gap(name + " isn't a status the rules know");
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
					[&](const effect::ApplyStatus& apply) -> Gap {
						if (Gap gap = lands(apply.target, {Target, Self, EnemyAll}, "apply_status")) {
							return gap;
						}
						if (apply.condition) {
							if (Gap gap = conditionGap(*apply.condition)) {
								return gap;
							}
						}
						if (apply.bonus) {
							if (Gap gap = conditionGap(apply.bonus->condition)) {
								return gap;
							}
						}
						return statusValueGap(apply);
					},
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
						if (std::holds_alternative<condition::TargetHasStatus>(conditional.condition) && !takesTarget(cardTarget)) {
							return "target_has_status on a card that takes no target";
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
					[&](const condition::TargetHasStatus& has) {
						assert(recipient && "conditionHolds: target_has_status needs the card's target");
						return hasStatus(state.vehicle(*recipient), has.status);
					},
					[&](const condition::SelfHasStatus& has) { return hasStatus(state.vehicle(play.actor), has.status); },
					// Two driven vehicles have to be there, so once one is wrecked or carries on as an escort it never
					// holds (call 321).
					[&](const condition::DrivenVehiclesWithin& within) {
						assert(recipient && "conditionHolds: driven_vehicles_within needs a vehicle to measure");
						const Side side = state.vehicle(play.actor).side;
						int		   driven = 0;
						for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
							const BattleVehicle& vehicle = state.vehicles[static_cast<size_t>(index)];
							if (vehicle.side != side || vehicle.isEscort() || !vehicleInFight(state, VehicleIndex{index})) {
								continue;
							}
							if (slotRange(vehicle.slot, state.vehicle(*recipient).slot) > within.range) {
								return false;
							}
							++driven;
						}
						return driven >= 2;
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

		// The vehicles an effect on the card's target or every enemy lands on, as they stand before it lands.
		std::vector<VehicleIndex> recipientsOf(const BattleState& state, EffectTarget target, const CardPlay& play) {
			std::vector<VehicleIndex> recipients;
			if (target != EffectTarget::EnemyAll) {
				assert(play.target && "recipientsOf: targetBlocker passes a targeted card only with its target");
				recipients.push_back(*play.target);
				return recipients;
			}
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const VehicleIndex vehicle{index};
				if (state.vehicle(vehicle).side != state.vehicle(play.actor).side && vehicleInFight(state, vehicle)) {
					recipients.push_back(vehicle);
				}
			}
			return recipients;
		}

		// Whether an effect on someone else reaches them: in range, and past the hit check unless it always hits.
		bool reaches(
			BattleState&			  state,
			const CardPlay&			  play,
			VehicleIndex			  recipient,
			std::optional<int>		  reach,
			std::optional<AttackType> check,
			int						  hitModifier,
			std::vector<Event>&		  events
		) {
			const BattleVehicle& attacker = state.vehicle(play.actor);
			const int			 range = slotRange(attacker.slot, state.vehicle(recipient).slot);
			if (reach && range > *reach) {
				events.emplace_back(event::OutOfRange{.attacker = play.actor, .defender = recipient, .range = range, .reach = *reach});
				return false;
			}
			if (!check) {
				return true;
			}
			const Skills&	 casterSkills = state.driver(play.caster).skills;
			const CrewSkills attack = attacker.crew.value_or(
				CrewSkills{.gunnery = casterSkills.gunnery, .evade = casterSkills.evade, .ramming = casterSkills.ramming}
			);
			const bool ram = *check == AttackType::Ramming;
			const int  skill = ram ? attack.ramming : attack.gunnery;
			const int  evade = evadeOf(state, recipient) + hitModifier;
			const bool hit = ram ? skill >= evade : skill > evade;
			events.emplace_back(
				event::HitChecked{
					.attacker = play.actor, .defender = recipient, .attackType = *check, .skill = skill, .evade = evade, .hit = hit
				}
			);
			return hit;
		}

		// An attack's damage once its modifiers are in, in order, each rounding down: the attacker's damage_bonus, its
		// triple_damage, flanking, then the target's Vulnerable.
		int modifiedDamage(const BattleState& state, VehicleIndex attackerIndex, VehicleIndex recipient, int damage) {
			const BattleVehicle& attacker = state.vehicle(attackerIndex);
			damage += damage * statusTotal(attacker, Status::DamageBonus) / 100;
			if (hasStatus(attacker, Status::TripleDamage)) {
				damage *= 3;
			}
			if (isFlanking(attacker)) {
				damage = damage * 3 / 2;
			}
			if (hasStatus(state.vehicle(recipient), Status::Vulnerable)) {
				damage = damage * 3 / 2;
			}
			return damage;
		}

		void resolveDamage(BattleState& state, const effect::Damage& damage, Resolution& resolution) {
			const CardPlay&		play = resolution.play;
			std::vector<Event>& events = resolution.events;
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

			for (const VehicleIndex recipient : recipientsOf(state, damage.target, play)) {
				if (!vehicleInFight(state, play.actor) || !vehicleInFight(state, recipient)) {
					continue;
				}
				if (damage.condition && !conditionHolds(state, *damage.condition, play, recipient)) {
					continue;
				}
				const std::optional<AttackType> check = damage.alwaysHits ? std::nullopt : std::optional(damage.attackType);
				if (!reaches(state, play, recipient, damage.range, check, damage.hitModifier, events)) {
					continue;
				}
				resolution.landed = true;

				const BattleVehicle& attacker = state.vehicle(play.actor);
				int					 value = damage.value + bonusOf(state, damage.bonus, play, recipient);
				if (damage.formula) {
					const int fromArmor = damage.formula->armorPer > 0 ? attacker.armor / damage.formula->armorPer : 0;
					value += fromArmor + damage.formula->speedDiff * (speedOf(state, play.actor) - speedOf(state, recipient));
				}
				value = modifiedDamage(state, play.actor, recipient, std::max(0, value));

				if (damage.target == EffectTarget::Driver) {
					if (const std::optional<DriverIndex> person = personToHit(state.vehicle(recipient))) {
						damageDriver(state, *person, value, events);
					}
				} else {
					damageVehicle(state, recipient, value, damage.structureOnly, events);
				}
			}
		}

		void resolveStatus(BattleState& state, const effect::ApplyStatus& apply, Resolution& resolution) {
			const CardPlay&					play = resolution.play;
			const bool						onCaster = apply.target == EffectTarget::Self;
			const std::vector<VehicleIndex> recipients = onCaster ? std::vector{play.actor} : recipientsOf(state, apply.target, play);
			for (const VehicleIndex recipient : recipients) {
				if (!vehicleInFight(state, play.actor) || !vehicleInFight(state, recipient)) {
					continue;
				}
				if (apply.condition && !conditionHolds(state, *apply.condition, play, recipient)) {
					continue;
				}
				const std::optional<AttackType> check = apply.alwaysHits ? std::nullopt : std::optional(AttackType::Ranged);
				if (!onCaster && !reaches(state, play, recipient, apply.range, check, 0, resolution.events)) {
					continue;
				}
				const VehicleStatus status{
					.status = apply.status,
					.value = apply.value.value_or(0) + bonusOf(state, apply.bonus, play, recipient),
					.turns = apply.duration,
				};
				applyStatus(state, recipient, status, resolution.events);
				resolution.landed = resolution.landed || !onCaster;
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
					[&](const effect::ApplyStatus& apply) { resolveStatus(state, apply, resolution); },
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
			const auto checkReach = [&](std::optional<int> reach) {
				if (!blocker && reach && range > *reach) {
					blocker = "the target is out of range (" + std::to_string(range) + " away, " + card.name + " reaches " +
							  std::to_string(*reach) + ")";
				}
			};
			forEachEffect(effects, [&](const Effect& effect) {
				if (const auto* damage = std::get_if<effect::Damage>(&effect.kind)) {
					if (damage->target == EffectTarget::Target || damage->target == EffectTarget::Driver) {
						checkReach(damage->range);
					}
					if (!blocker && damage->target == EffectTarget::Driver && !personToHit(target)) {
						blocker = "the target has nobody aboard to hit";
					}
				} else if (const auto* apply = std::get_if<effect::ApplyStatus>(&effect.kind)) {
					if (apply->target == EffectTarget::Target) {
						checkReach(apply->range);
					}
				}
			});
			if (blocker) {
				return blocker;
			}
		}

		// The rules only say what a stun does to a raider: it skips its part of the enemy turn.
		bool stunsThePlayer = false;
		forEachEffect(effects, [&](const Effect& effect) {
			const auto* apply = std::get_if<effect::ApplyStatus>(&effect.kind);
			if (!apply || apply->status != Status::Stunned) {
				return;
			}
			const Side landsOn = apply->target == EffectTarget::Self	   ? actor.side
								 : apply->target == EffectTarget::EnemyAll ? (actor.side == Side::Player ? Side::Raiders : Side::Player)
																		   : state.vehicle(*play.target).side;
			stunsThePlayer = stunsThePlayer || landsOn == Side::Player;
		});
		if (stunsThePlayer) {
			return "stunning the player's vehicles isn't implemented yet";
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
