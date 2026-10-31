#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

#include <rules/packs/Pack.h>

#include <optional>
#include <variant>

namespace rules::campaign {

	// Moving card copies between the locker and the decks, under the deck rules (locker-and-deck-rules.md, run-decks.md).
	// Every copy is in exactly one place, so a move takes copies from one place and adds them to another, and nothing
	// but scrapping a locker card, and a dead driver's run deck, ever loses one.

	struct Locker {
		bool operator==(const Locker&) const = default;
	};

	// A driver's default deck, at the compound.
	struct DefaultDeck {
		CrewId driver;

		bool operator==(const DefaultDeck&) const = default;
	};

	// A seated driver's run deck, while the run is out. It trades with the locker only.
	struct RunDeckOf {
		CrewId driver;

		bool operator==(const RunDeckOf&) const = default;
	};

	using CardPlace = std::variant<Locker, DefaultDeck, RunDeckOf>;

	// Which of a run deck's copies a move is for, the stack a Customize control sits under (calls 53 and 54): coming
	// out, the driver's own, to stay home (`Own`), or borrowed ones, back to the locker (`Borrowed`); going in, the
	// driver's own back from home (`Home`), or new ones borrowed from the locker (`Borrowed`).
	enum class RunDeckCopies { Own, Borrowed, Home };

	struct CardMove {
		CardId	  card;
		int		  count{1};
		CardPlace from;
		CardPlace to;
		// None for the rules' own order (call 136), or the copies asked for, which that order still holds to.
		std::optional<RunDeckCopies> copies;
	};

	// Why the rules refuse a move, in the order they're checked:
	//   CampaignOver     the campaign is over
	//   DriverAway       a driver at either end is dead or missing (`driver`)
	//   OnRun            a default deck at either end is out on the run, in its driver's run deck (`driver`)
	//   OwnAtHome        borrowing a card while some of the driver's own wait at home, which come back first (`count`,
	//                    those at home)
	//   TooFew           the giving end holds fewer of the copies asked for than the move takes (`count`, those there)
	//   AlreadyBorrowed  the locker is short, and the other seat borrowed enough to make it up (`driver`)
	//   CardLocked       what the run deck holds of the card are escort cards, which nothing takes out (`escort`)
	//   BorrowedFirst    leaving the driver's own at home while copies of the card are borrowed, which go back first
	//                    (`count`, those borrowed)
	//   OtherArchetype   the card is marked for another archetype than the receiving driver's (`archetype`)
	//   DeckFull         the receiving deck would hold more than the most a deck takes (`count`, the most)
	//   DeckAtMinimum    the giving deck would hold fewer than the fewest (`count`, the fewest)
	// A deck outside the limits, after a retune, can still move back toward them.
	enum class CardRefusal {
		CampaignOver,
		DriverAway,
		OnRun,
		OwnAtHome,
		TooFew,
		AlreadyBorrowed,
		CardLocked,
		BorrowedFirst,
		OtherArchetype,
		DeckFull,
		DeckAtMinimum
	};

	struct CardBlocker {
		CardRefusal				reason{CardRefusal::TooFew};
		int						count{0};
		std::optional<CrewId>	driver;
		std::optional<ConvoyId> escort;
		std::optional<DriverId> archetype;

		bool operator==(const CardBlocker&) const = default;
	};

	// Why the rules refuse a move, or nullopt when they allow it. A screen asks it to grey an action out, and moveCards
	// asks it again, so the two can't disagree. A move no rule covers is a bug rather than a refusal, and throws
	// std::invalid_argument: a count under 1, a driver outside the pool, a run deck with no run out or of a driver not
	// on it, a run deck trading with anything but the locker, a place moving to itself, copies named with no run deck at
	// either end, and `Own` going into a run deck or `Home` coming out of one.
	[[nodiscard]] std::optional<CardBlocker>
	cardMoveBlocker(const Campaign& campaign, const Content& content, const DeckRules& rules, const CardMove& move);

	// Into a run deck, the driver's own left at home come back before anything is borrowed; out of one, borrowed copies
	// go back to the locker before the driver's own stay home (call 136), and a move naming its copies moves those.
	// Throws std::invalid_argument for a move the rules refuse, as cardMoveBlocker says.
	void moveCards(Campaign& campaign, const Content& content, const DeckRules& rules, const CardMove& move);

	// Why the locker can't scrap that many copies (CampaignOver or TooFew), or nullopt when it can.
	[[nodiscard]] std::optional<CardBlocker> scrapBlocker(const Campaign& campaign, const CardId& card, int count);

	// Scraps locker copies for the scrap each pays (call 116). Throws std::invalid_argument for a count under 1 or more
	// than the locker holds.
	void scrapCards(Campaign& campaign, const DeckRules& rules, const CardId& card, int count);

	// Every copy the compound owns: the locker, every default deck, and every run deck's own, left at home, and borrowed.
	// No move changes it; escort cards and cargo aren't the compound's.
	[[nodiscard]] CardCounts cardsOwned(const Campaign& campaign);

} // namespace rules::campaign
