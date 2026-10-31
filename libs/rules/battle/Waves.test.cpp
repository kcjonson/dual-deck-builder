#include <rules/battle/BattleTesting.h>
#include <rules/battle/Waves.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const DriverIndex kRoadWarrior{0};

	EncounterWave wave(std::initializer_list<std::string_view> raiders, std::optional<int> arriveAt, std::optional<int> afterTurns) {
		EncounterWave queued{.raiders = {}, .arriveAt = arriveAt, .afterTurns = afterTurns};
		for (const std::string_view raider : raiders) {
			queued.raiders.push_back(OpponentId{std::string(raider)});
		}
		return queued;
	}

	// The Road Warrior against a first wave with more queued, its raiders planning nothing.
	BattleStart withWaves(
		std::vector<RaiderSeat>	   raiders,
		std::vector<EncounterWave> queued,
		std::optional<int>		   roadCap = std::nullopt,
		uint32_t				   seed = 7
	) {
		BattleStart start = startBattle(
			BattleSetup{
				.players = {seat("road_warrior")},
				.raiders = std::move(raiders),
				.waves = std::move(queued),
				.roadCap = roadCap,
				.seed = seed,
			},
			testContent()
		);
		planIdle(start.state);
		return start;
	}

	// A sure 10 from the Road Warrior, which takes a Scav Bike's driver out.
	std::vector<Event> slam(BattleState& state, int vehicle) {
		giveHand(state, kRoadWarrior, {"test_slam"});
		return apply(state, testContent(), play(0, 0, vehicle));
	}

	RoadSlot raiderSlot(RoadLane lane, Row row) {
		return RoadSlot{.lane = lane, .row = row};
	}

	TEST(Waves, AWaveComesDueAtItsArrivalCountAndPullsInFromTheRowTheLatestWreckLeft) {
		// Scav Bikes inside center, behind, and ahead; two Rust Buggies due once two raiders are left.
		BattleStart start =
			withWaves({raider("scav_bike"), raider("scav_bike"), raider("scav_bike")}, {wave({"rust_buggy", "rust_buggy"}, 2, {})});
		BattleState& state = start.state;
		EXPECT_EQ(waveOnRoad(state), 1);
		EXPECT_TRUE(eventsOf<event::WaveDue>(start.events).empty());

		EXPECT_TRUE(eventsOf<event::WaveDue>(slam(state, 3)).empty()) << "due is checked as the player's turn starts";
		const std::vector<Event> second = endTurn(state);
		EXPECT_TRUE(eventsOf<event::RaiderArrived>(second).empty()) << "it wasn't due at the end of that enemy turn";
		EXPECT_TRUE((eventsOf<event::WaveDue>(second) == std::vector{event::WaveDue{.wave = 2}}));

		const std::vector<RoadSlot> marked = arrivalsOf(state, testContent());
		const std::vector<RoadSlot> expected{
			raiderSlot(RoadLane::RaiderInside, Row::Ahead), raiderSlot(RoadLane::RaiderOutside, Row::Ahead)
		};
		EXPECT_EQ(marked, expected) << "each lane from the row the wreck left";

		const std::vector<Event>				arrival = apply(state, testContent(), action::EndTurn{});
		const std::vector<event::RaiderArrived> arrived = eventsOf<event::RaiderArrived>(arrival);
		ASSERT_EQ(arrived.size(), 2U);
		EXPECT_TRUE((arrived[0] == event::RaiderArrived{.raider = DriverIndex{4}, .vehicle = VehicleIndex{4}, .slot = expected[0]}));
		EXPECT_TRUE((arrived[1] == event::RaiderArrived{.raider = DriverIndex{5}, .vehicle = VehicleIndex{5}, .slot = expected[1]}));
		EXPECT_EQ(waveOnRoad(state), 2);
		EXPECT_TRUE(state.reinforcements.queue.empty());
		EXPECT_EQ(state.driver(DriverIndex{4}).hand.size(), 5U) << "an arrival draws with everyone as the next turn starts";

		const std::vector<DriverIndex> planned = planners(plan(state, FirstOffered()));
		EXPECT_EQ(planned, (std::vector{DriverIndex{1}, DriverIndex{2}, DriverIndex{4}, DriverIndex{5}})) << "arrivals plan with the rest";
	}

	TEST(Waves, TheRoadCapHoldsBackWhatDoesntFitAndKeepsTheRestDue) {
		BattleStart start =
			withWaves({raider("scav_bike"), raider("scav_bike")}, {wave({"scav_bike", "scav_bike", "scav_bike"}, 2, {})}, 3);
		BattleState& state = start.state;
		EXPECT_TRUE((eventsOf<event::WaveDue>(start.events) == std::vector{event::WaveDue{.wave = 2}})) << "due at once";
		EXPECT_EQ(arrivalsOf(state, testContent()).size(), 1U) << "with room under the cap for one (call 207)";

		EXPECT_EQ(eventsOf<event::RaiderArrived>(endTurn(state)).size(), 1U);
		EXPECT_EQ(state.reinforcements.queue.front().raiders.size(), 2U);
		EXPECT_TRUE(state.reinforcements.due);
		EXPECT_EQ(waveOnRoad(state), 2);
		EXPECT_TRUE(arrivalsOf(state, testContent()).empty()) << "the road is at its cap";

		(void)slam(state, 1);
		EXPECT_EQ(arrivalsOf(state, testContent()).size(), 1U);
		EXPECT_EQ(eventsOf<event::RaiderArrived>(endTurn(state)).size(), 1U);
		EXPECT_EQ(raidersInFight(state), 3);
		EXPECT_EQ(state.reinforcements.queue.front().raiders.size(), 1U);
	}

	TEST(Waves, AnEmptyRoadBringsTheNextWaveWhoeverEmptiedIt) {
		BattleStart	 start = withWaves({raider("scav_bike")}, {wave({"scav_bike"}, {}, {}), wave({"scav_bike"}, {}, {})});
		BattleState& state = start.state;

		const std::vector<Event> cleared = slam(state, 1);
		EXPECT_TRUE((eventsOf<event::WaveDue>(cleared) == std::vector{event::WaveDue{.wave = 2}}));
		EXPECT_TRUE(eventsOf<event::FightEnded>(cleared).empty()) << "an empty road isn't a win with a wave queued";
		EXPECT_EQ(state.phase, Phase::PlayerTurn);
		EXPECT_EQ(eventsOf<event::RaiderArrived>(endTurn(state)).size(), 1U);

		// The arrival takes itself out at the end of its own turn, and the last wave pulls in behind it.
		state.vehicle(VehicleIndex{2}).statuses.push_back(VehicleStatus{.status = Status::DeathMark, .value = 0, .turns = std::nullopt});
		const std::vector<Event> marked = endTurn(state);
		EXPECT_EQ(eventsOf<event::DeathMarkTaken>(marked).size(), 1U);
		EXPECT_TRUE((eventsOf<event::WaveDue>(marked) == std::vector{event::WaveDue{.wave = 3}}));
		EXPECT_TRUE(
			(eventsOf<event::RaiderArrived>(marked) ==
			 std::vector{event::RaiderArrived{
				 .raider = DriverIndex{3}, .vehicle = VehicleIndex{3}, .slot = raiderSlot(RoadLane::RaiderInside, Row::Center)
			 }})
		);

		const std::vector<Event> won = slam(state, 3);
		EXPECT_TRUE((eventsOf<event::FightEnded>(won) == std::vector{event::FightEnded{.outcome = Outcome::Won, .rout = std::nullopt}}));
	}

	TEST(Waves, ACopiedFightReplaysThroughAnArrivalAndTheSeatsAlreadyInItDrawTheSame) {
		const auto opened = [](bool queued) {
			BattleStart start =
				withWaves({raider("rust_buggy")}, queued ? std::vector{wave({"scav_bike"}, {}, 1)} : std::vector<EncounterWave>{}, {}, 11);
			(void)endTurn(start.state);
			return start;
		};
		BattleStart	 start = opened(true);
		BattleState& state = start.state;
		EXPECT_TRUE(state.reinforcements.due) << "a turn count of 1 is due as turn 2 starts (call 193)";
		BattleState copy = state;

		const std::vector<Event> events = apply(state, testContent(), action::EndTurn{});
		EXPECT_TRUE(events == apply(copy, testContent(), action::EndTurn{}));
		EXPECT_TRUE(copy == state);
		ASSERT_EQ(eventsOf<event::RaiderArrived>(events).size(), 1U);
		const Event shuffled = event::DeckShuffled{.driver = DriverIndex{2}, .fromDiscard = false};
		EXPECT_NE(std::ranges::find(events, shuffled), events.end()) << "an arrival's deck shuffles as it pulls in";

		BattleStart alone = opened(false);
		(void)apply(alone.state, testContent(), action::EndTurn{});
		EXPECT_EQ(alone.state.driver(DriverIndex{1}).hand, state.driver(DriverIndex{1}).hand)
			<< "the arrival shuffles on a stream of its own";
		EXPECT_EQ(alone.state.driver(kRoadWarrior).hand, state.driver(kRoadWarrior).hand);
	}

} // namespace
