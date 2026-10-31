#include "Hands.h"

#include <algorithm>
#include <iterator>
#include <string>

namespace rules {

	namespace {

		// "deck:player:0", by side and seat within it, so adding a raider never moves a player's shuffles.
		std::string deckStream(const BattleState& state, DriverIndex driver) {
			const Side side = state.driver(driver).side;
			const auto seat = std::count_if(state.drivers.begin(), state.drivers.begin() + driver.value, [&](const BattleDriver& other) {
				return other.side == side;
			});
			return std::string("deck:") + (side == Side::Player ? "player:" : "raiders:") + std::to_string(seat);
		}

	} // namespace

	void shuffleDeck(BattleState& state, DriverIndex driver, bool fromDiscard, std::vector<Event>& events) {
		foundation::Rng rng = state.random.next(deckStream(state, driver));
		rng.shuffle(state.driver(driver).deck);
		events.emplace_back(event::DeckShuffled{.driver = driver, .fromDiscard = fromDiscard});
	}

	void drawCards(BattleState& state, DriverIndex driver, int count, std::vector<Event>& events) {
		for (int drawn = 0; drawn < count; ++drawn) {
			BattleDriver& drawer = state.driver(driver);
			if (drawer.deck.empty()) {
				if (drawer.discard.empty()) {
					return;
				}
				drawer.deck.insert(drawer.deck.end(), drawer.discard.begin(), drawer.discard.end());
				drawer.discard.clear();
				shuffleDeck(state, driver, true, events);
			}
			BattleDriver& holder = state.driver(driver);
			BattleCard	  card = std::move(holder.deck.back());
			holder.deck.pop_back();
			if (static_cast<int>(holder.hand.size()) < holder.handLimit) {
				events.emplace_back(event::CardDrawn{.driver = driver, .card = card});
				holder.hand.push_back(std::move(card));
			} else {
				events.emplace_back(event::CardBurned{.driver = driver, .card = card});
				holder.discard.push_back(std::move(card));
			}
		}
	}

	void discardHand(BattleState& state, DriverIndex driver, std::vector<Event>& events) {
		BattleDriver& holder = state.driver(driver);
		if (holder.hand.empty()) {
			return;
		}
		events.emplace_back(event::HandDiscarded{.driver = driver, .cards = static_cast<int>(holder.hand.size())});
		std::ranges::move(holder.hand, std::back_inserter(holder.discard));
		holder.hand.clear();
	}

} // namespace rules
