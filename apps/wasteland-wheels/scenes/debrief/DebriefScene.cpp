#include "scenes/debrief/DebriefScene.h"

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "atlas/ResourceStrip.h"
#include "scenes/result/ResultPage.h"

#include <rules/campaign/Recruits.h>
#include <rules/map/PoiNames.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <string>
#include <utility>

namespace game {

	using rules::campaign::Campaign;

	namespace {

		using atlas::MapSymbol;

		constexpr float kLedgerWidth = 380.0F;
		constexpr float kCrewWidth = 330.0F;

		// The POI's name as every scene gives it, the map's labels included.
		std::string poiName(const Session& session, int poi) {
			const rules::campaign::MapLayers& layers = session.layers();
			const std::vector<std::string>	  names = rules::map::poiNames(
				   layers.pois, layers.places, layers.content.pois, layers.content.factions, static_cast<double>(layers.params.radius)
			   );
			return names.at(static_cast<size_t>(poi));
		}

		// A store the run unloaded, as the strip shows it: what came in, not what's held.
		void unloadedStrip(ui::Ref<atlas::LegendBox> box, const rules::campaign::Resources& in) {
			std::vector<atlas::Store> stores;
			const auto				  add = [&](const char* id, const char* name, int amount) {
				   if (amount > 0) {
					   stores.push_back({.id = id, .name = name, .value = "+" + std::to_string(amount)});
				   }
			};
			add("food", "Food", in.food);
			add("water", "Water", in.water);
			add("fuel", "Fuel", in.fuel);
			add("scrap", "Scrap", in.scrap);
			add("meds", "Meds", in.meds);
			add("people", "People", in.people);
			if (!stores.empty()) {
				atlas::resourceStrip(box, stores);
			}
		}

	} // namespace

	DebriefScene::DebriefScene(DebriefArgs args)
		: debrief(std::move(args)) {}

	const ui::Theme& DebriefScene::sceneTheme() const {
		return atlas::theme();
	}

	void DebriefScene::enter() {
		if (!ui().icons().has("food")) {
			ui().icons().add(icons::iconAtlas());
		}
		Session* session = sessionOrMenu();
		if (session == nullptr) {
			return;
		}
		const Campaign&		  campaign = session->campaign;
		const rules::Content& content = game().rules.content;
		const auto			  named = [&](const rules::campaign::CrewId& driver) {
			   return rules::campaign::driverName(campaign, content, driver);
		};
		const int day = debrief.night ? debrief.night->day : campaign.day;

		result::Heading heading{.kicker = "Supply run \xC2\xB7 day " + std::to_string(day)};
		if (debrief.lost) {
			const rules::campaign::RunLost& lost = *debrief.lost;
			heading.title = lost.poi ? "Lost on the road to " + poiName(*session, *lost.poi) : "The run was lost";
			std::vector<std::string> fates;
			for (const rules::campaign::SeatWriteBack& seat : debrief.seats) {
				fates.push_back(named(seat.driver) + (seat.fate == rules::campaign::SeatFate::Dead ? " is dead" : " is missing"));
			}
			heading.story = rules::campaign::listed(fates) + ".";
			heading.hostile = true;
			heading.stamp = "stamp-lost";
		} else if (debrief.home) {
			const rules::campaign::Unloaded& home = *debrief.home;
			heading.title = home.poi ? "Home from " + poiName(*session, *home.poi) : "The run is home";
			const std::string brought = rules::campaign::cargoText(content, home.resources, home.cards);
			heading.story = brought.empty() ? "It came home empty." : "It brought home " + brought + ".";
			if (home.poi) {
				heading.stamp = "stamp-looted";
			}
		}
		const result::Page sheet = result::openPage(root(), {.identity = "debrief", .heading = heading});

		if (debrief.home) {
			const rules::campaign::Unloaded& home = *debrief.home;
			ui::Ref<atlas::LegendBox>		 unloaded = result::box(sheet, "unloaded", "Unloaded", kLedgerWidth);
			unloadedStrip(unloaded, home.resources);
			int rows = 0;
			if (const std::string cards = rules::campaign::cargoText(content, {}, home.cards); !cards.empty()) {
				result::row(unloaded, "unloaded_cards", MapSymbol::Ring, "To the locker: " + cards + ".");
				++rows;
			}
			for (const rules::campaign::CrewId& found : home.found) {
				result::row(unloaded, "unloaded_found_" + found.value, MapSymbol::Ring, named(found) + " is back from the missing.");
				++rows;
			}
			for (const rules::campaign::CrewId& joined : home.recruited) {
				result::row(unloaded, "unloaded_joined_" + joined.value, MapSymbol::Ring, named(joined) + " joined the compound.");
				++rows;
			}
			if (rows == 0 && home.resources == rules::campaign::Resources{}) {
				result::row(unloaded, "unloaded_none", MapSymbol::Dash, "Nothing to unload.");
			}

			// Each driver as they stand after the night, the night home being the first day in the infirmary, worded as the
			// compound words them.
			ui::Ref<atlas::LegendBox>			 crew = result::box(sheet, "crew", "The crew", kCrewWidth);
			std::vector<rules::campaign::CrewId> drove = home.seats;
			drove.insert(drove.end(), home.found.begin(), home.found.end());
			for (const rules::campaign::CrewId& driver : drove) {
				const rules::campaign::DriverRecord& record = campaign.driver(driver);
				result::row(
					crew,
					"crew_" + driver.value,
					record.status == rules::campaign::DriverStatus::Injured ? MapSymbol::Ring : MapSymbol::Dash,
					driverStanding(campaign, content, record)
				);
			}
		}

		if (debrief.lost) {
			const rules::campaign::RunLost& lost = *debrief.lost;
			ui::Ref<atlas::LegendBox>		box = result::box(sheet, "lost", "Lost with the run", kLedgerWidth);
			for (const rules::campaign::SeatWriteBack& seat : debrief.seats) {
				const bool dead = seat.fate == rules::campaign::SeatFate::Dead;
				result::row(
					box, "lost_" + seat.driver.value, MapSymbol::Diamond, named(seat.driver) + (dead ? ", dead" : ", missing"), true
				);
			}
			if (const std::string cargo = rules::campaign::cargoText(content, lost.cargo, lost.cargoCards); !cargo.empty()) {
				result::row(box, "lost_cargo", MapSymbol::Dash, "The cargo: " + cargo + ".");
			}
			for (const rules::campaign::ConvoyEscort& escort : lost.escorts) {
				result::row(
					box, "lost_" + escort.id.value, MapSymbol::Dash, content.escorts.at(escort.type).name + ", gone from the convoy."
				);
			}
			for (const rules::campaign::CrewId& found : lost.found) {
				result::row(box, "lost_found_" + found.value, MapSymbol::Dash, named(found) + " stays missing.");
			}
			if (const int cards = rules::campaign::totalCards(lost.cardsLost); cards > 0) {
				result::row(box, "lost_cards", MapSymbol::Dash, counted(cards, "card", "cards") + " went with the dead.");
			}
		}

		ui::Ref<atlas::LegendBox> nightBox = result::box(sheet, "night", "The night", kLedgerWidth);
		if (debrief.night) {
			const rules::campaign::DayEnd& night = *debrief.night;
			result::row(
				nightBox,
				"night_upkeep",
				MapSymbol::Ring,
				"Day " + std::to_string(night.day) + " ended. The compound ate " + amountsText(night.upkeep) + "."
			);
			if (night.shortfall != rules::campaign::Resources{}) {
				result::row(
					nightBox,
					"night_short",
					MapSymbol::Diamond,
					"Short of " + amountsText(night.shortfall) + ": " + counted(night.peopleLost, "person", "people") +
						" left, unrest up " + std::to_string(night.unrestGained) + ".",
					true
				);
			}
			for (const rules::campaign::CrewId& healed : night.healed) {
				result::row(nightBox, "night_healed_" + healed.value, MapSymbol::Ring, named(healed) + " is fit again.");
			}
			if (!night.stopsBack.empty()) {
				result::row(
					nightBox,
					"night_stops",
					MapSymbol::Ring,
					counted(static_cast<int>(night.stopsBack.size()), "stop is", "stops are") + " back on the road."
				);
			}
		} else {
			result::row(nightBox, "night_none", MapSymbol::Diamond, "Nobody is left at the compound to see it.", true);
		}

		const bool ended = campaign.end.has_value();
		if (ended) {
			result::footLine(sheet, "ended", "The compound has fallen.", true);
		}
		ui::Ref<atlas::AtlasButton> onward = result::highway(sheet, "to_compound", ended ? "The end" : "Back to the compound", [this] {
			app().scenes().switchTo(game().session && game().session->campaign.end ? scenes::kCampaignEnd : scenes::kCompound);
		});
		onward.get()->focus();
	}

	std::string DebriefScene::exportState() const {
		return nlohmann::json{
			{"home", debrief.home.has_value()}, {"lost", debrief.lost.has_value()}, {"night", debrief.night.has_value()}
		}.dump();
	}

} // namespace game
