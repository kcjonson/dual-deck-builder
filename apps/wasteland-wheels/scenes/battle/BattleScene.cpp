#include "scenes/battle/BattleScene.h"

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "road/RoadLayout.h"
#include "road/RoadPicture.h"
#include "road/RoadView.h"
#include "scenes/battle/BattleLog.h"
#include "scenes/battle/Dock.h"
#include "scenes/battle/TopBar.h"
#include "scenes/battle/TurnBanner.h"

#include <ai/OpponentPolicies.h>
#include <ai/PlayFight.h>
#include <rules/battle/Battle.h>
#include <rules/battle/EnemyTurn.h>
#include <rules/battle/Waves.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstdlib>
#include <memory>
#include <utility>
#include <variant>

namespace game {

	using rules::Action;
	using rules::BattleState;
	using rules::DriverIndex;
	using rules::Phase;
	using rules::VehicleIndex;

	namespace {

		std::string phaseText(Phase phase) {
			switch (phase) {
				case Phase::Planning:
					return "the raiders are planning";
				case Phase::PlayerTurn:
					return "your turn";
				case Phase::EnemyTurn:
					return "the raiders' turn";
				case Phase::Over:
					return "over";
			}
			return "";
		}

		std::string endText(rules::Outcome outcome) {
			switch (outcome) {
				case rules::Outcome::Won:
					return "FIGHT WON";
				case rules::Outcome::Lost:
					return "CONVOY LOST";
				case rules::Outcome::BrokenOff:
					return "BROKEN OFF";
			}
			return "OVER";
		}

		void place(ui::Component* component, Foundation::Rect box) {
			component->setPosition({box.x, box.y});
			component->setSize({box.width, box.height});
		}

	} // namespace

	BattleScene::BattleScene(BattleArgs args)
		: fight(std::move(args.start.fight)) {}

	BattleScene::~BattleScene() = default;

	const ui::Theme& BattleScene::sceneTheme() const {
		return atlas::darkTheme();
	}

	void BattleScene::enter() {
		if (game().session) {
			seats = seatNames(game().session->campaign, game().rules.content);
		}
		if (!ui().icons().has("fuel")) {
			ui().icons().add(icons::iconAtlas());
		}
		build();
		const std::vector<battle::LogLine> opening{battle::matchupLine(fight.state, game().rules.content, seats)};
		log.get()->add(opening);
		ticker = opening.back().text;
		const BattleState before = fight.state;
		afterAction(before, {});
#ifdef SALAL_DEV_SERVER
		app::DevServer& server = app().devServer();
		devRoutes.push_back(server.stateProvider("battle", [this] { return exportState(); }));
		devRoutes.push_back(server.route("battle-act", [this](const app::DevRequest& request) {
			const auto found = request.params.find("index");
			char*	   end = nullptr;
			const long index = found == request.params.end() ? -1 : std::strtol(found->second.c_str(), &end, 10);
			if (index < 0 || static_cast<size_t>(index) >= legal.size() || (end != nullptr && *end != '\0')) {
				return app::DevResponse{.status = 400, .body = R"({"error":"index names no action on offer"})"};
			}
			act(static_cast<size_t>(index));
			return app::DevResponse{.body = exportState()};
		}));
		devRoutes.push_back(server.route("battle-play-out", [this](const app::DevRequest& /*request*/) {
			playOut();
			return app::DevResponse{.body = exportState()};
		}));
#endif
	}

	void BattleScene::build() {
		// Escape puts a waiting card back, or with none opens the menu, from wherever focus is in the fight. The menu's keys
		// are its own.
		ui::Ref<ui::Component> root = this->root().addChild<ui::Component>({
			.id = "battle",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.onKeyDown = [this](ui::KeyEvent& event) {
				if (event.type != ui::KeyEvent::Type::Cancel || top.get()->menuOpen()) {
					return;
				}
				if (pending) {
					cancelAim();
					event.consume();
				} else if (top.get()->openMenu()) {
					event.consume();
				}
			},
		});
		road = root.addChild<road::RoadView>({
			.id = "road",
			.aim = {
				.picks = [this](
							 const battle::HandCard& card
						 ) { return targeting ? targeting->options(card, {}) : std::vector<battle::AimPick>{}; },
				.anywhere = [this](
								const battle::HandCard& card
							) { return targeting && targeting->playable(card) && targeting->steps(card).empty(); },
				.preview =
					[this](const battle::HandCard& card, const battle::AimPick& pick) {
						const std::vector<battle::AimPick> picks{pick};
						return targeting->preview(card, picks);
					},
				.ranges =
					[this](const battle::HandCard& card, std::optional<battle::AimPick> hovered) {
						std::vector<battle::AimPick> picks;
						if (hovered) {
							picks.push_back(*hovered);
						}
						return targeting->ranges(card, picks);
					},
				.onDrop = [this](const battle::HandCard& card, std::optional<battle::AimPick> pick) { drop(card, pick); },
			},
			.onPick = [this](const battle::AimPick& chosen) { pick(chosen); },
		});
		top = root.addChild<battle::TopBar>({
			.id = "top_bar",
			.onToggleLog = [this] { toggleLog(); },
			.onMainMenu = [this] { app().scenes().switchTo(scenes::kMainMenu); },
		});
		dock = root.addChild<battle::Dock>({
			.id = "dock",
			.onEndTurn = [this] { endTurn(); },
			.onEndTurnPreview = [this](bool on) { road.get()->showIntentLines(on); },
			.onPresented =
				[this](std::optional<battle::HandCard> card) {
					if (dragged || pending || !card || !targeting || !targeting->playable(*card)) {
						road.get()->present(std::nullopt, false);
						return;
					}
					road.get()->present(targeting->preview(*card, {}), targeting->certain(*card));
				},
			.onDragStart =
				[this](const battle::HandCard& card) {
					cancelAim();
					dragged = card;
					road.get()->present(std::nullopt, false);
				},
			.onDragEnd = [this](const battle::HandCard& /*card*/, bool /*dropped*/) { dragged.reset(); },
			.onLeave = [this] { leave(); },
		});
		// The drawer lies over the right of the road (Battle Screen Design 6) rather than narrowing it, since a road 320 px
		// narrower puts the tokens under x1 below 1920 wide. The banner crosses both.
		log = root.addChild<battle::LogDrawer>({.id = "log", .visible = false, .zIndex = 1});
		banner = root.addChild<battle::TurnBanner>({.id = "banner", .zIndex = 2});
		layOut();
	}

	// The keys the ui didn't take come here, focused somewhere or not (ui-design.md, a HUD's hotkeys), so L opens the log
	// from the fight's first frame.
	bool BattleScene::handleEvent(const foundation::InputEvent& event) {
		if (event.type != foundation::InputEvent::Type::KeyDown || event.key != foundation::Key::L || event.repeat ||
			top.get() == nullptr || top.get()->menuOpen()) {
			return false;
		}
		toggleLog();
		return true;
	}

	void BattleScene::onResize(const Renderer::Viewport& /*viewport*/) {
		if (road.get() != nullptr) {
			layOut();
		}
	}

	void BattleScene::layOut() {
		const road::Bands bands = road::bandsFor(ui().getViewport());
		place(top.get(), bands.topBar);
		place(dock.get(), bands.dock);
		// The road is the stage's width; its art runs past it by the bleed.
		road.get()->setPosition({bands.road.x, bands.road.y});
		road.get()->setBand({bands.road.width, bands.road.height}, bands.bleed);
		const float drawer = battle::LogDrawer::kWidth;
		place(log.get(), {bands.road.x + bands.road.width - drawer, bands.road.y, drawer, bands.road.height});
		const Foundation::Rect rows = road.get()->grid().rowsRect();
		place(banner.get(), {bands.road.x + rows.x, bands.road.y + rows.y, rows.width, rows.height});
	}

	void BattleScene::act(size_t index) {
		if (index >= legal.size()) {
			LOG_ERROR(Game, "BattleScene: action %zu of %zu on offer", index, legal.size());
			return;
		}
		land(playback.finish());
		cancelAim();
		const Action			  action = legal[index];
		const BattleState		  before = fight.state;
		std::vector<rules::Event> events = rules::apply(fight.state, game().rules.content, action);
		afterAction(before, std::move(events));
	}

	void BattleScene::playOut() {
		land(playback.finish());
		cancelAim();
		const std::unique_ptr<rules::Policy> standIn = ai::makePolicy(rules::Behavior{.policy = "first_playable"}, rules::Side::Player);
		const BattleState					 before = fight.state;
		ai::playFight(
			fight.state,
			game().rules.content,
			[&standIn](const BattleState& /*board*/, DriverIndex /*seat*/) -> const rules::Policy& { return *standIn; },
			game().rules.raiders.forRaiders()
		);
		const std::vector<battle::LogLine> played{
			{.turn = fight.state.turn, .text = "The rest of the fight played out.", .tone = battle::LogTone::Plain}
		};
		log.get()->add(played);
		afterAction(before, {});
	}

	void BattleScene::leave() {
		if (fight.state.phase != Phase::Over || leaving) {
			LOG_ERROR(Game, "BattleScene: leaving a fight that isn't over");
			return;
		}
		leaving = true;
		land(playback.finish());
		finish(std::move(fight));
	}

	void BattleScene::afterAction(const BattleState& before, std::vector<rules::Event> events) {
		const rules::Content& content = game().rules.content;
		if (fight.state.phase == Phase::Planning) {
			(void)rules::planEnemyTurn(fight.state, content, game().rules.raiders.forRaiders());
		}
		legal = rules::legalActions(fight.state, content);
		targeting = std::make_unique<battle::Targeting>(fight.state, content, legal);
		const bool paced = std::ranges::any_of(events, [](const rules::Event& event) {
			return std::holds_alternative<rules::event::RaiderActing>(event) || std::holds_alternative<rules::event::TurnStarted>(event);
		});
		settled = false;
		playback.start(before, fight.state, std::move(events));
		if (paced) {
			dock.get()->setLocked(true);
			road.get()->showIntentLines(false);
		}
		land(playback.advance(0.0));
	}

	void BattleScene::update(const app::FrameContext& frame) {
		if (playback.playing()) {
			land(playback.advance(frame.dt));
		}
	}

	void BattleScene::land(const std::vector<battle::Beat>& beats) {
		for (const battle::Beat& beat : beats) {
			showBeat(beat);
		}
		if (!playback.playing() && !settled) {
			settle();
		}
	}

	void BattleScene::showBeat(const battle::Beat& beat) {
		const rules::Content&			   content = game().rules.content;
		const std::vector<battle::LogLine> lines = battle::logLines(fight.state, content, beat.events, beat.turn, seats);
		if (!lines.empty()) {
			log.get()->add(lines);
			ticker = lines.back().text;
		}
		if (beat.opens) {
			banner.get()->announce(*beat.opens);
		}
		if (beat.settles) {
			return;
		}
		showRoad();
		const BattleState& shownState = playback.shown();
		road.get()->setActing(beat.acting ? rules::vehicleCarrying(shownState, *beat.acting) : std::nullopt);
		for (const rules::Event& event : beat.events) {
			if (const auto* hit = std::get_if<rules::event::VehicleDamaged>(&event)) {
				road.get()->popNumber(hit->vehicle, "-" + std::to_string(hit->damage), false);
			} else if (const auto* check = std::get_if<rules::event::HitChecked>(&event); check && !check->hit) {
				road.get()->popNumber(check->defender, "MISS", true);
			}
		}
		showTopBar();
	}

	void BattleScene::settle() {
		settled = true;
		const rules::Content& content = game().rules.content;
		const bool			  playerTurn = fight.state.phase == Phase::PlayerTurn;
		intents = playerTurn ? rules::intentsOf(fight.state, content) : std::vector<rules::Intent>{};
		arrivals = playerTurn ? rules::arrivalsOf(fight.state, content) : std::vector<rules::RoadSlot>{};
		road.get()->setActing(std::nullopt);
		showRoad();
		battle::DockPicture picture = battle::dockPicture(fight.state, content, *targeting, seats);
		if (fight.state.outcome) {
			picture.outcome = outcomeText(*fight.state.outcome);
			banner.get()->announceEnd(endText(*fight.state.outcome));
		}
		dock.get()->show(picture);
		dock.get()->setLocked(!playerTurn && !fight.state.outcome);
		showTopBar();
	}

	void BattleScene::showRoad() {
		road.get()->show(road::roadPicture(playback.shown(), game().rules.content, intents, arrivals, seats));
	}

	void BattleScene::showTopBar() {
		const BattleState&			   shownState = playback.shown();
		std::optional<battle::Carried> cargo;
		const std::optional<Session>&  session = game().session;
		if (session && session->campaign.run) {
			const rules::campaign::Resources& carried = session->campaign.run->cargo;
			cargo = battle::Carried{.scrap = carried.scrap, .fuel = carried.fuel};
		}
		top.get()->show({
			.wave = rules::waveOnRoad(shownState),
			.waves = shownState.reinforcements.total,
			.arriving = static_cast<int>(arrivals.size()),
			.turn = shownState.turn,
			.raidersActing = playback.playing(),
			.ticker = ticker,
			.logOpen = logOpen,
			.menu = !playback.playing() && !fight.state.outcome,
			.cargo = cargo,
		});
	}

	void BattleScene::drop(const battle::HandCard& card, std::optional<battle::AimPick> chosen) {
		std::vector<battle::AimPick> picks;
		if (chosen) {
			picks.push_back(*chosen);
		}
		choose(card, picks);
	}

	void BattleScene::pick(const battle::AimPick& chosen) {
		if (!pending) {
			LOG_ERROR(Game, "BattleScene: a pick with no card waiting for one");
			return;
		}
		std::vector<battle::AimPick> picks = pending->picks;
		picks.push_back(chosen);
		choose(pending->card, picks);
	}

	void BattleScene::choose(const battle::HandCard& card, const std::vector<battle::AimPick>& picks) {
		if (!targeting || playback.playing()) {
			return;
		}
		if (const std::optional<size_t> index = targeting->action(card, picks)) {
			act(*index);
			return;
		}
		const std::vector<battle::AimPick> options = targeting->options(card, picks);
		if (options.empty()) {
			LOG_ERROR(Game, "BattleScene: picks that make no play and offer nothing more");
			cancelAim();
			return;
		}
		pending = Pending{.card = card, .picks = picks};
		road.get()->wait(road::WaitingPick{.card = card, .chosen = picks, .options = options, .ranges = targeting->ranges(card, picks)});
	}

	void BattleScene::cancelAim() {
		if (pending) {
			pending.reset();
			road.get()->wait(std::nullopt);
		}
	}

	std::optional<size_t> BattleScene::endTurnIndex() const {
		const auto found =
			std::ranges::find_if(legal, [](const Action& action) { return std::holds_alternative<rules::action::EndTurn>(action); });
		return found == legal.end() ? std::nullopt : std::optional<size_t>(static_cast<size_t>(found - legal.begin()));
	}

	void BattleScene::endTurn() {
		if (playback.playing()) {
			return;
		}
		cancelAim();
		if (const std::optional<size_t> index = endTurnIndex()) {
			act(*index);
		}
	}

	void BattleScene::toggleLog() {
		logOpen = !logOpen;
		log.get()->setVisible(logOpen);
		showTopBar();
	}

	std::string BattleScene::actionText(const Action& action) const {
		if (const auto* play = std::get_if<rules::action::PlayCard>(&action)) {
			const rules::BattleDriver& driver = fight.state.driver(play->driver);
			return fighterName(fight.state, game().rules.content, play->driver, seats) + " plays " +
				   game().rules.content.cards.at(driver.hand[static_cast<size_t>(play->handIndex)].card).name + " " +
				   playText(fight.state, game().rules.content, *play, seats);
		}
		return "End the turn";
	}

	std::string BattleScene::exportState() const {
		nlohmann::json offered = nlohmann::json::array();
		for (const Action& action : legal) {
			offered.push_back(actionText(action));
		}
		const BattleState& state = fight.state;
		return nlohmann::json{
			{"encounter", fight.encounter.value},
			{"turn", state.turn},
			{"phase", phaseText(state.phase)},
			{"outcome", state.outcome ? nlohmann::json(outcomeText(*state.outcome)) : nlohmann::json(nullptr)},
			{"actions", offered},
			{"playing", playback.playing()},
			{"aiming", pending.has_value()},
			{"last", ticker},
		}
			.dump();
	}

} // namespace game
