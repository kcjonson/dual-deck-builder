#include "scenes/loadout/LoadOutScene.h"

#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Highlighter.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "cards/DriverCard.h"
#include "cards/EscortCard.h"
#include "scenes/crew/CustomizeScene.h"
#include "scenes/crew/DeckBuilder.h"
#include "scenes/map/Planning.h"
#include "scenes/map/RunRouteScene.h"

#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <stdexcept>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		using rules::campaign::Campaign;
		using rules::campaign::ConvoyId;
		using rules::campaign::CrewId;
		using rules::campaign::DriverRecord;

		constexpr float kSeatColumn = 112.0F;
		constexpr float kPoolItem = 120.0F;
		constexpr float kEscortItem = 96.0F;

		rules::campaign::RunStart
		runStart(const Campaign& campaign, const std::vector<CrewId>& seats, const std::vector<ConvoyId>& escorts) {
			return rules::campaign::RunStart{.seats = seats, .escorts = escorts, .stage = rules::campaign::gameStage(campaign)};
		}

		std::string lowered(std::string text) {
			std::ranges::transform(text, text.begin(), [](unsigned char letter) { return static_cast<char>(std::tolower(letter)); });
			return text;
		}

	} // namespace

	LoadOutScene::LoadOutScene(LoadOutArgs args)
		: route(args.route) {}

	const ui::Theme& LoadOutScene::sceneTheme() const {
		return atlas::theme();
	}

	void LoadOutScene::enter() {
		if (!ui().icons().has("food")) {
			ui().icons().add(icons::iconAtlas());
		}
		if (sessionOrMenu() == nullptr) {
			return;
		}
		const Campaign& campaign = game().session->campaign;
		if (!decksOut()) {
			// Calls 177 and 67: the first driver who can go, beside the first who can go with them, and every escort.
			for (const DriverRecord& driver : campaign.drivers) {
				if (seats.empty() && !rules::campaign::seatBlocker(campaign, driver.id, std::nullopt)) {
					seats.push_back(driver.id);
				}
			}
			for (const DriverRecord& driver : campaign.drivers) {
				if (seats.size() == 1 && driver.id != seats.front() && !rules::campaign::seatBlocker(campaign, driver.id, seats.front())) {
					seats.push_back(driver.id);
				}
			}
			for (const rules::campaign::ConvoyEscort& escort : campaign.convoy) {
				if (escorts.size() < static_cast<size_t>(rules::campaign::kMostEscorts)) {
					escorts.push_back(escort.id);
				}
			}
		}
		build();
		if (ui::Component* start = crew::findUnder(ui(), sheet.get(), "back")) {
			start->focus();
		}
	}

	bool LoadOutScene::decksOut() const {
		const Campaign& campaign = game().session->campaign;
		return campaign.run.has_value() && !campaign.run->route.has_value();
	}

	std::vector<CrewId> LoadOutScene::seated() const {
		if (!decksOut()) {
			return seats;
		}
		std::vector<CrewId> out;
		for (const rules::campaign::RunDeck& deck : game().session->campaign.run->seats) {
			out.push_back(deck.driver);
		}
		return out;
	}

	std::vector<ConvoyId> LoadOutScene::along() const {
		return decksOut() ? game().session->campaign.run->escorts : escorts;
	}

	size_t LoadOutScene::seatsNeeded() const {
		const Campaign&			  campaign = game().session->campaign;
		const std::vector<CrewId> now = seated();
		if (now.empty()) {
			return 2;
		}
		const bool another = std::ranges::any_of(campaign.drivers, [&](const DriverRecord& driver) {
			return driver.id != now.front() && !rules::campaign::seatBlocker(campaign, driver.id, now.front());
		});
		return another ? 2 : 1;
	}

	std::optional<std::string> LoadOutScene::crewBlocker() const {
		const Campaign&			  campaign = game().session->campaign;
		const std::vector<CrewId> now = seated();
		if (now.empty()) {
			return "Seat a driver to start the run.";
		}
		if (now.size() < seatsNeeded()) {
			return "Seat two drivers to start the run.";
		}
		if (decksOut()) {
			return std::nullopt;
		}
		Campaign tried = campaign;
		try {
			rules::campaign::startRun(tried, game().rules.content, runStart(tried, now, along()));
		} catch (const std::invalid_argument& error) {
			return std::string(error.what());
		}
		return std::nullopt;
	}

	std::optional<std::string> LoadOutScene::startBlocker() const {
		if (std::optional<std::string> crew = crewBlocker()) {
			return crew;
		}
		const Session& session = *game().session;
		Campaign	   tried = session.campaign;
		try {
			if (!decksOut()) {
				rules::campaign::startRun(tried, game().rules.content, runStart(tried, seated(), along()));
			}
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
		const Campaign&	  campaign = game().session->campaign;
		const std::string focused = ui().focused().get() != nullptr ? ui().focused().get()->getId() : std::string();
		if (sheet.get() != nullptr) {
			root().get()->removeChild(sheet);
		}
		ui::Layout sheetLayout = crew::column(10.0F);
		sheetLayout.padding = ui::Edges(40.0F, 48.0F, 46.0F, 46.0F);
		sheet = root().addChild<atlas::Sheet>({
			.id = "sheet",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.layout = sheetLayout,
			.onKeyDown = [this](ui::KeyEvent& event) { keys(event); },
			.identity = "load_out",
		});
		heading(campaign);
		ui::Ref<ui::Component> body = sheet.addChild<ui::Component>({
			.id = "body",
			.size = {ui::kAuto, 0.0F},
			.minSize = {0.0F, 0.0F},
			.layout = crew::grown(crew::column(12.0F)),
			.overflow = ui::Overflow::Scroll,
		});
		seatsRow(body, campaign);
		ui::Ref<ui::Component> lower =
			body.addChild<ui::Component>({.id = "lower", .layout = crew::fixed(crew::row(12.0F, ui::AlignItems::Stretch))});
		pool(lower, campaign);
		convoy(lower, campaign);
		foot(campaign);
		crew::refocus(ui(), sheet.get(), focused, {"start_run", "back"});
	}

	void LoadOutScene::heading(const Campaign& campaign) {
		ui::Ref<ui::Component> row = sheet.addChild<ui::Component>({.layout = crew::fixed(crew::row(20.0F, ui::AlignItems::Start))});
		row.addChild<atlas::AtlasButton>({.id = "back", .layout = crew::fixed({}), .label = "Back to the route", .onPress = [this] {
											  back();
										  }});
		ui::Ref<ui::Component> words = row.addChild<ui::Component>({.minSize = {0.0F, 0.0F}, .layout = crew::grown(crew::column(4.0F))});
		ui::Ref<ui::Component> titleRow = words.addChild<ui::Component>({.layout = crew::row(16.0F, ui::AlignItems::End)});
		titleRow.addChild<ui::Text>({.id = "title", .layout = crew::fixed({}), .style = styles::screenTitle, .text = "Load out"});
		titleRow.addChild<ui::Text>({
			.id = "subtitle",
			.layout = {.flexGrow = 1.0F},
			.style = styles::subtitle,
			.text = "Drivers who die on a run are gone for good, with their run deck.",
			.wrap = true,
		});

		const Planning	   known = planning(*game().session);
		const Destination* destination = known.find(route.poi);
		ui::Layout		   lineLayout = crew::row(12.0F, ui::AlignItems::Center);
		lineLayout.flexWrap = ui::FlexWrap::Wrap;
		ui::Ref<ui::Component>		  line = words.addChild<ui::Component>({.id = "route_line", .layout = lineLayout});
		const rules::map::RouteOffer* offer = nullptr;
		if (destination != nullptr) {
			for (const rules::map::RouteOffer& candidate : destination->routes) {
				if (candidate.route.route == route.route) {
					offer = &candidate;
				}
			}
		}
		if (offer == nullptr) {
			line.addChild<ui::Text>({.id = "route_name", .style = styles::warning, .text = "No route picked"});
			return;
		}
		line.addChild<ui::Text>({.id = "route_destination", .style = styles::rowLabel, .text = destination->name});
		const auto item = [&](const std::string& id, const std::string& text, bool shortfall) {
			line.addChild<ui::Text>(
				{.id = id, .style = shortfall ? styles::warning.extend({.fontSize = 12.0F}) : styles::kicker, .text = text}
			);
		};
		const int fuelHeld = campaign.stores.fuel;
		item("route_name", "by " + lowered(offer->route.name), false);
		item("route_stops", counted(static_cast<int>(offer->outlook.stops.size()), "stop", "stops"), false);
		item(
			"route_fuel",
			fuelHeld < offer->route.fuel ? "fuel " + std::to_string(offer->route.fuel) + ", " + std::to_string(fuelHeld) + " held"
										 : "fuel " + std::to_string(offer->route.fuel),
			fuelHeld < offer->route.fuel
		);
		const std::string back = clockText(offer->outlook.back);
		item(
			"route_home", offer->outlook.spare >= 0.0 ? "home by " + back : "home by " + back + ", after dark", offer->outlook.spare < 0.0
		);
	}

	void LoadOutScene::seatsRow(ui::Ref<ui::Component> body, const Campaign& campaign) {
		ui::Ref<ui::Component> row =
			body.addChild<ui::Component>({.id = "seats", .layout = crew::fixed(crew::row(12.0F, ui::AlignItems::Stretch))});
		seatBox(row, campaign, 0);
		seatBox(row, campaign, 1);
	}

	void LoadOutScene::seatBox(ui::Ref<ui::Component> row, const Campaign& campaign, size_t place) {
		const GameRules&		  loaded = game().rules;
		const std::vector<CrewId> now = seated();
		const std::string		  id = "seat_" + std::to_string(place + 1);
		ui::Ref<atlas::LegendBox> box = row.addChild<atlas::LegendBox>({
			.id = id,
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F},
			.look =
				{.seed = atlas::paperSeed("load_out/" + id), .grab = place == 0 ? atlas::Corner::BottomLeft : atlas::Corner::BottomRight},
			.title = "Driver " + std::to_string(place + 1),
		});
		if (place >= now.size()) {
			const bool solo = place == 1 && now.size() == 1 && seatsNeeded() == 1;
			box.addChild<ui::Text>({
				.id = id + "_empty",
				.style = styles::quiet,
				.text = solo ? "Solo run: nobody else is fit to go." : "Choose a driver from the pool below.",
				.wrap = true,
			});
			return;
		}
		const DriverRecord&	   record = campaign.driver(now.at(place));
		ui::Ref<ui::Component> inside = box.addChild<ui::Component>({.layout = crew::row(16.0F, ui::AlignItems::Start)});
		ui::Ref<ui::Component> left = inside.addChild<ui::Component>({
			.size = {kSeatColumn, ui::kAuto},
			.layout = crew::fixed(crew::column(8.0F, ui::AlignItems::Stretch)),
		});
		cards::DriverFace	   face = cards::driverFace(campaign, loaded.content, record);
		face.tag.clear(); // the seat says it
		ui::Ref<ui::Component> cardRow = left.addChild<ui::Component>({.layout = crew::row(0.0F)});
		cardRow.addChild<cards::DriverCard>({.id = id + "_driver", .margin = ui::Edges(4.0F, 0.0F, 0.0F, 4.0F), .face = face});
		left.addChild<atlas::AtlasButton>({.id = id + "_clear", .label = "Clear seat", .compact = true, .onPress = [this, place] {
											   clearSeat(place);
										   }});
		const std::optional<std::string> blocked = crewBlocker();
		left.addChild<atlas::AtlasButton>({
			.id = id + "_customize",
			.enabled = !blocked,
			.label = "Customize",
			.compact = true,
			.onPress = [this, place] { customize(place); },
		});

		ui::Ref<ui::Component> right =
			inside.addChild<ui::Component>({.size = {0.0F, ui::kAuto}, .minSize = {0.0F, 0.0F}, .layout = crew::grown(crew::column(4.0F))});
		const rules::DriverDefinition& archetype = loaded.content.drivers.at(record.archetype);
		ui::Layout					   infoLayout = crew::row(10.0F, ui::AlignItems::End);
		infoLayout.flexWrap = ui::FlexWrap::Wrap;
		ui::Ref<ui::Component> info = right.addChild<ui::Component>({.layout = infoLayout});
		info.addChild<ui::Text>({.id = id + "_vehicle", .style = styles::rowLabel, .text = archetype.vehicle.name});
		info.addChild<ui::Text>({.id = id + "_specialty", .style = styles::kicker, .text = archetype.specialty});

		std::vector<crew::CardEntry> entries;
		int							 deckCards = 0;
		if (const rules::campaign::RunDeck* deck = campaign.runDeckOf(record.id); deck != nullptr && decksOut()) {
			for (const auto& [card, count] : deck->own) {
				entries.push_back({.key = card.value, .card = &loaded.content.cards.at(card), .copies = count});
				deckCards += count;
			}
			for (const auto& [card, count] : deck->borrowed) {
				entries.push_back(
					{.key = card.value + "-borrowed",
					 .card = &loaded.content.cards.at(card),
					 .copies = count,
					 .state = cards::MiniState::Borrowed}
				);
				deckCards += count;
			}
			for (const rules::campaign::EscortCard& escort : deck->escortCards) {
				entries.push_back(
					{.key = escort.broughtBy.value, .card = &loaded.content.cards.at(escort.card), .state = cards::MiniState::Locked}
				);
			}
		} else {
			for (const auto& [card, count] : record.defaultDeck) {
				entries.push_back({.key = card.value, .card = &loaded.content.cards.at(card), .copies = count});
				deckCards += count;
			}
		}
		crew::sortEntries(entries);
		right.addChild<ui::Text>(
			{.id = id + "_deck_caption", .style = styles::kicker, .text = "Deck / " + counted(deckCards, "card", "cards") + " / view only"}
		);
		crew::cardGrid(right, {.id = id + "_deck", .entries = std::move(entries), .seat = static_cast<int>(place)});
	}

	void LoadOutScene::pool(ui::Ref<ui::Component> row, const Campaign& campaign) {
		const GameRules&		  loaded = game().rules;
		const std::vector<CrewId> now = seated();
		ui::Ref<atlas::LegendBox> box = row.addChild<atlas::LegendBox>({
			.id = "pool",
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.4F},
			.look = {.seed = atlas::paperSeed("load_out/pool"), .grab = atlas::Corner::BottomLeft},
			.title = "Driver pool",
		});
		ui::Layout				  listLayout = crew::row(10.0F, ui::AlignItems::Start);
		listLayout.flexWrap = ui::FlexWrap::Wrap;
		ui::Ref<ui::Component> list = box.addChild<ui::Component>({
			.id = "pool_list",
			.layout = listLayout,
			.focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Both},
		});
		for (const DriverRecord& driver : campaign.drivers) {
			if (driver.status == rules::campaign::DriverStatus::Dead || driver.status == rules::campaign::DriverStatus::Missing) {
				continue;
			}
			const auto	at = std::ranges::find(now, driver.id);
			const bool	isSeated = at != now.end();
			std::string reason;
			bool		canSeat = false;
			if (isSeated) {
				reason = "In seat " + std::to_string(at - now.begin() + 1);
			} else {
				const std::optional<CrewId>						  partner = now.empty() ? std::nullopt : std::optional<CrewId>(now.front());
				const std::optional<rules::campaign::SeatBlocker> blocker = rules::campaign::seatBlocker(campaign, driver.id, partner);
				if (blocker) {
					reason = seatRefusalText(*blocker);
				} else if (now.size() >= 2) {
					reason = "Clear a seat first";
				} else {
					canSeat = true;
				}
			}
			const std::string	   id = "pool_" + driver.id.value;
			ui::Ref<ui::Component> item = list.addChild<ui::Component>({
				.id = id + "_item",
				.size = {kPoolItem, ui::kAuto},
				.layout = crew::fixed(crew::column(6.0F, ui::AlignItems::Center)),
			});
			cards::DriverFace	   face = cards::driverFace(campaign, loaded.content, driver);
			if (isSeated) {
				face.tag = "SEAT " + std::to_string(at - now.begin() + 1);
			}
			item.addChild<cards::DriverCard>({
				.id = id,
				.enabled = canSeat,
				.margin = ui::Edges(8.0F, 0.0F, 0.0F, 0.0F),
				.face = face,
				.faded = !canSeat && !isSeated,
				.onPress = [this, chosen = driver.id] { seat(chosen); },
			});
			item.addChild<atlas::AtlasButton>({
				.id = id + "_seat",
				.enabled = canSeat,
				.size = {ui::percent(100.0F), ui::kAuto},
				.label = isSeated ? "Seated" : "Seat",
				.compact = true,
				.onPress = [this, chosen = driver.id] { seat(chosen); },
			});
			if (!reason.empty()) {
				item.addChild<ui::Text>({
					.id = id + "_reason",
					.size = {ui::percent(100.0F), ui::kAuto},
					.style = styles::note.extend({.fontSize = 12.0F, .textAlign = Foundation::HorizontalAlign::Center}),
					.text = reason,
					.wrap = true,
				});
			}
		}
	}

	void LoadOutScene::convoy(ui::Ref<ui::Component> row, const Campaign& campaign) {
		const GameRules&			loaded = game().rules;
		const std::vector<CrewId>	now = seated();
		const std::vector<ConvoyId> going = along();
		ui::Ref<atlas::LegendBox>	box = row.addChild<atlas::LegendBox>({
			  .id = "convoy",
			  .size = {0.0F, ui::kAuto},
			  .minSize = {0.0F, 0.0F},
			  .layout = {.flexGrow = 1.0F},
			  .look = {.seed = atlas::paperSeed("load_out/convoy"), .grab = atlas::Corner::BottomRight},
			  .title = "Convoy",
		  });
		std::string					pair;
		if (now.size() == 2) {
			const DriverRecord& first = campaign.driver(now[0]);
			const DriverRecord& second = campaign.driver(now[1]);
			pair = rules::campaign::driverName(campaign, loaded.content, first.id) + " and " +
				   rules::campaign::driverName(campaign, loaded.content, second.id) + ": a " +
				   lowered(loaded.content.drivers.at(first.archetype).specialty) + " beside a " +
				   lowered(loaded.content.drivers.at(second.archetype).specialty) + ".";
		} else if (now.size() == 1 && seatsNeeded() == 1) {
			pair = "One driver and the escorts. No partner to cover a bad hand.";
		} else {
			pair = "Seat two drivers to see how they work together.";
		}
		ui::Ref<ui::Component> top = box.addChild<ui::Component>({.layout = crew::row(12.0F, ui::AlignItems::Start)});
		top.addChild<ui::Text>(
			{.id = "synergy", .size = {0.0F, ui::kAuto}, .layout = {.flexGrow = 1.0F}, .style = styles::body, .text = pair, .wrap = true}
		);
		top.addChild<atlas::AtlasButton>({
			.id = "swap_seats",
			.enabled = now.size() == 2,
			.layout = crew::fixed({}),
			.label = "Swap seats",
			.compact = true,
			.onPress = [this] { swapSeats(); },
		});
		box.addChild<ui::Text>({.id = "escort_caption", .style = styles::kicker, .text = "Escorts / press to bring or leave"});
		if (campaign.convoy.empty()) {
			box.addChild<ui::Text>({.id = "escort_none", .style = styles::quiet, .text = "No escorts in the convoy.", .wrap = true});
			return;
		}
		ui::Layout listLayout = crew::row(10.0F, ui::AlignItems::Start);
		listLayout.flexWrap = ui::FlexWrap::Wrap;
		ui::Ref<ui::Component> list = box.addChild<ui::Component>({
			.id = "escort_list",
			.layout = listLayout,
			.focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Horizontal},
		});
		for (const rules::campaign::ConvoyEscort& escort : campaign.convoy) {
			const bool			   coming = std::ranges::find(going, escort.id) != going.end();
			const std::string	   id = "escort_" + escort.id.value;
			ui::Ref<ui::Component> item = list.addChild<ui::Component>({
				.id = id + "_item",
				.size = {kEscortItem, ui::kAuto},
				.layout = crew::fixed(crew::column(6.0F, ui::AlignItems::Center)),
			});
			cards::EscortFace	   face = cards::escortFace(escort, loaded.content);
			face.tag = coming ? "" : "STAYING";
			item.addChild<cards::EscortCard>({
				.id = id,
				.margin = ui::Edges(8.0F, 0.0F, 0.0F, 0.0F),
				.face = face,
				.faded = !coming,
				.onPress = [this, which = escort.id] { toggleEscort(which); },
			});
			ui::Layout markLayout = crew::row(0.0F);
			markLayout.padding = ui::Edges(2.0F, 8.0F);
			ui::Ref<atlas::Highlight> mark = item.addChild<atlas::Highlight>({
				.id = id + "_mark",
				.layout = markLayout,
				.identity = "load_out/" + escort.id.value,
				.marked = coming,
			});
			mark.addChild<ui::Text>({.id = id + "_state", .style = styles::kicker, .text = coming ? "Coming" : "At home"});
		}
	}

	void LoadOutScene::foot(const Campaign& campaign) {
		const std::optional<std::string> blocked = startBlocker();
		ui::Ref<ui::Component>			 row =
			sheet.addChild<ui::Component>({.id = "foot", .layout = crew::fixed(crew::row(16.0F, ui::AlignItems::Center))});
		std::string line;
		if (blocked) {
			line = *blocked;
		} else {
			int custom = 0;
			for (const CrewId& driver : seated()) {
				const rules::campaign::RunDeck* deck = campaign.runDeckOf(driver);
				custom += deck != nullptr && (!deck->leftHome.empty() || !deck->borrowed.empty()) ? 1 : 0;
			}
			const size_t needed = seatsNeeded();
			if (needed == 1) {
				line = custom == 0 ? "A solo run on the default deck." : "A solo run on a deck customized for this run.";
			} else {
				line = custom == 0	 ? "Both drivers take their default decks."
					   : custom == 1 ? "One run deck is customized for this run."
									 : "Both run decks are customized for this run.";
			}
			const size_t going = along().size();
			line += going == 0 ? " No escorts come along."
							   : " " + counted(static_cast<int>(going), "escort", "escorts") + " and their cards come along.";
		}
		if (!notice.empty()) {
			line = notice + " " + line;
		}
		row.addChild<ui::Text>({
			.id = "start_line",
			.size = {0.0F, ui::kAuto},
			.layout = {.flexGrow = 1.0F},
			.style =
				(blocked || !notice.empty() ? styles::warning : styles::note).extend({.textAlign = Foundation::HorizontalAlign::Right}),
			.text = line,
			.wrap = true,
		});
		row.addChild<atlas::AtlasButton>({
			.id = "start_run",
			.enabled = !blocked,
			.layout = crew::fixed({}),
			.label = "Start run",
			.road = atlas::Road::Highway,
			.shield = true,
			.onPress = [this] { startRun(); },
		});
	}

	void LoadOutScene::keys(ui::KeyEvent& event) {
		if (event.type == ui::KeyEvent::Type::Cancel) {
			back();
			event.consume();
		}
	}

	void LoadOutScene::unwind() {
		if (!decksOut()) {
			return;
		}
		seats = seated();
		escorts = along();
		rules::campaign::giveUpLoadOut(game().session->campaign);
		save();
	}

	void LoadOutScene::deal() {
		if (decksOut()) {
			return;
		}
		Campaign& campaign = game().session->campaign;
		rules::campaign::startRun(campaign, game().rules.content, runStart(campaign, seats, escorts));
		save();
	}

	void LoadOutScene::save() {
		notice = game().store.save(game().session->campaign) ? std::string() : std::string("The campaign couldn't be saved.");
	}

	void LoadOutScene::seat(const CrewId& driver) {
		unwind();
		if (seats.size() < 2 && std::ranges::find(seats, driver) == seats.end()) {
			seats.push_back(driver);
		}
		build();
	}

	void LoadOutScene::clearSeat(size_t place) {
		unwind();
		if (place < seats.size()) {
			seats.erase(seats.begin() + static_cast<std::ptrdiff_t>(place));
		}
		build();
	}

	void LoadOutScene::swapSeats() {
		unwind();
		if (seats.size() == 2) {
			std::swap(seats[0], seats[1]);
		}
		build();
	}

	void LoadOutScene::toggleEscort(const ConvoyId& escort) {
		const std::vector<ConvoyId> going = along();
		const bool					coming = std::ranges::find(going, escort) != going.end();
		if (decksOut()) {
			Campaign& campaign = game().session->campaign;
			if (coming) {
				rules::campaign::leaveEscort(campaign, escort);
			} else {
				rules::campaign::bringEscort(campaign, game().rules.content, escort);
			}
			save();
		} else if (coming) {
			std::erase(escorts, escort);
		} else {
			escorts.push_back(escort);
		}
		build();
	}

	void LoadOutScene::customize(size_t place) {
		if (crewBlocker()) {
			return;
		}
		deal();
		const std::vector<CrewId> now = seated();
		if (place >= now.size()) {
			return;
		}
		app().scenes().push<CustomizeScene>(CustomizeArgs{.driver = now.at(place)}, [this](CustomizeDone&&) { build(); });
	}

	void LoadOutScene::startRun() {
		if (startBlocker()) {
			return;
		}
		deal();
		Session& session = *game().session;
		rules::campaign::depart(session.campaign, session.layers(), route);
		if (!game().store.save(session.campaign)) {
			LOG_ERROR(Game, "LoadOutScene: the run left unsaved");
		}
		app().scenes().switchTo(scenes::kRun);
	}

	void LoadOutScene::back() {
		unwind();
		app().scenes().replace<RunRouteScene>(RunRouteArgs{.poi = route.poi});
	}

	std::string LoadOutScene::exportState() const {
		if (!game().session) {
			return "null";
		}
		nlohmann::json seatedNow = nlohmann::json::array();
		for (const CrewId& driver : seated()) {
			seatedNow.push_back(driver.value);
		}
		nlohmann::json going = nlohmann::json::array();
		for (const ConvoyId& escort : along()) {
			going.push_back(escort.value);
		}
		const std::optional<std::string> blocked = startBlocker();
		return nlohmann::json{
			{"poi", route.poi},
			{"route", route.route},
			{"seats", seatedNow},
			{"escorts", going},
			{"decksOut", decksOut()},
			{"blocked", blocked ? nlohmann::json(*blocked) : nlohmann::json(nullptr)},
		}
			.dump();
	}

} // namespace game
