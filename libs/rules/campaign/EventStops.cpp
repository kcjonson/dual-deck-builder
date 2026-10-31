#include "EventStops.h"

#include "Convoy.h"
#include "Recruits.h"
#include "RunDecks.h"
#include "RunProgress.h"

#include <random/Rng.h>

#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <utility>

namespace rules::campaign {

	namespace {

		// The stores a choice costs and an outcome moves, by the resource a blocker names.
		constexpr std::array<std::pair<map::Resource, int Resources::*>, 5> kStores{{
			{map::Resource::Food, &Resources::food},
			{map::Resource::Water, &Resources::water},
			{map::Resource::Fuel, &Resources::fuel},
			{map::Resource::Meds, &Resources::meds},
			{map::Resource::Scrap, &Resources::scrap},
		}};

		// The route of a run at an event stop, with its choice there not taken yet unless `chosen` lets one be.
		const RunRoute& atEvent(const Campaign& campaign, const MapLayers& map, std::string_view action, bool chosen) {
			const RunRoute& route = routeOnRoad(campaign, action);
			if (static_cast<size_t>(route.next) >= route.stops.size() || !resolvesAsEvent(mapStop(map, stopAt(route)).type)) {
				throw std::invalid_argument(std::string(action) + ": the run isn't at an event");
			}
			if (!chosen && (route.handOff || !route.reward.empty())) {
				throw std::invalid_argument(std::string(action) + ": the run has taken its choice at the event");
			}
			return route;
		}

		foundation::Rng eventStream(const Campaign& campaign, const RunRoute& route) {
			return stopStream(campaign, stopAt(route)).fork("event");
		}

		const EventDefinition& eventAt(const Campaign& campaign, const Events& events, const MapLayers& map, const RunRoute& route) {
			const std::vector<const EventDefinition*> offered = eventsFor(events, mapStop(map, stopAt(route)).type);
			if (offered.empty()) {
				throw std::invalid_argument("no loaded event resolves the stop the run is at");
			}
			foundation::Rng pick = eventStream(campaign, route).fork("pick");
			return *offered[static_cast<size_t>(pick.nextInt(0, static_cast<int>(offered.size()) - 1))];
		}

		int outcomeOf(const Campaign& campaign, const RunRoute& route, const EventChoice& choice) {
			int total = 0;
			for (const EventOutcome& outcome : choice.outcomes) {
				total += outcome.weight;
			}
			foundation::Rng draw = eventStream(campaign, route).fork("outcome");
			int				target = draw.nextInt(0, total - 1);
			for (size_t index = 0; index < choice.outcomes.size(); ++index) {
				if (target < choice.outcomes[index].weight) {
					return static_cast<int>(index);
				}
				target -= choice.outcomes[index].weight;
			}
			assert(false && "outcomeOf: the draw lands inside the weights");
			return static_cast<int>(choice.outcomes.size()) - 1;
		}

		// The most escorts any of the choice's outcomes gives, its fight's win counted with it.
		int escortsGiven(const EventChoice& choice) {
			int most = 0;
			for (const EventOutcome& outcome : choice.outcomes) {
				most = std::max(most, (outcome.gains.escort ? 1 : 0) + (outcome.fight && outcome.fight->won.escort ? 1 : 0));
			}
			return most;
		}

		std::optional<ChoiceBlocker> blockerOf(const Campaign& campaign, const EventChoice& choice) {
			const Run&		  run = *campaign.run;
			const EventNeeds& needs = choice.needs;
			if (needs.archetype && std::ranges::none_of(run.seats, [&](const RunDeck& deck) {
					return campaign.driver(deck.driver).archetype == *needs.archetype;
				})) {
				return ChoiceBlocker{.reason = ChoiceRefusal::Archetype};
			}
			if (needs.card && std::ranges::none_of(run.seats, [&](const RunDeck& deck) {
					return countOf(runDeckCards(deck), *needs.card) > 0 ||
						   std::ranges::find(deck.escortCards, *needs.card, &EscortCard::card) != deck.escortCards.end();
				})) {
				return ChoiceBlocker{.reason = ChoiceRefusal::Card};
			}
			if (needs.escort && std::ranges::none_of(run.escorts, [&](const ConvoyId& escort) {
					return campaign.findEscort(escort)->type == *needs.escort;
				})) {
				return ChoiceBlocker{.reason = ChoiceRefusal::Escort};
			}
			if (static_cast<int>(campaign.convoy.size()) + escortsGiven(choice) > kMostEscorts) {
				return ChoiceBlocker{.reason = ChoiceRefusal::ConvoyFull};
			}
			for (const auto& [resource, field] : kStores) {
				const int needed = choice.cost.*field;
				const int held = campaign.stores.*field + run.cargo.*field;
				if (needed > held) {
					return ChoiceBlocker{.reason = ChoiceRefusal::Cost, .resource = resource, .needed = needed, .held = held};
				}
			}
			return std::nullopt;
		}

		// `amounts` out of the cargo first, then the stores, neither below 0 (calls 251 and 259).
		void takeFromCargo(Campaign& campaign, const Resources& amounts) {
			Resources& cargo = campaign.run->cargo;
			for (const auto& [resource, field] : kStores) {
				const int fromCargo = std::min(cargo.*field, amounts.*field);
				cargo.*field -= fromCargo;
				campaign.stores.*field = std::max(0, campaign.stores.*field - (amounts.*field - fromCargo));
			}
		}

		// `value` moved by `by`: a gain up to `most`, a loss down to 1, and neither moving it the other way.
		int shifted(int value, int by, int most) {
			if (by > 0) {
				return std::max(value, std::min(most, value + by));
			}
			if (by < 0) {
				return std::min(value, std::max(1, value + by));
			}
			return value;
		}

		// What an outcome or a won fight gives, but the drivers, which each draw on their own: the cargo and the cards
		// won, the escort joining, and HP and structure on every seat (call 252).
		std::optional<ConvoyId> give(
			Campaign&					   campaign,
			const Content&				   content,
			const Resources&			   gained,
			const CardCounts&			   cards,
			const std::optional<EscortId>& escort,
			int							   structure,
			int							   hp
		) {
			campaign.run->cargo = campaign.run->cargo + gained;
			if (!cards.empty()) {
				addCardsWon(campaign, content, cards);
			}
			std::optional<ConvoyId> joined;
			if (escort) {
				joined = joinConvoy(campaign, content, *escort);
			}
			for (const RunDeck& deck : campaign.run->seats) {
				DriverRecord&			driver = campaign.driver(deck.driver);
				const DriverDefinition& archetype = content.drivers.at(driver.archetype);
				driver.hitpoints = shifted(driver.hitpoints, hp, archetype.maxHitpoints);
				driver.vehicle.structure = shifted(driver.vehicle.structure, structure, archetype.vehicle.maxStructure);
			}
			return joined;
		}

	} // namespace

	const EventDefinition& stopEvent(const Campaign& campaign, const Events& events, const MapLayers& map) {
		return eventAt(campaign, events, map, atEvent(campaign, map, "stopEvent", true));
	}

	int landedOutcome(const Campaign& campaign, const Events& events, const MapLayers& map, std::string_view choice) {
		const RunRoute& route = atEvent(campaign, map, "landedOutcome", true);
		return outcomeOf(campaign, route, choiceOf(eventAt(campaign, events, map, route), choice));
	}

	std::optional<ChoiceBlocker>
	choiceBlocker(const Campaign& campaign, const Events& events, const MapLayers& map, std::string_view choice) {
		const RunRoute& route = atEvent(campaign, map, "choiceBlocker", false);
		return blockerOf(campaign, choiceOf(eventAt(campaign, events, map, route), choice));
	}

	EventTaken takeEventChoice(
		Campaign&					 campaign,
		const Content&				 content,
		const CampaignRules&		 rules,
		const Events&				 events,
		const MapLayers&			 map,
		const std::vector<DriverId>& unlocked,
		std::string_view			 choice
	) {
		const RunRoute&		   at = atEvent(campaign, map, "takeEventChoice", false);
		const EventDefinition& event = eventAt(campaign, events, map, at);
		const EventChoice&	   taken = choiceOf(event, choice);
		if (blockerOf(campaign, taken)) {
			throw std::invalid_argument("takeEventChoice: the party can't take " + taken.id + " at " + event.id.value);
		}
		const int			  landed = outcomeOf(campaign, at, taken);
		const EventOutcome&	  outcome = taken.outcomes[static_cast<size_t>(landed)];
		const foundation::Rng stream = eventStream(campaign, at);
		EventTaken			  result{.event = event.id, .outcome = landed, .escort = {}, .recruits = {}, .reward = {}, .fight = false};

		takeFromCargo(campaign, taken.cost);
		takeFromCargo(campaign, outcome.gains.lost);
		const EventGains& gains = outcome.gains;
		result.escort = give(campaign, content, gains.gained, gains.cards, gains.escort, gains.structure, gains.hp);
		int drawn = 0;
		for (; drawn < gains.drivers; ++drawn) {
			const DriverId recruit = recruitArchetype(campaign, content, unlocked, stream.fork("driver", drawn).nextUInt32());
			takeFoundDriver(campaign, content, recruit);
			result.recruits.push_back(recruit);
		}

		RunRoute& route = *campaign.run->route;
		if (outcome.fight) {
			const EventFight& fight = *outcome.fight;
			EventHandOff	  handOff{
					 .skulls = fight.skulls,
					 .resources = fight.won.gained,
					 .cards = fight.won.cards,
					 .escort = fight.won.escort,
					 .recruits = {},
					 .structure = fight.won.structure,
					 .hp = fight.won.hp,
			 };
			// Drawn now, each counted as riding home for the next, so they're who the win would bring: nothing between the
			// choice and the fight's end changes who the compound has fewest of. They ride home only on a win.
			std::vector<DriverId>& riding = campaign.run->recruits;
			const auto			   before = static_cast<std::ptrdiff_t>(riding.size());
			for (int recruit = 0; recruit < fight.won.drivers; ++recruit, ++drawn) {
				riding.push_back(recruitArchetype(campaign, content, unlocked, stream.fork("driver", drawn).nextUInt32()));
			}
			handOff.recruits.assign(riding.begin() + before, riding.end());
			riding.erase(riding.begin() + before, riding.end());
			route.handOff = std::move(handOff);
			result.fight = true;
		} else if (gains.cardPick) {
			route.reward = rollReward(stopStream(campaign, stopAt(route)), campaign, content, rules);
			result.reward = route.reward;
		} else {
			passStop(route, map);
		}
		return result;
	}

	void giveHandOff(Campaign& campaign, const Content& content, const EventHandOff& handOff) {
		if (!campaign.run) {
			throw std::invalid_argument("giveHandOff: no run is out");
		}
		(void)give(campaign, content, handOff.resources, handOff.cards, handOff.escort, handOff.structure, handOff.hp);
		for (const DriverId& recruit : handOff.recruits) {
			takeFoundDriver(campaign, content, recruit);
		}
	}

} // namespace rules::campaign
