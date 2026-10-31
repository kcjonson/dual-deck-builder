#include <ai/AggressiveFlanker.h>
#include <ai/IntentAware.h>
#include <ai/Mcts.h>
#include <ai/OpponentPolicies.h>
#include <ai/PlayFight.h>
#include <ai/Ramming.h>
#include <ai/RandomPlay.h>
#include <ai/Salvage.h>

#include <rules/battle/BattleTesting.h>
#include <rules/battle/Encounters.h>
#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <chrono>
#include <iostream>

namespace {

	using namespace rules;
	using namespace rules::fights;

	const ai::OpponentPolicies& basePolicies() {
		static const ai::OpponentPolicies policies(testContent());
		return policies;
	}

	Action chosen(const Policy& policy, const BattleState& state, uint32_t seed = 1) {
		foundation::Rng rng(seed);
		return policy.choose(state, testContent(), legalActions(state, testContent()), rng);
	}

	PolicyFor every(const Policy& policy) {
		return [&](const BattleState&, DriverIndex) -> const Policy& {
			return policy;
		};
	}

	// An encounter for the Road Warrior and the Interceptor, or the Road Warrior alone, its raiders on their own policies.
	BattleState packFight(uint32_t seed, std::string_view encounter = "scav_tail", bool alone = false) {
		BattleSetup setup{.players = {seat("road_warrior")}, .seed = seed};
		if (!alone) {
			setup.players.push_back(seat("interceptor"));
		}
		fieldEncounter(setup, testContent(), EncounterId{std::string(encounter)}, 0);
		return startBattle(setup, testContent()).state;
	}

	// A policy's decisions and the time they took.
	struct Timed final : Policy {
		const Policy&					 inner;
		mutable int						 decisions{0};
		mutable std::chrono::nanoseconds spent{0};

		explicit Timed(const Policy& timed)
			: inner(timed) {}

		[[nodiscard]] Action
		choose(const BattleState& board, const Content& content, std::span<const Action> actions, foundation::Rng& rng) const override {
			const auto started = std::chrono::steady_clock::now();
			Action	   action = inner.choose(board, content, actions, rng);
			spent += std::chrono::steady_clock::now() - started;
			++decisions;
			return action;
		}
	};

	TEST(IntentAware, TakesOutTheRaiderWhosePlanDoesTheMostHarm) {
		// The bare Rig against a Scav Bike planning one sure 10 and a Rust Buggy, one hit from out, planning two.
		BattleStart	 start = fight({seat("road_warrior")}, {raider("scav_bike"), raider("rust_buggy")});
		BattleState& state = start.state;
		state.vehicle(VehicleIndex{0}).armor = 0;
		state.driver(DriverIndex{2}).hitpoints = 1;
		giveHand(state, DriverIndex{1}, {"test_slam"});
		giveHand(state, DriverIndex{2}, {"test_slam", "test_slam"});
		(void)replan(state, AimAt(0));
		giveHand(state, DriverIndex{0}, {"test_slam"});

		const ai::Threat threat = ai::threatOf(state, testContent());
		EXPECT_EQ(threat.byRaider.at(1), 10) << "half of each hit to structure, half to the driver";
		EXPECT_EQ(threat.byRaider.at(2), 20);
		EXPECT_EQ(chosen(ai::IntentAware(ai::IntentAware::Weights{}), state), Action{play(0, 0, 2)});
		EXPECT_EQ(chosen(ai::AggressiveFlanker(ai::AggressiveFlanker::Weights{}), state), Action{play(0, 0, 1)})
			<< "the floor takes the bike, whose kill is a point more";
	}

	TEST(Strategies, RammingRamsAndSalvageGoesForTheDriver) {
		// The Road Warrior against a Rust Buggy, with a Headshot it would miss: Ramming Speed over everything.
		BattleStart ram = fight({seat("road_warrior")}, {raider("rust_buggy")});
		giveHand(ram.state, DriverIndex{0}, {"point_blank", "headshot", "ramming_speed"});
		EXPECT_EQ(chosen(ai::Ramming(ai::Ramming::Weights{}), ram.state), Action{play(0, 2, 1)});

		// The Interceptor's Precision Shot does the driver as much as a Headshot does, and the buggy's structure besides.
		BattleStart shot = fight({seat("interceptor")}, {raider("rust_buggy")});
		giveHand(shot.state, DriverIndex{0}, {"precision_shot", "headshot"});
		EXPECT_EQ(chosen(ai::Salvage(ai::Salvage::Weights{}), shot.state), Action{play(0, 1, 1)});
		EXPECT_EQ(chosen(ai::AggressiveFlanker(ai::AggressiveFlanker::Weights{}), shot.state), Action{play(0, 0, 1)});
	}

	TEST(PlayFight, AFightPlaysToItsEndWithNobodyAtTheControlsAndReplaysFromItsSeed) {
		const std::unique_ptr<Policy> standIn = ai::makePolicy(Behavior{.policy = "intent_aware"}, Side::Player);
		const auto					  played = [&] {
			   BattleState state = packFight(5);
			   ai::playFight(state, testContent(), every(*standIn), basePolicies().forRaiders());
			   return state;
		};
		const BattleState fought = played();
		EXPECT_EQ(fought.phase, Phase::Over);
		ASSERT_TRUE(fought.outcome.has_value());
		EXPECT_TRUE(played() == fought);
	}

	TEST(PlayFight, ACampaignFightPlaysOutAndWritesItsEndBack) {
		using namespace rules::campaigns;
		Campaign	 campaign = foundTestCampaign({"fuel_hauler", "outrider"});
		const CrewId warrior = crewOf(campaign, "road_warrior");
		const CrewId interceptor = crewOf(campaign, "interceptor");
		startRun(
			campaign, testContent(), RunStart{.seats = {warrior, interceptor}, .escorts = {ConvoyId{"escort-1"}, ConvoyId{"escort-2"}}}
		);
		const std::unique_ptr<Policy> standIn = ai::makePolicy(Behavior{.policy = "aggressive_flanker"}, Side::Player);
		CampaignFight				  fight = startCampaignFight(campaign, testContent(), EncounterId{"scav_tail"}).fight;
		ai::playFight(fight.state, testContent(), every(*standIn), basePolicies().forRaiders());
		const FightWriteBack written = writeBackFight(campaign, testContent(), fight);
		EXPECT_EQ(written.outcome, fight.state.outcome);

		// No hauler heals here, so a seat's record holds what the fight left them, or the revival.
		if (written.outcome != Outcome::Lost) {
			for (int seat = 0; seat < 2; ++seat) {
				const int left = fight.state.driver(DriverIndex{seat}).hitpoints;
				EXPECT_EQ(campaign.driver(written.seats[static_cast<size_t>(seat)].driver).hitpoints, left > 0 ? left : kReviveHitpoints);
			}
		}
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);
	}

	TEST(Mcts, ReplaysIdenticallyForASeedAndBeatsRandomOverAFixedSetOfFights) {
		const ai::Mcts		 search(ai::Mcts::Weights{.iterations = 24, .exploration = 1});
		const ai::RandomPlay random;
		BattleState			 board = packFight(2);
		(void)planEnemyTurn(board, testContent(), basePolicies().forRaiders());
		EXPECT_EQ(chosen(search, board, 9), chosen(search, board, 9));

		const Timed timed(search);
		int			searchWon = 0;
		int			randomWon = 0;
		double		searchLeft = 0;
		double		randomLeft = 0;
		for (uint32_t seed = 1; seed <= 4; ++seed) {
			BattleState searched = packFight(seed, "spike_crew", true);
			ai::playFight(searched, testContent(), every(timed), basePolicies().forRaiders());
			BattleState guessed = packFight(seed, "spike_crew", true);
			ai::playFight(guessed, testContent(), every(random), basePolicies().forRaiders());
			searchWon += searched.outcome == Outcome::Won ? 1 : 0;
			randomWon += guessed.outcome == Outcome::Won ? 1 : 0;
			searchLeft += ai::Mcts::valueOf(searched, Side::Player);
			randomLeft += ai::Mcts::valueOf(guessed, Side::Player);
		}
		EXPECT_GT(searchWon, randomWon);
		EXPECT_GT(searchLeft, randomLeft);
		const double perDecision = std::chrono::duration<double, std::milli>(timed.spent).count() / std::max(1, timed.decisions);
		std::cout << "mcts, 24 playouts: " << timed.decisions << " decisions, " << perDecision << " ms each; won " << searchWon
				  << " of 4 to random's " << randomWon << "\n";
	}

} // namespace
