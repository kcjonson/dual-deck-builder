#include "Locker.h"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		// One end of a move as the rules read it: the locker, or a driver's default deck or run deck.
		struct End {
			const DriverRecord* driver{nullptr};
			const RunDeck*		runDeck{nullptr};

			[[nodiscard]] bool isLocker() const { return driver == nullptr; }
		};

		End endOf(const Campaign& campaign, const CardPlace& place) {
			if (const auto* deck = std::get_if<DefaultDeck>(&place)) {
				return End{.driver = &campaign.driver(deck->driver), .runDeck = nullptr};
			}
			if (const auto* deck = std::get_if<RunDeckOf>(&place)) {
				const RunDeck* runDeck = campaign.runDeckOf(deck->driver);
				if (runDeck == nullptr) {
					throw std::invalid_argument(deck->driver.value + " has no run deck: no run is out, or they aren't seated on it");
				}
				return End{.driver = &campaign.driver(deck->driver), .runDeck = runDeck};
			}
			return End{};
		}

		int deckSize(const End& end) {
			return end.runDeck != nullptr ? totalCards(runDeckCards(*end.runDeck)) : totalCards(end.driver->defaultDeck);
		}

		bool isAway(const DriverRecord& driver) {
			return driver.status == DriverStatus::Dead || driver.status == DriverStatus::Missing;
		}

		bool isSeated(const Campaign& campaign, const CrewId& driver) {
			return campaign.runDeckOf(driver) != nullptr;
		}

		// The other seat's run deck, beside `seat`'s, or nullptr.
		const RunDeck* otherSeat(const Campaign& campaign, const RunDeck& seat) {
			for (const RunDeck& deck : campaign.run->seats) {
				if (deck.driver != seat.driver) {
					return &deck;
				}
			}
			return nullptr;
		}

		std::optional<CardBlocker> shortBlocker(const Campaign& campaign, const CardMove& move, const End& from, const End& to) {
			if (from.isLocker() && to.runDeck != nullptr) {
				const int available = countOf(to.runDeck->leftHome, move.card) + countOf(campaign.locker, move.card);
				if (available >= move.count) {
					return std::nullopt;
				}
				const RunDeck* other = otherSeat(campaign, *to.runDeck);
				if (other != nullptr && available + countOf(other->borrowed, move.card) >= move.count) {
					return CardBlocker{.reason = CardRefusal::AlreadyBorrowed, .count = available, .driver = other->driver};
				}
				return CardBlocker{.reason = CardRefusal::TooFew, .count = available};
			}
			if (from.runDeck != nullptr) {
				const int held = countOf(runDeckCards(*from.runDeck), move.card);
				if (held >= move.count) {
					return std::nullopt;
				}
				const auto escortCard = std::ranges::find(from.runDeck->escortCards, move.card, &EscortCard::card);
				if (escortCard != from.runDeck->escortCards.end()) {
					return CardBlocker{.reason = CardRefusal::CardLocked, .count = held, .escort = escortCard->broughtBy};
				}
				return CardBlocker{.reason = CardRefusal::TooFew, .count = held};
			}
			const int held = countOf(from.isLocker() ? campaign.locker : from.driver->defaultDeck, move.card);
			if (held < move.count) {
				return CardBlocker{.reason = CardRefusal::TooFew, .count = held};
			}
			return std::nullopt;
		}

		std::string describe(const CardBlocker& blocker) {
			switch (blocker.reason) {
				case CardRefusal::CampaignOver:
					return "the campaign is over";
				case CardRefusal::DriverAway:
					return blocker.driver->value + " is dead or missing";
				case CardRefusal::OnRun:
					return blocker.driver->value + "'s default deck is out on the run";
				case CardRefusal::TooFew:
					return "there are only " + std::to_string(blocker.count) + " to take";
				case CardRefusal::AlreadyBorrowed:
					return blocker.driver->value + " borrowed the rest";
				case CardRefusal::CardLocked:
					return "it's the card " + blocker.escort->value + " brought, which stays in the run deck";
				case CardRefusal::OtherArchetype:
					return "the card is " + blocker.archetype->value + "'s";
				case CardRefusal::DeckFull:
					return "a deck holds at most " + std::to_string(blocker.count);
				case CardRefusal::DeckAtMinimum:
					return "a deck holds at least " + std::to_string(blocker.count);
			}
			return "";
		}

		DriverRecord& driverAt(Campaign& campaign, const CardPlace& place) {
			if (const auto* deck = std::get_if<DefaultDeck>(&place)) {
				return campaign.driver(deck->driver);
			}
			return campaign.driver(std::get<RunDeckOf>(place).driver);
		}

	} // namespace

	std::optional<CardBlocker>
	cardMoveBlocker(const Campaign& campaign, const Content& content, const DeckRules& rules, const CardMove& move) {
		if (move.count < 1) {
			throw std::invalid_argument("cardMoveBlocker: a move takes 1 or more copies");
		}
		if (move.from == move.to) {
			throw std::invalid_argument("cardMoveBlocker: a place can't move cards to itself");
		}
		const End from = endOf(campaign, move.from);
		const End to = endOf(campaign, move.to);
		if ((from.runDeck != nullptr && !to.isLocker()) || (to.runDeck != nullptr && !from.isLocker())) {
			throw std::invalid_argument("cardMoveBlocker: a run deck trades with the locker only (call 137)");
		}

		if (campaign.end) {
			return CardBlocker{.reason = CardRefusal::CampaignOver};
		}
		for (const End* end : {&from, &to}) {
			if (!end->isLocker() && isAway(*end->driver)) {
				return CardBlocker{.reason = CardRefusal::DriverAway, .driver = end->driver->id};
			}
		}
		for (const End* end : {&from, &to}) {
			if (!end->isLocker() && end->runDeck == nullptr && isSeated(campaign, end->driver->id)) {
				return CardBlocker{.reason = CardRefusal::OnRun, .driver = end->driver->id};
			}
		}
		if (std::optional<CardBlocker> blocker = shortBlocker(campaign, move, from, to)) {
			return blocker;
		}
		if (!to.isLocker()) {
			const std::optional<DriverId>& marked = content.cards.at(move.card).driverRestriction;
			if (marked && *marked != to.driver->archetype) {
				return CardBlocker{.reason = CardRefusal::OtherArchetype, .archetype = marked};
			}
			if (deckSize(to) + move.count > rules.mostCards) {
				return CardBlocker{.reason = CardRefusal::DeckFull, .count = rules.mostCards};
			}
		}
		if (!from.isLocker() && deckSize(from) - move.count < rules.fewestCards) {
			return CardBlocker{.reason = CardRefusal::DeckAtMinimum, .count = rules.fewestCards};
		}
		return std::nullopt;
	}

	void moveCards(Campaign& campaign, const Content& content, const DeckRules& rules, const CardMove& move) {
		if (const std::optional<CardBlocker> blocker = cardMoveBlocker(campaign, content, rules, move)) {
			throw std::invalid_argument("moveCards: the rules refuse moving " + move.card.value + ": " + describe(*blocker));
		}
		const CardId& card = move.card;
		if (std::holds_alternative<RunDeckOf>(move.to)) {
			RunDeck&  deck = *campaign.runDeckOf(std::get<RunDeckOf>(move.to).driver);
			const int fromHome = std::min(move.count, countOf(deck.leftHome, card));
			takeCards(deck.leftHome, card, fromHome);
			addCards(deck.own, card, fromHome);
			takeCards(campaign.locker, card, move.count - fromHome);
			addCards(deck.borrowed, card, move.count - fromHome);
			return;
		}
		if (std::holds_alternative<RunDeckOf>(move.from)) {
			RunDeck&  deck = *campaign.runDeckOf(std::get<RunDeckOf>(move.from).driver);
			const int returned = std::min(move.count, countOf(deck.borrowed, card));
			takeCards(deck.borrowed, card, returned);
			addCards(campaign.locker, card, returned);
			takeCards(deck.own, card, move.count - returned);
			addCards(deck.leftHome, card, move.count - returned);
			return;
		}
		takeCards(
			std::holds_alternative<Locker>(move.from) ? campaign.locker : driverAt(campaign, move.from).defaultDeck, card, move.count
		);
		addCards(std::holds_alternative<Locker>(move.to) ? campaign.locker : driverAt(campaign, move.to).defaultDeck, card, move.count);
	}

	std::optional<CardBlocker> scrapBlocker(const Campaign& campaign, const CardId& card, int count) {
		if (count < 1) {
			throw std::invalid_argument("scrapBlocker: scrapping takes 1 or more copies");
		}
		if (campaign.end) {
			return CardBlocker{.reason = CardRefusal::CampaignOver};
		}
		const int held = countOf(campaign.locker, card);
		if (held < count) {
			return CardBlocker{.reason = CardRefusal::TooFew, .count = held};
		}
		return std::nullopt;
	}

	void scrapCards(Campaign& campaign, const DeckRules& rules, const CardId& card, int count) {
		if (const std::optional<CardBlocker> blocker = scrapBlocker(campaign, card, count)) {
			throw std::invalid_argument("scrapCards: the locker can't scrap " + std::to_string(count) + " " + card.value);
		}
		takeCards(campaign.locker, card, count);
		campaign.stores.scrap += count * rules.scrapPerCard;
	}

	CardCounts cardsOwned(const Campaign& campaign) {
		CardCounts owned = campaign.locker;
		for (const DriverRecord& driver : campaign.drivers) {
			addCards(owned, driver.defaultDeck);
		}
		if (campaign.run) {
			for (const RunDeck& deck : campaign.run->seats) {
				addCards(owned, deck.own);
				addCards(owned, deck.leftHome);
				addCards(owned, deck.borrowed);
			}
		}
		return owned;
	}

} // namespace rules::campaign
