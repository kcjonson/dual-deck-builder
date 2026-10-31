#include "scenes/loadout/LoadOutScene.h"

#include "Words.h"

#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>
#include <rules/map/RouteOffers.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <stdexcept>

namespace game {

	using rules::campaign::Campaign;
	using rules::campaign::ConvoyId;
	using rules::campaign::CrewId;

	namespace {

		rules::campaign::RunStart
		runStart(const Campaign& campaign, const std::vector<CrewId>& seats, const std::vector<ConvoyId>& escorts) {
			return rules::campaign::RunStart{.seats = seats, .escorts = escorts, .stage = rules::campaign::gameStage(campaign)};
		}

	} // namespace

	LoadOutScene::LoadOutScene(LoadOutArgs args)
		: route(args.route) {}

	void LoadOutScene::enter() {
		if (sessionOrMenu() == nullptr) {
			return;
		}
		build();
	}

	std::optional<std::string> LoadOutScene::startBlocker() const {
		const Session&	session = *game().session;
		const Campaign& campaign = session.campaign;
		if (seats.empty()) {
			return "Seat a driver";
		}
		if (seats.size() == 1) {
			const bool another = std::ranges::any_of(campaign.drivers, [&](const rules::campaign::DriverRecord& driver) {
				return driver.id != seats.front() && !rules::campaign::seatBlocker(campaign, driver.id, seats.front());
			});
			if (another) {
				return "Seat a second driver";
			}
		}
		Campaign tried = campaign;
		try {
			rules::campaign::startRun(tried, game().rules.content, runStart(tried, seats, escorts));
			if (const std::optional<rules::campaign::DepartBlocker> blocker =
					rules::campaign::departBlocker(tried, session.layers(), route)) {
				return departRefusalText(*blocker);
			}
		} catch (const std::invalid_argument& error) {
			return std::string(error.what());
		}
		return std::nullopt;
	}

	void LoadOutScene::build() {
		const Session&	 session = *game().session;
		const Campaign&	 campaign = session.campaign;
		const GameRules& loaded = game().rules;

		std::string where = "POI " + std::to_string(route.poi);
		for (const rules::map::RouteOffer& offer : rules::campaign::offersToday(campaign, session.layers())) {
			if (offer.destination.poi == route.poi && offer.route.route == route.route) {
				where = offer.destination.name + " by " + offer.route.name + ", " + std::to_string(offer.route.fuel) + " fuel";
			}
		}
		page = kit::openPage(*this, page, "Load out", where);

		ui::Ref<ui::Component> seated = kit::panel(page, "Seats", "seats");
		for (size_t place = 0; place < 2; ++place) {
			const std::string id = "seat_" + std::to_string(place + 1);
			if (place < seats.size()) {
				const CrewId driver = seats[place];
				kit::listRow(
					seated,
					id,
					"Driver " + std::to_string(place + 1) + ": " + rules::campaign::driverName(campaign, loaded.content, driver),
					"clear",
					[this, driver] { unseat(driver); }
				);
			} else {
				kit::listRow(seated, id, "Driver " + std::to_string(place + 1) + ": choose a driver", "", [] {}, true);
			}
		}

		ui::Ref<ui::Component> pool = kit::panel(page, "The pool", "pool");
		for (const rules::campaign::DriverRecord& driver : campaign.drivers) {
			const std::string id = "pool_" + driver.id.value;
			const auto		  at = std::ranges::find(seats, driver.id);
			if (at != seats.end()) {
				kit::listRow(
					pool,
					id,
					driverStanding(campaign, loaded.content, driver),
					"seat " + std::to_string(at - seats.begin() + 1),
					[this, crew = driver.id] { unseat(crew); },
					false,
					true
				);
				continue;
			}
			std::optional<CrewId>							  partner = seats.empty() ? std::nullopt : std::optional<CrewId>(seats.front());
			const std::optional<rules::campaign::SeatBlocker> blocker = rules::campaign::seatBlocker(campaign, driver.id, partner);
			const bool										  full = seats.size() >= 2;
			const std::string reason = blocker ? seatRefusalText(*blocker) : full ? std::string("Clear a seat first") : std::string();
			kit::listRow(
				pool,
				id,
				driverStanding(campaign, loaded.content, driver),
				reason,
				[this, crew = driver.id] { seat(crew); },
				blocker.has_value() || full
			);
		}

		if (!campaign.convoy.empty()) {
			ui::Ref<ui::Component> convoy = kit::panel(page, "Escorts", "escorts");
			for (const rules::campaign::ConvoyEscort& escort : campaign.convoy) {
				const bool along = std::ranges::find(escorts, escort.id) != escorts.end();
				kit::listRow(
					convoy,
					"escort_" + escort.id.value,
					loaded.content.escorts.at(escort.type).name,
					along ? "coming" : "staying",
					[this, id = escort.id, along] {
						if (along) {
							std::erase(escorts, id);
						} else {
							escorts.push_back(id);
						}
						build();
					},
					false,
					along
				);
			}
		}

		const std::optional<std::string> blocked = startBlocker();
		kit::button(page.footer, "start_run", "Start run", [this] { startRun(); }, ui::ButtonVariant::Primary, !blocked);
		kit::button(page.footer, "back", "Back to the map", [this] { app().scenes().switchTo(scenes::kAreaMap); });
		kit::setNotice(page, blocked.value_or(""));
	}

	void LoadOutScene::seat(const CrewId& driver) {
		if (seats.size() < 2) {
			seats.push_back(driver);
		}
		build();
	}

	void LoadOutScene::unseat(const CrewId& driver) {
		std::erase(seats, driver);
		build();
	}

	void LoadOutScene::startRun() {
		if (const std::optional<std::string> blocked = startBlocker()) {
			kit::setNotice(page, *blocked);
			return;
		}
		Session& session = *game().session;
		rules::campaign::startRun(session.campaign, game().rules.content, runStart(session.campaign, seats, escorts));
		rules::campaign::depart(session.campaign, session.layers(), route);
		if (!game().store.save(session.campaign)) {
			LOG_ERROR(Game, "LoadOutScene: the run left unsaved");
		}
		app().scenes().switchTo(scenes::kRun);
	}

	std::string LoadOutScene::exportState() const {
		nlohmann::json seated = nlohmann::json::array();
		for (const CrewId& driver : seats) {
			seated.push_back(driver.value);
		}
		nlohmann::json along = nlohmann::json::array();
		for (const ConvoyId& escort : escorts) {
			along.push_back(escort.value);
		}
		const std::optional<std::string> blocked = game().session ? startBlocker() : std::optional<std::string>("no campaign");
		return nlohmann::json{
			{"poi", route.poi},
			{"route", route.route},
			{"seats", seated},
			{"escorts", along},
			{"blocked", blocked ? nlohmann::json(*blocked) : nlohmann::json(nullptr)},
		}
			.dump();
	}

} // namespace game
