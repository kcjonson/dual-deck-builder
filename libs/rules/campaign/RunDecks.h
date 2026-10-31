#pragma once

#include "Campaign.h"
#include "CampaignRules.h"
#include "Infirmary.h"

#include <rules/packs/Pack.h>

#include <optional>
#include <vector>

namespace rules::campaign {

	// A run out from the compound and the decks it takes (run-decks.md): load out seats the drivers and moves each one's
	// default deck into their run deck, escort cards ride along locked, and the run ends coming home (unloadRun), failing
	// (the combat bridge's write-back of a lost fight), or given up before it leaves (giveUpLoadOut).

	// Game stage, how far into the campaign it is: a stage every eight days and two a stronghold taken on the map, at
	// most 6 (Runs and Encounters, Game stage).
	[[nodiscard]] int gameStage(const Campaign& campaign);

	// Why load out won't seat a driver beside whoever holds the other seat (injuries.md, Seating), in the order checked:
	//   CampaignOver   the campaign is over
	//   Injured        they're in the infirmary for `injuredDays` more
	//   DriverAway     they're dead or missing
	//   AlreadySeated  they hold the other seat
	//   SameArchetype  they're the other seat's archetype while two different archetypes are ready (call 35)
	enum class SeatRefusal { CampaignOver, Injured, DriverAway, AlreadySeated, SameArchetype };

	struct SeatBlocker {
		SeatRefusal reason{SeatRefusal::DriverAway};
		int			injuredDays{0};

		bool operator==(const SeatBlocker&) const = default;
	};

	// Throws std::invalid_argument for a driver or partner outside the pool.
	[[nodiscard]] std::optional<SeatBlocker>
	seatBlocker(const Campaign& campaign, const CrewId& driver, const std::optional<CrewId>& partner);

	struct RunStart {
		// Driver 1 first; one or two.
		std::vector<CrewId> seats;
		// The convoy's escorts going, which ride in roster order whatever order they're named in.
		std::vector<ConvoyId> escorts;
		// The game stage the run leaves at, gameStage's.
		int stage{0};
	};

	// Starts a run: each seat's default deck moves whole into their run deck, every escort going puts its signature card
	// in Driver 1's, and the run takes the next run id. Throws std::invalid_argument once the campaign is over, with a
	// run already out, for seats
	// seatBlocker refuses, asked of each alone and then of the pair, for an escort not in the convoy or named twice, and
	// for a stage outside 0 to 6.
	void startRun(Campaign& campaign, const Content& content, const RunStart& start);

	// Gives an escort's card to the other seat. Throws std::invalid_argument with no run out, for an escort that didn't
	// come along, or a driver who isn't seated.
	void moveEscortCard(Campaign& campaign, const ConvoyId& escort, const CrewId& toSeat);

	// Puts everything a seat left at home back in their run deck and everything they borrowed back in the locker. Escort
	// cards stay where they are (call 139). Throws std::invalid_argument for a driver who isn't seated.
	void resetRunDeck(Campaign& campaign, const CrewId& driver);

	// A load out given up before the run leaves: everyone's default deck back as it was, what they borrowed back in the
	// locker, the escort cards gone, and no run out. Throws std::invalid_argument with no run out, or for one that has
	// fought or picked anything or anyone up, which only coming home or failing ends.
	void giveUpLoadOut(Campaign& campaign);

	// Adds cards won on the road (a fight's reward, a find, a roadside garage) to the run's cargo, bound for the locker
	// (cards-won.md, call 19). They never go in a run deck. Throws std::invalid_argument with no run out, for a count under
	// 1, and for a card no loaded pack defines or an escort's signature card, which only its escort brings.
	void addCardsWon(Campaign& campaign, const Content& content, const CardCounts& cards);

	// One seat's run deck unwound as its run ends, by its driver's status: a driver who isn't dead gets their own and the
	// cards they left at home back in their default deck, and what they borrowed goes back to the locker; a dead one took
	// their own and what they borrowed with them, which it returns, and what they left at home goes to the locker. Escort
	// cards leave. It leaves the run out, for the end of the run to settle the rest.
	CardCounts unwindRunDeck(Campaign& campaign, const RunDeck& deck);

	struct Unloaded {
		Resources  resources;
		CardCounts cards;
		// The missing found on the road, back in the pool, and someone new who joined it.
		std::vector<CrewId> found;
		std::vector<CrewId> recruited;
		std::vector<Injury> injuries;
	};

	// A run home: each seat's run deck unwinds, their own cards and those they left at home back in their default deck
	// and what they borrowed back in the locker, the escort cards gone; then the cargo goes into the stores and the cards
	// won into the locker, and the run is counted home. The missing it found are back, their vehicle at kLimpStructure
	// with the armor the crash left it (call 41), and someone new it found joins the pool (recruitDriver), with a log
	// line. Then each seat and each driver found who's home hurt goes into the infirmary (injureOnArrival). It returns
	// what came home for the debrief. The day ends after it, with endDay. Throws std::invalid_argument with no run out.
	Unloaded unloadRun(Campaign& campaign, const Content& content, const CampaignRules& rules);

} // namespace rules::campaign
