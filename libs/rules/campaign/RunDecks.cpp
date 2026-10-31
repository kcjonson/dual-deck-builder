#include "RunDecks.h"

#include <rules/battle/Battle.h>

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		constexpr int kDaysPerStage = 8;
		constexpr int kStagesPerStronghold = 2;

		Run& runOut(Campaign& campaign, std::string_view action) {
			if (!campaign.run) {
				throw std::invalid_argument(std::string(action) + ": no run is out");
			}
			return *campaign.run;
		}

		RunDeck& seatOf(Campaign& campaign, const CrewId& driver, std::string_view action) {
			RunDeck* deck = campaign.runDeckOf(driver);
			if (deck == nullptr) {
				throw std::invalid_argument(std::string(action) + ": " + driver.value + " isn't seated on a run out");
			}
			return *deck;
		}

		std::string refusal(const CrewId& driver, const SeatBlocker& blocker) {
			switch (blocker.reason) {
				case SeatRefusal::CampaignOver:
					return "the campaign is over";
				case SeatRefusal::Injured:
					return driver.value + " is injured, fit in " + std::to_string(blocker.injuredDays) + " days";
				case SeatRefusal::DriverAway:
					return driver.value + " is dead or missing";
				case SeatRefusal::AlreadySeated:
					return driver.value + " is in both seats";
				case SeatRefusal::SameArchetype:
					return driver.value + " is the other seat's archetype, and two different ones are ready";
			}
			return "";
		}

	} // namespace

	int gameStage(int day, int strongholdsTaken) {
		return std::min(day / kDaysPerStage + kStagesPerStronghold * strongholdsTaken, kMostStage);
	}

	std::optional<SeatBlocker> seatBlocker(const Campaign& campaign, const CrewId& driver, const std::optional<CrewId>& partner) {
		const DriverRecord& record = campaign.driver(driver);
		const DriverRecord* other = partner ? &campaign.driver(*partner) : nullptr;
		if (campaign.end) {
			return SeatBlocker{.reason = SeatRefusal::CampaignOver};
		}
		if (record.status == DriverStatus::Injured) {
			return SeatBlocker{.reason = SeatRefusal::Injured, .injuredDays = record.injuredDays};
		}
		if (record.status != DriverStatus::Ready) {
			return SeatBlocker{.reason = SeatRefusal::DriverAway};
		}
		if (other == nullptr) {
			return std::nullopt;
		}
		if (other->id == record.id) {
			return SeatBlocker{.reason = SeatRefusal::AlreadySeated};
		}
		// Call 35: a pair of one archetype goes when every ready driver shares it, so the pool can't lock itself out.
		const bool mixedReady = std::ranges::any_of(campaign.drivers, [&](const DriverRecord& ready) {
			return ready.status == DriverStatus::Ready && ready.archetype != record.archetype;
		});
		if (other->archetype == record.archetype && mixedReady) {
			return SeatBlocker{.reason = SeatRefusal::SameArchetype};
		}
		return std::nullopt;
	}

	void startRun(Campaign& campaign, const Content& content, const RunStart& start) {
		refuseOver(campaign, "startRun");
		if (campaign.run) {
			throw std::invalid_argument("startRun: " + campaign.run->id.value + " is already out");
		}
		if (start.seats.empty() || start.seats.size() > 2) {
			throw std::invalid_argument("startRun: a run seats one or two drivers");
		}
		if (start.stage < 0 || start.stage > kMostStage) {
			throw std::invalid_argument("startRun: game stage runs 0 to " + std::to_string(kMostStage));
		}
		// Each seat alone first, so a seat's own reason wins over the pairing's.
		const auto refuse = [&](const CrewId& seat, const std::optional<CrewId>& partner) {
			if (const std::optional<SeatBlocker> blocker = seatBlocker(campaign, seat, partner)) {
				throw std::invalid_argument("startRun: " + refusal(seat, *blocker));
			}
		};
		for (const CrewId& seat : start.seats) {
			refuse(seat, std::nullopt);
		}
		if (start.seats.size() == 2) {
			refuse(start.seats[1], start.seats[0]);
		}
		std::vector<ConvoyId> escorts;
		for (const ConvoyEscort& escort : campaign.convoy) {
			const auto named = std::ranges::count(start.escorts, escort.id);
			if (named > 1) {
				throw std::invalid_argument("startRun: " + escort.id.value + " is named twice");
			}
			if (named == 1) {
				escorts.push_back(escort.id);
			}
		}
		if (escorts.size() != start.escorts.size()) {
			throw std::invalid_argument("startRun: an escort going isn't in the convoy");
		}

		Run run{
			.id = RunId{std::string(kRunPrefix) + std::to_string(campaign.nextRunNumber++)},
			.stage = start.stage,
			.seats = {},
			.escorts = escorts,
		};
		for (const CrewId& seat : start.seats) {
			DriverRecord& driver = campaign.driver(seat);
			run.seats.push_back(RunDeck{.driver = seat, .own = std::move(driver.defaultDeck)});
			driver.defaultDeck.clear();
		}
		for (const ConvoyId& escort : escorts) {
			const EscortId& type = campaign.findEscort(escort)->type;
			run.seats.front().escortCards.push_back(EscortCard{.card = content.escorts.at(type).signatureCard, .broughtBy = escort});
		}
		campaign.run = std::move(run);
	}

	void moveEscortCard(Campaign& campaign, const ConvoyId& escort, const CrewId& toSeat) {
		Run&	 run = runOut(campaign, "moveEscortCard");
		RunDeck& to = seatOf(campaign, toSeat, "moveEscortCard");
		for (RunDeck& from : run.seats) {
			const auto card = std::ranges::find(from.escortCards, escort, &EscortCard::broughtBy);
			if (card == from.escortCards.end()) {
				continue;
			}
			if (&from != &to) {
				to.escortCards.push_back(*card);
				from.escortCards.erase(card);
			}
			return;
		}
		throw std::invalid_argument("moveEscortCard: " + escort.value + " didn't come along on the run");
	}

	void resetRunDeck(Campaign& campaign, const CrewId& driver) {
		RunDeck& deck = seatOf(campaign, driver, "resetRunDeck");
		addCards(deck.own, deck.leftHome);
		deck.leftHome.clear();
		addCards(campaign.locker, deck.borrowed);
		deck.borrowed.clear();
	}

	CardCounts unwindRunDeck(Campaign& campaign, const RunDeck& deck) {
		DriverRecord& driver = campaign.driver(deck.driver);
		if (driver.status == DriverStatus::Dead) {
			addCards(campaign.locker, deck.leftHome);
			return runDeckCards(deck);
		}
		addCards(driver.defaultDeck, deck.own);
		addCards(driver.defaultDeck, deck.leftHome);
		addCards(campaign.locker, deck.borrowed);
		return {};
	}

	void giveUpLoadOut(Campaign& campaign) {
		const Run& run = runOut(campaign, "giveUpLoadOut");
		if (run.fights > 0 || run.cargo != Resources{} || !run.cargoCards.empty()) {
			throw std::invalid_argument("giveUpLoadOut: " + run.id.value + " has left, and ends by coming home or failing");
		}
		for (const RunDeck& deck : run.seats) {
			(void)unwindRunDeck(campaign, deck);
		}
		campaign.run.reset();
	}

	void addCardsWon(Campaign& campaign, const Content& content, const CardCounts& cards) {
		Run& run = runOut(campaign, "addCardsWon");
		for (const auto& [card, count] : cards) {
			const auto found = content.cards.find(card);
			if (count < 1 || found == content.cards.end() || found->second.signatureOf) {
				throw std::invalid_argument(
					"addCardsWon: " + card.value + " is no card a pack defines, an escort's signature card, or under 1 copy"
				);
			}
		}
		addCards(run.cargoCards, cards);
	}

	Unloaded unloadRun(Campaign& campaign, const Content& content, const CampaignRules& rules) {
		Run run = std::move(runOut(campaign, "unloadRun"));
		campaign.run.reset();
		for (const RunDeck& deck : run.seats) {
			(void)unwindRunDeck(campaign, deck);
		}
		campaign.stores = campaign.stores + run.cargo;
		addCards(campaign.locker, run.cargoCards);
		++campaign.tally.runsHome;
		std::vector<CrewId> seats;
		for (const RunDeck& deck : run.seats) {
			seats.push_back(deck.driver);
		}
		return Unloaded{
			.resources = run.cargo,
			.cards = std::move(run.cargoCards),
			.injuries = injureOnArrival(campaign, content, rules.compound, seats),
		};
	}

} // namespace rules::campaign
