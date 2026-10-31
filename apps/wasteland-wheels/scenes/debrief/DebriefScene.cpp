#include "scenes/debrief/DebriefScene.h"

#include "Words.h"

#include <rules/campaign/Recruits.h>

#include <nlohmann/json.hpp>

#include <utility>

namespace game {

	using rules::campaign::Campaign;

	namespace {

		std::string fateText(rules::campaign::SeatFate fate) {
			using rules::campaign::SeatFate;
			switch (fate) {
				case SeatFate::Fought:
					return "came through";
				case SeatFate::PickedUp:
					return "was picked up";
				case SeatFate::Revived:
					return "was revived";
				case SeatFate::Dead:
					return "is dead";
				case SeatFate::Missing:
					return "is missing";
			}
			return "";
		}

	} // namespace

	DebriefScene::DebriefScene(DebriefArgs args)
		: debrief(std::move(args)) {}

	void DebriefScene::enter() {
		Session* session = sessionOrMenu();
		if (session == nullptr) {
			return;
		}
		const Campaign&		  campaign = session->campaign;
		const rules::Content& content = game().rules.content;
		page = kit::openPage(*this, page, debrief.lost ? "The run failed" : "The run is home", campaignSummary(campaign));

		ui::Ref<ui::Component> run = kit::panel(page, debrief.lost ? "Lost" : "Brought home", "run");
		if (debrief.home) {
			const rules::campaign::Unloaded& home = *debrief.home;
			kit::text(run, "Into the stores: " + amountsText(home.resources));
			kit::text(run, "Into the locker: " + counted(rules::campaign::totalCards(home.cards), "card", "cards"));
			for (const rules::campaign::CrewId& found : home.found) {
				kit::text(run, rules::campaign::driverName(campaign, content, found) + " is back from the missing.");
			}
			for (const rules::campaign::CrewId& joined : home.recruited) {
				kit::text(run, rules::campaign::driverName(campaign, content, joined) + " joined the compound.");
			}
			for (const rules::campaign::Injury& injury : home.injuries) {
				kit::caption(
					run,
					rules::campaign::driverName(campaign, content, injury.driver) + " is in the infirmary for " +
						counted(injury.days, "day", "days") + "."
				);
			}
		}
		if (debrief.lost) {
			const rules::campaign::RunLost& lost = *debrief.lost;
			for (const rules::campaign::SeatWriteBack& seat : debrief.seats) {
				kit::text(run, rules::campaign::driverName(campaign, content, seat.driver) + " " + fateText(seat.fate) + ".");
			}
			kit::text(
				run,
				"The cargo: " + amountsText(lost.cargo) + ", and " +
					counted(rules::campaign::totalCards(lost.cargoCards), "card", "cards") + " won"
			);
			kit::caption(run, counted(rules::campaign::totalCards(lost.cardsLost), "card", "cards") + " went with the dead.");
		}

		if (debrief.night) {
			const rules::campaign::DayEnd& night = *debrief.night;
			ui::Ref<ui::Component>		   day = kit::panel(page, "The night", "night");
			kit::text(day, "Day " + std::to_string(night.day) + " ended. The compound ate " + amountsText(night.upkeep) + ".");
			if (night.shortfall != rules::campaign::Resources{}) {
				kit::text(
					day,
					"Short of " + amountsText(night.shortfall) + ": " + counted(night.peopleLost, "person", "people") +
						" left, unrest up " + std::to_string(night.unrestGained) + "."
				);
			}
			for (const rules::campaign::CrewId& healed : night.healed) {
				kit::caption(day, rules::campaign::driverName(campaign, content, healed) + " is fit again.");
			}
			if (!night.stopsBack.empty()) {
				kit::caption(day, counted(static_cast<int>(night.stopsBack.size()), "stop is", "stops are") + " back on the road.");
			}
		}

		kit::button(
			page.footer,
			"to_compound",
			campaign.end ? "The end" : "Back to the compound",
			[this] { app().scenes().switchTo(game().session && game().session->campaign.end ? scenes::kCampaignEnd : scenes::kCompound); },
			ui::ButtonVariant::Primary
		);
	}

	std::string DebriefScene::exportState() const {
		return nlohmann::json{
			{"home", debrief.home.has_value()}, {"lost", debrief.lost.has_value()}, {"night", debrief.night.has_value()}
		}.dump();
	}

} // namespace game
