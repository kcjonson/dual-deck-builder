#pragma once

#include "Campaign.h"
#include "CampaignRules.h"

#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>
#include <rules/packs/Pack.h>

#include <cstdint>
#include <optional>
#include <vector>

namespace rules::campaign {

	// The combat bridge (combat-bridge.md): the run's fights built from the campaign, and what each did written back.

	// HP a driver down in a fight the run carries on from is back on their feet with, and the structure a wrecked driven
	// vehicle limps into the next fight on, with no armor (calls 15 and 16).
	inline constexpr int kReviveHitpoints = 1;
	inline constexpr int kLimpStructure = 1;

	// The seed the run's next fight plays on, forked from the campaign's seed by the run and the fights it has written
	// back, so a fight started again after a reload is the same fight (call 65). pickEncounter takes it too.
	[[nodiscard]] uint32_t nextFightSeed(const Campaign& campaign);

	// A fight built from the run out, which its write-back reads.
	struct CampaignFight {
		RunId run;
		// The run's fights before it.
		int			number{0};
		BattleState state;
	};

	struct CampaignFightStart {
		CampaignFight fight;
		// The opening deal and shuffles, for the battle screen.
		std::vector<Event> events;
	};

	// The run's next fight: each seat's driver at the HP their record carries, in their own vehicle at its structure and
	// armor, all clamped to the archetype's maximums as they stand, dealt their run deck (their own and borrowed copies
	// in card order, then the escort cards); the escorts that came along in roster order, each at the structure it
	// carries; and `encounter` fielded against them at the run's stage, on nextFightSeed. Throws std::invalid_argument
	// with no run out, and for anything fieldEncounter or startBattle refuses.
	[[nodiscard]] CampaignFightStart startCampaignFight(const Campaign& campaign, const Content& content, const EncounterId& encounter);

	// What became of a seat:
	//   Fought    still in the fight at its end
	//   PickedUp  crashed out alive, and the partner went back for them
	//   Revived   down at 0 HP, and back up at kReviveHitpoints
	//   Dead      down at 0 HP in a lost fight, gone for good
	//   Missing   alive in a lost fight, with nobody left to pick them up
	enum class SeatFate { Fought, PickedUp, Revived, Dead, Missing };

	struct SeatWriteBack {
		CrewId	 driver;
		SeatFate fate{SeatFate::Fought};
		// What the haulers' heal gave them after a win, up to their max HP.
		int healed{0};

		bool operator==(const SeatWriteBack&) const = default;
	};

	// A lost fight ends the run, and this is what went with it.
	struct RunLost {
		RunId run;
		// What the dead took with them: their own run deck and what they borrowed.
		CardCounts cardsLost;
		Resources  cargo;
		CardCounts cargoCards;
		// Who it was bringing home: the missing it found stay missing, and someone new never joins (calls 43 and 212).
		std::vector<CrewId>	  found;
		std::vector<DriverId> recruits;
	};

	struct FightWriteBack {
		Outcome					   outcome{Outcome::Won};
		std::vector<SeatWriteBack> seats;
		std::vector<ConvoyId>	   escortsLost;
		// The fuel and scrap the haulers paid into the cargo after a win.
		Resources			   dividends;
		std::optional<RunLost> lost;
	};

	// Writes an ended fight back (combat-bridge.md, Writing a fight back). Won or broken off, the run carries on: each
	// seat keeps the HP and the vehicle damage the fight left (a wreck limping on, its armor gone, and armor at most its
	// base, call 393), a driver who went down is revived and one who crashed out picked up (call 198), wrecked escorts
	// leave the convoy and take their cards out of the run decks, the rest keep their structure, and after a win each
	// surviving hauler pays its dividend: fuel and scrap into the cargo, HP to every seat still above 0. Lost, the run
	// ends there: the down are dead and the rest missing, the dead lose their run decks and the missing get theirs back
	// (call 138), the cargo, everyone it found, and every escort that came along are lost, with a log line for the cargo
	// (call 23), and the campaign ends if nobody is left at the compound (call 37). A won fight counts in the tally.
	// Throws std::invalid_argument for a fight still on, one already written back or from another run, and one that
	// doesn't seat the run's drivers and escorts.
	FightWriteBack writeBackFight(Campaign& campaign, const Content& content, const CampaignRules& rules, const CampaignFight& fight);

} // namespace rules::campaign
