#include "Campaign.h"

#include <algorithm>
#include <cassert>
#include <charconv>
#include <stdexcept>

namespace rules::campaign {

	std::optional<int> idNumber(std::string_view id, std::string_view prefix) {
		if (!id.starts_with(prefix)) {
			return std::nullopt;
		}
		const std::string_view digits = id.substr(prefix.size());
		int					   number = 0;
		const auto [end, error] = std::from_chars(digits.data(), digits.data() + digits.size(), number);
		// No sign, no leading zero, nothing after it, so each number has one spelling.
		if (digits.empty() || digits.front() == '0' || error != std::errc{} || end != digits.data() + digits.size()) {
			return std::nullopt;
		}
		return number;
	}

	Resources operator+(const Resources& left, const Resources& right) {
		return Resources{
			.food = left.food + right.food,
			.water = left.water + right.water,
			.fuel = left.fuel + right.fuel,
			.meds = left.meds + right.meds,
			.scrap = left.scrap + right.scrap,
			.people = left.people + right.people,
		};
	}

	int countOf(const CardCounts& counts, const CardId& card) {
		const auto found = counts.find(card);
		return found == counts.end() ? 0 : found->second;
	}

	int totalCards(const CardCounts& counts) {
		int total = 0;
		for (const auto& [card, count] : counts) {
			total += count;
		}
		return total;
	}

	void addCards(CardCounts& counts, const CardId& card, int count) {
		assert(count >= 0 && "addCards: a count from 0");
		if (count > 0) {
			counts[card] += count;
		}
	}

	void addCards(CardCounts& counts, const CardCounts& more) {
		for (const auto& [card, count] : more) {
			addCards(counts, card, count);
		}
	}

	void takeCards(CardCounts& counts, const CardId& card, int count) {
		assert(count >= 0 && countOf(counts, card) >= count && "takeCards: the counts hold the copies taken");
		if (count == 0) {
			return;
		}
		int& held = counts.at(card);
		held -= count;
		if (held == 0) {
			counts.erase(card);
		}
	}

	CardCounts runDeckCards(const RunDeck& deck) {
		CardCounts cards = deck.own;
		addCards(cards, deck.borrowed);
		return cards;
	}

	DriverRecord* Campaign::findDriver(const CrewId& id) {
		const auto found = std::ranges::find(drivers, id, &DriverRecord::id);
		return found == drivers.end() ? nullptr : &*found;
	}

	const DriverRecord* Campaign::findDriver(const CrewId& id) const {
		const auto found = std::ranges::find(drivers, id, &DriverRecord::id);
		return found == drivers.end() ? nullptr : &*found;
	}

	DriverRecord& Campaign::driver(const CrewId& id) {
		DriverRecord* found = findDriver(id);
		if (found == nullptr) {
			throw std::invalid_argument(id.value + " isn't in the campaign's pool");
		}
		return *found;
	}

	const DriverRecord& Campaign::driver(const CrewId& id) const {
		const DriverRecord* found = findDriver(id);
		if (found == nullptr) {
			throw std::invalid_argument(id.value + " isn't in the campaign's pool");
		}
		return *found;
	}

	ConvoyEscort* Campaign::findEscort(const ConvoyId& id) {
		const auto found = std::ranges::find(convoy, id, &ConvoyEscort::id);
		return found == convoy.end() ? nullptr : &*found;
	}

	const ConvoyEscort* Campaign::findEscort(const ConvoyId& id) const {
		const auto found = std::ranges::find(convoy, id, &ConvoyEscort::id);
		return found == convoy.end() ? nullptr : &*found;
	}

	void refuseOver(const Campaign& campaign, std::string_view action) {
		if (campaign.end) {
			throw std::invalid_argument(std::string(action) + ": the campaign is over");
		}
	}

	void addLog(Campaign& campaign, std::string text) {
		campaign.log.push_back(LogEntry{.day = campaign.day, .text = std::move(text)});
	}

	std::vector<std::string> resourceAmounts(const Resources& resources) {
		std::vector<std::string> amounts;
		const auto				 add = [&](int amount, std::string_view one, std::string_view many) {
			  if (amount > 0) {
				  amounts.push_back(std::to_string(amount) + " " + std::string(amount == 1 ? one : many));
			  }
		};
		add(resources.food, "food", "food");
		add(resources.water, "water", "water");
		add(resources.fuel, "fuel", "fuel");
		add(resources.meds, "med", "meds");
		add(resources.scrap, "scrap", "scrap");
		add(resources.people, "person", "people");
		return amounts;
	}

	std::string listed(const std::vector<std::string>& items) {
		std::string text;
		for (size_t index = 0; index < items.size(); ++index) {
			if (index > 0) {
				text += items.size() == 2 ? " and " : (index + 1 == items.size() ? ", and " : ", ");
			}
			text += items[index];
		}
		return text;
	}

	RunDeck* Campaign::runDeckOf(const CrewId& id) {
		if (!run) {
			return nullptr;
		}
		const auto found = std::ranges::find(run->seats, id, &RunDeck::driver);
		return found == run->seats.end() ? nullptr : &*found;
	}

	const RunDeck* Campaign::runDeckOf(const CrewId& id) const {
		if (!run) {
			return nullptr;
		}
		const auto found = std::ranges::find(run->seats, id, &RunDeck::driver);
		return found == run->seats.end() ? nullptr : &*found;
	}

} // namespace rules::campaign
