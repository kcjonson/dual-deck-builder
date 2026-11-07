#include "scenes/event/EventText.h"

#include "Words.h"

#include <rules/campaign/Recruits.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <utility>

namespace game::event {

	namespace {

		using rules::campaign::EventChoice;
		using rules::campaign::EventGains;
		using rules::campaign::EventOutcome;
		using rules::campaign::Resources;

		struct Store {
			int Resources::* amount;
			Icon			 icon;
			const char*		 name;
		};

		// The stores in the strip's order; people are settlers, worded on their own.
		constexpr std::array<Store, 5> kStores{{
			{&Resources::food, Icon::Food, "food"},
			{&Resources::water, Icon::Water, "water"},
			{&Resources::fuel, Icon::Fuel, "fuel"},
			{&Resources::scrap, Icon::Scrap, "scrap"},
			{&Resources::meds, Icon::Meds, "meds"},
		}};

		std::string joined(const std::vector<std::string>& parts, const std::string& between) {
			std::string out;
			for (const std::string& part : parts) {
				out += (out.empty() ? "" : between) + part;
			}
			return out;
		}

		// "+3 fuel, +6 scrap", or "-2 food", signed by `sign`; none when nothing of the stores moved.
		std::optional<LedgerLine> storesLine(const Resources& amounts, const char* sign, Tone tone) {
			std::vector<std::string> parts;
			std::optional<Icon>		 first;
			for (const Store& store : kStores) {
				if (const int amount = amounts.*store.amount; amount > 0) {
					parts.push_back(sign + std::to_string(amount) + " " + store.name);
					first = first.value_or(store.icon);
				}
			}
			if (!first) {
				return std::nullopt;
			}
			return LedgerLine{.icon = *first, .text = joined(parts, ", "), .tone = tone};
		}

		// Each gain an outcome or its fight's win can give, once each, in the ledger's order.
		void gainIcons(const EventGains& gains, std::vector<IconItem>& into) {
			const auto add = [&into](Icon icon) {
				if (std::ranges::none_of(into, [icon](const IconItem& item) { return item.icon == icon; })) {
					into.push_back({.icon = icon, .tone = Tone::Gain});
				}
			};
			for (const Store& store : kStores) {
				if (gains.gained.*store.amount > 0) {
					add(store.icon);
				}
			}
			if (gains.gained.people > 0) {
				add(Icon::People);
			}
			if (gains.drivers > 0) {
				add(Icon::Driver);
			}
			if (!gains.cards.empty() || gains.cardPick) {
				add(Icon::Cards);
			}
			if (gains.escort) {
				add(Icon::Escort);
			}
			if (gains.structure > 0) {
				add(Icon::Repair);
			}
			if (gains.hp > 0) {
				add(Icon::Heal);
			}
		}

		std::string capitalised(std::string text) {
			if (!text.empty()) {
				text.front() = static_cast<char>(std::toupper(static_cast<unsigned char>(text.front())));
			}
			return text;
		}

		std::string signedText(int amount) {
			return (amount > 0 ? "+" : "") + std::to_string(amount);
		}

		void gainLines(const EventGains& gains, const rules::Content& content, std::vector<LedgerLine>& lines) {
			if (std::optional<LedgerLine> line = storesLine(gains.gained, "+", Tone::Gain)) {
				lines.push_back(*line);
			}
			if (std::optional<LedgerLine> line = storesLine(gains.lost, "-", Tone::Cost)) {
				lines.push_back(*line);
			}
			if (const int settlers = gains.gained.people; settlers > 0) {
				lines.push_back({
					.icon = Icon::People,
					.text =
						settlers == 1 ? "A settler rides home with the run" : std::to_string(settlers) + " settlers ride home with the run",
					.tone = Tone::Gain,
				});
			}
			if (gains.drivers > 0) {
				lines.push_back({
					.icon = Icon::Driver,
					.text = gains.drivers == 1 ? "Someone new rides home to join the crew"
											   : std::to_string(gains.drivers) + " new drivers ride home to join the crew",
					.tone = Tone::Gain,
				});
			}
			if (gains.cardPick) {
				lines.push_back({.icon = Icon::Cards, .text = "A card to pick for the locker", .tone = Tone::Gain});
			}
			if (gains.escort) {
				lines.push_back({
					.icon = Icon::Escort,
					.text = capitalised(withArticle(content.escorts.at(*gains.escort).name)) + " joins the convoy",
					.tone = Tone::Gain,
				});
			}
			if (gains.structure != 0) {
				lines.push_back({
					.icon = Icon::Repair,
					.text = "Structure " + signedText(gains.structure) + " on each vehicle",
					.tone = gains.structure < 0 ? Tone::Cost : Tone::Gain,
				});
			}
			if (gains.hp != 0) {
				lines.push_back({
					.icon = Icon::Heal,
					.text = "HP " + signedText(gains.hp) + " for each driver",
					.tone = gains.hp < 0 ? Tone::Cost : Tone::Gain,
				});
			}
		}

	} // namespace

	std::string kicker(rules::map::StopType type) {
		return type == rules::map::StopType::Distress ? "Distress signal" : "Wreck";
	}

	std::string fromTheRoad(rules::map::StopType type) {
		return type == rules::map::StopType::Distress ? "A distress call crackles over the radio, close by. Pull over and see who it is."
													  : "Something wrecked on the shoulder up ahead. Pull over and see what it is.";
	}

	std::string
	bandText(const EventChoice& choice, const std::optional<rules::campaign::ChoiceBlocker>& blocker, const rules::Content& content) {
		const rules::campaign::EventNeeds& needs = choice.needs;
		if (blocker && blocker->reason != rules::campaign::ChoiceRefusal::Cost) {
			return choiceRefusalText(*blocker, needs, content);
		}
		std::vector<std::string> met;
		if (needs.archetype) {
			met.push_back(rules::campaign::archetypeTitle(content, *needs.archetype) + (blocker ? "" : " only"));
		}
		if (needs.card) {
			met.push_back(content.cards.at(*needs.card).name);
		}
		if (needs.escort) {
			met.push_back(content.escorts.at(*needs.escort).name);
		}
		if (!blocker) {
			return joined(met, " + ");
		}
		met.push_back(choiceRefusalText(*blocker, needs, content));
		return joined(met, " / ");
	}

	ChoiceIcons choiceIcons(const EventChoice& choice) {
		ChoiceIcons icons;
		if (std::ranges::any_of(choice.outcomes, [](const EventOutcome& outcome) { return outcome.fight.has_value(); })) {
			icons.risks.push_back({.icon = Icon::Swords, .tone = Tone::Cost});
		}
		for (int skull = 0; skull < choice.danger; ++skull) {
			icons.risks.push_back({.icon = Icon::Skull, .tone = Tone::Cost});
		}
		for (const Store& store : kStores) {
			if (const int cost = choice.cost.*store.amount; cost > 0) {
				icons.risks.push_back({.icon = store.icon, .tone = Tone::Cost, .value = "-" + std::to_string(cost)});
			}
		}
		double hours = 0.0;
		for (const EventOutcome& outcome : choice.outcomes) {
			hours = std::max(hours, outcome.hours);
		}
		if (hours > 0.0) {
			icons.risks.push_back({.icon = Icon::Clock, .tone = Tone::Ink, .value = hoursText(hours)});
		}
		for (const EventOutcome& outcome : choice.outcomes) {
			gainIcons(outcome.gains, icons.gains);
			if (outcome.fight) {
				gainIcons(outcome.fight->won, icons.gains);
			}
		}
		return icons;
	}

	std::vector<LedgerLine> resultLines(
		const EventChoice&					choice,
		const EventOutcome&					outcome,
		const rules::Content&				content,
		const std::vector<rules::DriverId>& recruits
	) {
		std::vector<LedgerLine> lines;
		if (std::optional<LedgerLine> paid = storesLine(choice.cost, "", Tone::Cost)) {
			paid->text = "Paid " + paid->text;
			lines.push_back(*paid);
		}
		gainLines(outcome.gains, content, lines);
		if (!recruits.empty()) {
			std::vector<std::string> who;
			for (const rules::DriverId& archetype : recruits) {
				who.push_back(anArchetype(content, archetype));
			}
			for (LedgerLine& line : lines) {
				if (line.icon == Icon::Driver) {
					line.text =
						capitalised(rules::campaign::listed(who)) + (recruits.size() == 1 ? " rides" : " ride") + " home to join the crew";
				}
			}
		}
		if (outcome.hours > 0.0) {
			lines.push_back({.icon = Icon::Clock, .text = "+" + hoursText(outcome.hours) + " at the stop", .tone = Tone::Ink});
		}
		if (outcome.fight) {
			std::vector<LedgerLine> prize;
			gainLines(outcome.fight->won, content, prize);
			std::vector<std::string> won;
			for (const LedgerLine& line : prize) {
				won.push_back(line.text);
			}
			for (const auto& [card, copies] : outcome.fight->won.cards) {
				won.push_back((copies > 1 ? std::to_string(copies) + " " : std::string()) + content.cards.at(card).name);
			}
			const std::string head = "Raiders, " + counted(outcome.fight->skulls, "skull", "skulls") + ".";
			lines.push_back({
				.icon = Icon::Swords,
				.text = won.empty() ? head : head + " Win, and: " + joined(won, "; ") + ".",
				.tone = Tone::Cost,
			});
		}
		return lines;
	}

	std::string goLabel(const EventOutcome& outcome) {
		if (outcome.fight) {
			return "Fight them";
		}
		return outcome.gains.cardPick ? "Pick a card" : "Drive on";
	}

	std::string hoursText(double hours) {
		const double whole = std::floor(hours);
		if (hours == whole) {
			return std::to_string(static_cast<int>(whole)) + " h";
		}
		return std::to_string(static_cast<int>(whole)) + "." + std::to_string(static_cast<int>(std::lround((hours - whole) * 10.0))) + " h";
	}

} // namespace game::event
