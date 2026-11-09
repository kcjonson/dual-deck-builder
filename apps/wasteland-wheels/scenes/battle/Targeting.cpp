#include "scenes/battle/Targeting.h"

#include <rules/battle/Battle.h>
#include <rules/battle/CardPlay.h>
#include <rules/core/CardText.h>
#include <rules/core/Effect.h>

#include <utils/Log.h>

#include <algorithm>
#include <limits>
#include <variant>

namespace game::battle {

	namespace {

		// What a card with no range of its own counts its slot readouts against (call 301): the longest any card reaches.
		constexpr int kLongestReach = 2;

		const std::vector<size_t> kNoPlays;

		bool sets(const rules::action::PlayCard& play, AimStep step) {
			switch (step) {
				case AimStep::Vehicle:
					return play.target.has_value();
				case AimStep::Slot:
					return play.destination.has_value();
				case AimStep::Occupant:
					return play.occupant.has_value();
			}
			return false;
		}

		AimPick pickOf(const rules::action::PlayCard& play, AimStep step) {
			switch (step) {
				case AimStep::Vehicle:
					return AimPick{.vehicle = play.target};
				case AimStep::Slot:
					return AimPick{.slot = play.destination};
				case AimStep::Occupant:
					return AimPick{.occupant = play.occupant};
			}
			return {};
		}

		// The pick answers its step: the one field it sets is the step's.
		bool answers(const AimPick& pick, AimStep step) {
			const int set = static_cast<int>(pick.vehicle.has_value()) + static_cast<int>(pick.slot.has_value()) +
							static_cast<int>(pick.occupant.has_value());
			switch (step) {
				case AimStep::Vehicle:
					return set == 1 && pick.vehicle;
				case AimStep::Slot:
					return set == 1 && pick.slot;
				case AimStep::Occupant:
					return set == 1 && pick.occupant;
			}
			return false;
		}

		// The card's slot pick moves the caster (Juke, Strafe) rather than its target (Fall In, Shoulder Check): read off
		// the move's own target, which is all the order of the steps needs from the card.
		bool casterPicksSlot(const rules::CardDefinition& definition, bool upgraded) {
			for (const rules::Effect& effect : rules::cardEffects(definition, upgraded)) {
				const auto* move = std::get_if<rules::effect::ChangePosition>(&effect.kind);
				if (move != nullptr && rules::picksSlot(std::vector{effect})) {
					return move->target == rules::EffectTarget::Self;
				}
			}
			return false;
		}

		bool hitsVehicle(const AimPreview& preview, rules::VehicleIndex vehicle) {
			return std::ranges::any_of(preview.hits, [vehicle](const AimHit& hit) { return hit.vehicle == vehicle; });
		}

		// The same vehicles hit and the same moves, whatever the numbers.
		bool sameShape(const AimPreview& one, const AimPreview& other) {
			const auto movedAlike = [](const AimPreview& from, const AimPreview& to) {
				return std::ranges::all_of(from.moves, [&to](const AimMove& move) {
					return std::ranges::find(to.moves, move) != to.moves.end();
				});
			};
			const auto hitAlike = [](const AimPreview& from, const AimPreview& to) {
				return std::ranges::all_of(from.hits, [&to](const AimHit& hit) { return hitsVehicle(to, hit.vehicle); });
			};
			return one.moves.size() == other.moves.size() && one.hits.size() == other.hits.size() && movedAlike(one, other) &&
				   hitAlike(one, other);
		}

	} // namespace

	Targeting::Targeting(const rules::BattleState& state, const rules::Content& content, std::span<const rules::Action> legal)
		: state(state),
		  content(content),
		  legal(legal) {
		for (size_t index = 0; index < legal.size(); ++index) {
			if (const auto* play = std::get_if<rules::action::PlayCard>(&legal[index])) {
				plays[{play->driver.value, play->handIndex}].push_back(index);
			}
		}
	}

	const rules::BattleCard* Targeting::inHand(HandCard card) const {
		if (card.driver.value < 0 || card.driver.value >= static_cast<int>(state.drivers.size())) {
			LOG_ERROR(Game, "Targeting asked about driver %d, who isn't in the fight", card.driver.value);
			return nullptr;
		}
		const std::vector<rules::BattleCard>& hand = state.driver(card.driver).hand;
		if (card.handIndex < 0 || card.handIndex >= static_cast<int>(hand.size())) {
			LOG_ERROR(Game, "Targeting asked about card %d of driver %d's hand of %zu", card.handIndex, card.driver.value, hand.size());
			return nullptr;
		}
		return &hand[static_cast<size_t>(card.handIndex)];
	}

	const std::vector<size_t>& Targeting::playsOf(HandCard card) const {
		const auto found = plays.find({card.driver.value, card.handIndex});
		return found != plays.end() ? found->second : kNoPlays;
	}

	const rules::action::PlayCard& Targeting::playAt(size_t index) const {
		return std::get<rules::action::PlayCard>(legal[index]);
	}

	bool Targeting::playable(HandCard card) const {
		return !playsOf(card).empty();
	}

	bool Targeting::affordable(HandCard card) const {
		const rules::BattleCard* held = inHand(card);
		if (held == nullptr) {
			return false;
		}
		const rules::CardDefinition& definition = rules::definitionOf(content, held->card);
		return state.driver(card.driver).adrenaline >= rules::cardCost(definition, held->upgraded);
	}

	std::optional<std::string> Targeting::blockLabel(HandCard card) const {
		const rules::BattleCard* held = inHand(card);
		if (held == nullptr || playable(card) || state.phase != rules::Phase::PlayerTurn || !affordable(card)) {
			return std::nullopt;
		}
		if (!rules::cardBlocker(state, content, card.driver, card.handIndex)) {
			return "NO TARGET";
		}
		const std::optional<rules::VehicleIndex> aboard = rules::vehicleCarrying(state, card.driver);
		const bool								 passenger = aboard && state.vehicle(*aboard).driver != card.driver;
		if (passenger && rules::cardHasTag(rules::definitionOf(content, held->card), held->upgraded, "attack")) {
			return "NO ATTACKS";
		}
		return "CAN'T PLAY";
	}

	std::vector<AimStep> Targeting::steps(HandCard card) const {
		const std::vector<size_t>& offered = playsOf(card);
		const auto				   anySets = [&](AimStep step) {
			return std::ranges::any_of(offered, [&](size_t index) { return sets(playAt(index), step); });
		};
		std::vector<AimStep> order;
		if (anySets(AimStep::Vehicle)) {
			order.push_back(AimStep::Vehicle);
		}
		if (anySets(AimStep::Slot)) {
			// A caster's own picked move goes first, since the rest of the card reaches from where it lands; a target's
			// can't be asked about until the target is known.
			const rules::BattleCard* held = inHand(card);
			const bool				 casterFirst =
				order.empty() || (held != nullptr && casterPicksSlot(rules::definitionOf(content, held->card), held->upgraded));
			order.insert(casterFirst ? order.begin() : order.end(), AimStep::Slot);
		}
		if (anySets(AimStep::Occupant)) {
			order.push_back(AimStep::Occupant);
		}
		return order;
	}

	Targeting::Walk Targeting::walk(HandCard card, std::span<const AimPick> picked) const {
		Walk   at{.plays = playsOf(card)};
		size_t next = 0;
		for (const AimStep step : steps(card)) {
			if (std::ranges::none_of(at.plays, [&](size_t index) { return sets(playAt(index), step); })) {
				continue;
			}
			if (next == picked.size()) {
				at.open = step;
				return at;
			}
			const AimPick& pick = picked[next++];
			if (!answers(pick, step)) {
				LOG_ERROR(Game, "A pick for card %d of driver %d doesn't answer its step", card.handIndex, card.driver.value);
				at.plays.clear();
				return at;
			}
			std::erase_if(at.plays, [&](size_t index) { return pickOf(playAt(index), step) != pick; });
			if (at.plays.empty()) {
				LOG_ERROR(Game, "A pick for card %d of driver %d isn't one its plays offer", card.handIndex, card.driver.value);
				return at;
			}
		}
		if (next < picked.size()) {
			LOG_ERROR(Game, "Card %d of driver %d got %zu picks past its steps", card.handIndex, card.driver.value, picked.size() - next);
			at.plays.clear();
		}
		return at;
	}

	std::vector<AimPick> Targeting::options(HandCard card, std::span<const AimPick> picked) const {
		const Walk			 at = walk(card, picked);
		std::vector<AimPick> offered;
		if (!at.open) {
			return offered;
		}
		for (const size_t index : at.plays) {
			const rules::action::PlayCard& play = playAt(index);
			if (!sets(play, *at.open)) {
				continue;
			}
			const AimPick pick = pickOf(play, *at.open);
			if (std::ranges::find(offered, pick) == offered.end()) {
				offered.push_back(pick);
			}
		}
		return offered;
	}

	std::optional<size_t> Targeting::action(HandCard card, std::span<const AimPick> picked) const {
		const Walk at = walk(card, picked);
		if (at.open || at.plays.empty()) {
			return std::nullopt;
		}
		if (at.plays.size() > 1) {
			LOG_ERROR(Game, "Complete picks for card %d of driver %d leave %zu plays", card.handIndex, card.driver.value, at.plays.size());
		}
		return at.plays.front();
	}

	AimPreview Targeting::preview(HandCard card, std::span<const AimPick> picked) const {
		const Walk at = walk(card, picked);
		return at.plays.empty() ? AimPreview{} : playPreview(at.plays.front());
	}

	bool Targeting::certain(HandCard card) const {
		const std::pair<int, int> key{card.driver.value, card.handIndex};
		if (const auto found = certainty.find(key); found != certainty.end()) {
			return found->second;
		}
		const std::vector<size_t>& offered = playsOf(card);
		const bool				   same =
			std::ranges::all_of(offered, [&](size_t index) { return sameShape(playPreview(offered.front()), playPreview(index)); });
		certainty.emplace(key, same);
		return same;
	}

	const AimPreview& Targeting::playPreview(size_t index) const {
		if (const auto found = previews.find(index); found != previews.end()) {
			return found->second;
		}
		const rules::action::PlayCard&	play = playAt(index);
		rules::BattleState				copy = state;
		const std::vector<rules::Event> events = rules::apply(copy, content, legal[index]);

		AimPreview preview{.from = rules::vehicleCarrying(state, play.driver)};
		bool	   carried = false;
		const auto on = [&preview](rules::VehicleIndex vehicle) -> AimHit& {
			const auto found = std::ranges::find(preview.hits, vehicle, &AimHit::vehicle);
			if (found != preview.hits.end()) {
				return *found;
			}
			return preview.hits.emplace_back(AimHit{.vehicle = vehicle});
		};
		// Who's aboard what as the play starts, which a hit on someone aboard splits by.
		const auto aboard = [this](rules::DriverIndex driver) -> std::optional<rules::VehicleIndex> {
			const std::optional<rules::VehicleIndex> vehicle = rules::vehicleCarrying(state, driver);
			if (!vehicle) {
				LOG_ERROR(Game, "A play's preview hit driver %d, who rides in nothing", driver.value);
			}
			return vehicle;
		};

		for (const rules::Event& event : events) {
			if (const auto* order = std::get_if<rules::event::OrderCarried>(&event)) {
				if (!carried) {
					preview.from = order->escort;
					carried = true;
				}
			} else if (const auto* check = std::get_if<rules::event::HitChecked>(&event)) {
				AimHit& hit = on(check->defender);
				if (!hit.check) {
					hit.check = *check;
				}
			} else if (const auto* damaged = std::get_if<rules::event::VehicleDamaged>(&event)) {
				AimHit& hit = on(damaged->vehicle);
				hit.shield += damaged->shield;
				hit.armor += damaged->armor;
				hit.structure += damaged->structure;
			} else if (const auto* hurt = std::get_if<rules::event::DriverDamaged>(&event)) {
				if (const std::optional<rules::VehicleIndex> vehicle = aboard(hurt->driver)) {
					AimHit& hit = on(*vehicle);
					(state.vehicle(*vehicle).driver == hurt->driver ? hit.driverHp : hit.passengerHp) += hurt->hitpoints;
				}
			} else if (const auto* wrecked = std::get_if<rules::event::VehicleWrecked>(&event)) {
				on(wrecked->vehicle).outOfFight = true;
			} else if (const auto* unmanned = std::get_if<rules::event::Unmanned>(&event)) {
				on(unmanned->vehicle).outOfFight = true;
			} else if (const auto* status = std::get_if<rules::event::StatusApplied>(&event)) {
				on(status->vehicle);
			} else if (const auto* shield = std::get_if<rules::event::ShieldGained>(&event)) {
				on(shield->vehicle);
			} else if (const auto* armor = std::get_if<rules::event::ArmorGained>(&event)) {
				on(armor->vehicle);
			} else if (const auto* repaired = std::get_if<rules::event::Repaired>(&event)) {
				on(repaired->vehicle);
			} else if (const auto* healed = std::get_if<rules::event::DriverHealed>(&event)) {
				if (const std::optional<rules::VehicleIndex> vehicle = aboard(healed->driver)) {
					on(*vehicle);
				}
			} else if (const auto* cover = std::get_if<rules::event::DrawingFire>(&event)) {
				on(cover->escort);
			} else if (const auto* moved = std::get_if<rules::event::VehicleMoved>(&event)) {
				const auto found = std::ranges::find(preview.moves, moved->vehicle, &AimMove::vehicle);
				if (found != preview.moves.end()) {
					found->to = moved->to;
				} else {
					preview.moves.push_back(AimMove{.vehicle = moved->vehicle, .from = moved->from, .to = moved->to});
				}
			}
		}
		return previews.emplace(index, std::move(preview)).first->second;
	}

	int Targeting::escortRange(HandCard card, std::optional<size_t> aimedAt, rules::RoadSlot at) const {
		const rules::BattleCard&	 held = *inHand(card);
		const rules::CardDefinition& definition = rules::definitionOf(content, held.card);
		if (aimedAt && rules::isAttackOrder(definition, held.upgraded)) {
			const rules::action::PlayCard&			 play = playAt(*aimedAt);
			const std::optional<rules::VehicleIndex> carrier = rules::orderCarrier(
				state,
				definition,
				held.upgraded,
				rules::CardPlay{
					.caster = play.driver,
					.actor = *rules::vehicleCarrying(state, play.driver),
					.target = play.target,
					.occupant = play.occupant,
					.destination = play.destination,
				}
			);
			if (carrier) {
				return rules::slotRange(state.vehicle(*carrier).slot, at);
			}
		}
		int nearest = std::numeric_limits<int>::max();
		for (const rules::VehicleIndex escort : rules::rallyingEscorts(state, state.driver(card.driver).side)) {
			if (!definition.signatureOf || state.vehicle(escort).escort == definition.signatureOf) {
				nearest = std::min(nearest, rules::slotRange(state.vehicle(escort).slot, at));
			}
		}
		return nearest;
	}

	std::vector<RangeChip> Targeting::ranges(HandCard card, std::span<const AimPick> picked) const {
		const Walk				 at = walk(card, picked);
		const rules::BattleCard* held = inHand(card);
		// A slot step shows readouts only for the slot under the pointer: they preview a destination.
		if (held == nullptr || at.plays.empty() || at.open == AimStep::Slot) {
			return {};
		}
		const rules::CardDefinition& definition = rules::definitionOf(content, held->card);
		const std::vector<AimStep>	 order = steps(card);
		const bool					 takesVehicle = std::ranges::find(order, AimStep::Vehicle) != order.end();
		const bool					 takesSlot = std::ranges::find(order, AimStep::Slot) != order.end();
		const rules::Side			 side = state.driver(card.driver).side;
		const rules::VehicleIndex	 actor = *rules::vehicleCarrying(state, card.driver);

		std::optional<rules::RoadSlot>	   slot;
		std::optional<rules::VehicleIndex> vehicle;
		for (const AimPick& pick : picked) {
			slot = pick.slot ? pick.slot : slot;
			vehicle = pick.vehicle ? pick.vehicle : vehicle;
		}
		// Who goes to the picked slot: the caster when its slot comes first, otherwise the picked vehicle.
		const std::optional<rules::VehicleIndex> mover =
			!slot ? std::nullopt : (order.front() == AimStep::Slot ? std::optional(actor) : vehicle);
		const bool moverOurs = mover && state.vehicle(*mover).side == side;

		const AimPreview& first = playPreview(at.plays.front());
		const auto		  onRaider = [&](size_t index) {
			   const std::optional<rules::VehicleIndex> target = playAt(index).target;
			   return target && state.vehicle(*target).side != side;
		};
		const bool landsOnRaiders =
			takesVehicle ? std::ranges::any_of(at.plays, onRaider)
						 : std::ranges::any_of(first.hits, [&](const AimHit& hit) { return state.vehicle(hit.vehicle).side != side; });
		if (!landsOnRaiders && !moverOurs) {
			return {};
		}

		const bool throughEscorts = rules::isAttackOrder(definition, held->upgraded) || rules::isRally(definition, held->upgraded);
		const std::optional<int> range = rules::cardRange(definition, held->upgraded);
		const std::optional<int> reach = range ? range : (takesSlot ? std::optional(kLongestReach) : std::nullopt);

		std::vector<RangeChip> chips;
		for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
			const rules::VehicleIndex raider{index};
			if (state.vehicle(raider).side == side || !rules::vehicleInFight(state, raider)) {
				continue;
			}
			const rules::RoadSlot where = mover == raider ? *slot : state.vehicle(raider).slot;
			std::optional<size_t> aimedAt;
			if (const auto found = std::ranges::find_if(at.plays, [&](size_t play) { return playAt(play).target == raider; });
				found != at.plays.end()) {
				aimedAt = *found;
			}
			int distance = 0;
			if (moverOurs) {
				distance = rules::slotRange(*slot, where);
			} else if (throughEscorts) {
				distance = escortRange(card, aimedAt, where);
			} else {
				const rules::action::PlayCard&		 play = playAt(aimedAt.value_or(at.plays.front()));
				const std::optional<rules::RoadSlot> landing = rules::movesCasterTo(
					state,
					definition,
					held->upgraded,
					rules::CardPlay{
						.caster = play.driver,
						.actor = actor,
						.target = play.target,
						.occupant = play.occupant,
						.destination = play.destination,
					}
				);
				distance = rules::slotRange(landing.value_or(state.vehicle(actor).slot), where);
			}
			chips.push_back(
				RangeChip{
					.vehicle = raider,
					.range = distance,
					.inReach = !reach || distance <= *reach,
					.lands = takesVehicle ? aimedAt.has_value() : hitsVehicle(first, raider),
				}
			);
		}
		return chips;
	}

} // namespace game::battle
