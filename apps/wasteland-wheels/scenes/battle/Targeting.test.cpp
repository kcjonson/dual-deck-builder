// The hand's targeting over real fights from the base pack: the steps each card shape asks for, every path through the
// options ending in the legal play it picked, previews that match what apply does to the real fight, the range chips,
// and the blocked labels.

#include "scenes/battle/Targeting.h"

#include <rules/battle/BattleTesting.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <initializer_list>
#include <optional>
#include <string_view>
#include <vector>

namespace game::battle {

	namespace {

		using namespace rules::fights;
		using rules::Lane;
		using rules::RoadLane;
		using rules::Row;

		const rules::DriverIndex  kFirst{0};
		const rules::DriverIndex  kSecond{1};
		const rules::VehicleIndex kFirstVehicle{0};

		rules::RaiderSeat raiderAt(std::string_view opponent, Lane lane, Row row) {
			rules::RaiderSeat placed = raider(opponent);
			placed.slot = rules::FormationSlot{.lane = lane, .row = row};
			return placed;
		}

		void giveAdrenaline(rules::BattleState& state) {
			for (rules::BattleDriver& driver : state.drivers) {
				if (driver.side == rules::Side::Player) {
					driver.adrenaline = 9;
				}
			}
		}

		// The Road Warrior inside center and the Interceptor behind it; across, the Scav Bike at center (vehicle 2) with
		// room behind it and the Rust Buggy ahead of it (vehicle 3).
		rules::BattleState duo(std::initializer_list<std::string_view> first, std::initializer_list<std::string_view> second = {}) {
			rules::BattleStart start =
				fight({seat("road_warrior"), seat("interceptor")}, {raider("scav_bike"), raiderAt("rust_buggy", Lane::Inside, Row::Ahead)});
			giveHand(start.state, kFirst, first);
			giveHand(start.state, kSecond, second);
			giveAdrenaline(start.state);
			return std::move(start.state);
		}

		// The Road Warrior with the Outrider (vehicle 1) and the Fuel Hauler (vehicle 2); the Scav Bike across.
		rules::BattleState escorted(std::initializer_list<std::string_view> hand) {
			rules::BattleStart start = convoy({seat("road_warrior")}, {"outrider", "fuel_hauler"}, {raider("scav_bike")});
			giveHand(start.state, kFirst, hand);
			giveAdrenaline(start.state);
			return std::move(start.state);
		}

		// A fight as the scene holds it: the state, legalActions' list for it, and a Targeting over both.
		struct Aim {
			explicit Aim(const rules::BattleState& from)
				: state(from),
				  legal(rules::legalActions(state, testContent())),
				  targeting(state, testContent(), legal) {}

			Aim(const Aim&) = delete;
			Aim& operator=(const Aim&) = delete;
			Aim(Aim&&) = delete;
			Aim& operator=(Aim&&) = delete;
			~Aim() = default;

			rules::BattleState		   state;
			std::vector<rules::Action> legal;
			Targeting				   targeting;

			[[nodiscard]] HandCard card(rules::DriverIndex driver, std::string_view id) const {
				const std::vector<rules::BattleCard>& hand = state.driver(driver).hand;
				const auto found = std::ranges::find(hand, rules::CardId{std::string(id)}, &rules::BattleCard::card);
				EXPECT_NE(found, hand.end()) << id;
				return HandCard{.driver = driver, .handIndex = static_cast<int>(found - hand.begin())};
			}

			[[nodiscard]] std::vector<size_t> playsOf(HandCard card) const {
				std::vector<size_t> found;
				for (size_t index = 0; index < legal.size(); ++index) {
					const auto* play = std::get_if<rules::action::PlayCard>(&legal[index]);
					if (play != nullptr && play->driver == card.driver && play->handIndex == card.handIndex) {
						found.push_back(index);
					}
				}
				return found;
			}

			// The picks down the first option of each step, and the play they make.
			[[nodiscard]] std::vector<AimPick> firstPicks(HandCard card) const {
				std::vector<AimPick> picks;
				for (std::vector<AimPick> offered = targeting.options(card, {}); !offered.empty();
					 offered = targeting.options(card, picks)) {
					picks.push_back(offered.front());
				}
				return picks;
			}
		};

		// Each path from `picks` down the options, ending in the play it names.
		void everyPath(const Aim& aim, HandCard card, std::vector<AimPick>& picks, std::vector<size_t>& reached) {
			const std::vector<AimPick> offered = aim.targeting.options(card, picks);
			if (!offered.empty()) {
				EXPECT_FALSE(aim.targeting.action(card, picks)) << "a play before the picks are done";
				for (const AimPick& pick : offered) {
					picks.push_back(pick);
					everyPath(aim, card, picks, reached);
					picks.pop_back();
				}
				return;
			}
			const std::optional<size_t> index = aim.targeting.action(card, picks);
			ASSERT_TRUE(index) << "complete picks with no play";
			reached.push_back(*index);
			const auto& play = std::get<rules::action::PlayCard>(aim.legal[*index]);
			EXPECT_EQ(play.driver, card.driver);
			EXPECT_EQ(play.handIndex, card.handIndex);
			std::optional<rules::VehicleIndex> vehicle;
			std::optional<rules::RoadSlot>	   slot;
			std::optional<rules::DriverIndex>  occupant;
			for (const AimPick& pick : picks) {
				vehicle = pick.vehicle ? pick.vehicle : vehicle;
				slot = pick.slot ? pick.slot : slot;
				occupant = pick.occupant ? pick.occupant : occupant;
			}
			EXPECT_EQ(play.target, vehicle);
			EXPECT_EQ(play.destination, slot);
			EXPECT_EQ(play.occupant, occupant);
		}

		void expectEveryPathLegal(const rules::BattleState& state) {
			const Aim aim(state);
			for (int driver = 0; driver < static_cast<int>(state.drivers.size()); ++driver) {
				if (state.drivers[static_cast<size_t>(driver)].side != rules::Side::Player) {
					continue;
				}
				for (int place = 0; place < static_cast<int>(state.drivers[static_cast<size_t>(driver)].hand.size()); ++place) {
					const HandCard		 card{.driver = rules::DriverIndex{driver}, .handIndex = place};
					std::vector<AimPick> picks;
					std::vector<size_t>	 reached;
					if (aim.targeting.playable(card)) {
						everyPath(aim, card, picks, reached);
					}
					std::ranges::sort(reached);
					EXPECT_EQ(reached, aim.playsOf(card))
						<< state.drivers[static_cast<size_t>(driver)].hand[static_cast<size_t>(place)].card.value;
				}
			}
		}

		// What the play did to each vehicle against what the preview said it would.
		void expectPreviewMatches(const rules::BattleState& before, const rules::BattleState& after, const AimPreview& preview) {
			for (int index = 0; index < static_cast<int>(before.vehicles.size()); ++index) {
				const rules::VehicleIndex	vehicle{index};
				const rules::BattleVehicle& was = before.vehicle(vehicle);
				const rules::BattleVehicle& is = after.vehicle(vehicle);
				const auto					lost = [&](std::optional<rules::DriverIndex> who) {
					 return who ? before.driver(*who).hitpoints - after.driver(*who).hitpoints : 0;
				};
				const auto	 hit = std::ranges::find(preview.hits, vehicle, &AimHit::vehicle);
				const AimHit expected = hit != preview.hits.end() ? *hit : AimHit{.vehicle = vehicle};
				EXPECT_EQ(expected.shield, was.shield - is.shield) << "vehicle " << index;
				EXPECT_EQ(expected.armor, was.armor - is.armor) << "vehicle " << index;
				EXPECT_EQ(expected.structure, was.structure - is.structure) << "vehicle " << index;
				EXPECT_EQ(expected.driverHp, lost(was.driver)) << "vehicle " << index;
				EXPECT_EQ(expected.passengerHp, lost(was.passenger)) << "vehicle " << index;
				EXPECT_EQ(expected.outOfFight, rules::vehicleInFight(before, vehicle) && !rules::vehicleInFight(after, vehicle));
				const auto move = std::ranges::find(preview.moves, vehicle, &AimMove::vehicle);
				if (move != preview.moves.end()) {
					EXPECT_EQ(move->from, was.slot);
					EXPECT_EQ(move->to, is.slot);
				} else {
					EXPECT_EQ(was.slot, is.slot) << "vehicle " << index << " moved unpreviewed";
				}
			}
		}

		// Previews the card down its first picks, makes the play on a copy, and checks one against the other.
		void expectPreviewIsThePlay(const rules::BattleState& state, rules::DriverIndex driver, std::string_view id) {
			const Aim					aim(state);
			const HandCard				card = aim.card(driver, id);
			const std::vector<AimPick>	picks = aim.firstPicks(card);
			const std::optional<size_t> index = aim.targeting.action(card, picks);
			ASSERT_TRUE(index) << id;
			const AimPreview				preview = aim.targeting.preview(card, picks);
			rules::BattleState				played = state;
			const std::vector<rules::Event> events = rules::apply(played, testContent(), aim.legal[*index]);
			SCOPED_TRACE(id);
			expectPreviewMatches(state, played, preview);
			const std::vector<rules::event::HitChecked> checks = eventsOf<rules::event::HitChecked>(events);
			for (const rules::event::HitChecked& check : checks) {
				const auto hit = std::ranges::find(preview.hits, check.defender, &AimHit::vehicle);
				ASSERT_NE(hit, preview.hits.end());
				EXPECT_EQ(hit->check, check);
			}
		}

	} // namespace

	TEST(Targeting, StepsFollowTheCardsShape) {
		const Aim  duoAim(duo({"strafe", "juke", "shoulder_check", "leapfrog", "medical_kit", "armor_plating"}));
		const auto stepsOf = [](const Aim& aim, std::string_view id) {
			const HandCard card = aim.card(kFirst, id);
			EXPECT_TRUE(aim.targeting.playable(card)) << id;
			return aim.targeting.steps(card);
		};
		using enum AimStep;
		EXPECT_EQ(stepsOf(duoAim, "strafe"), (std::vector{Slot, Vehicle})) << "the caster's swerve, then who it shoots from there";
		EXPECT_EQ(stepsOf(duoAim, "juke"), (std::vector{Slot}));
		EXPECT_EQ(stepsOf(duoAim, "shoulder_check"), (std::vector{Vehicle, Slot})) << "the raider, then where it's shoved";
		EXPECT_EQ(stepsOf(duoAim, "leapfrog"), (std::vector{Vehicle}));
		EXPECT_EQ(stepsOf(duoAim, "medical_kit"), (std::vector{Vehicle, Occupant}));
		EXPECT_TRUE(stepsOf(duoAim, "armor_plating").empty());

		const Aim convoyAim(escorted({"fall_in", "rally_the_convoy", "covering_fire"}));
		EXPECT_EQ(stepsOf(convoyAim, "fall_in"), (std::vector{Vehicle, Slot})) << "the escort, then where it goes";
		EXPECT_TRUE(stepsOf(convoyAim, "rally_the_convoy").empty());
		EXPECT_EQ(stepsOf(convoyAim, "covering_fire"), (std::vector{Vehicle}));

		const HandCard strafe = duoAim.card(kFirst, "strafe");
		for (const AimPick& slot : duoAim.targeting.options(strafe, {})) {
			EXPECT_TRUE(slot.slot && !slot.vehicle && !slot.occupant);
			for (const AimPick& raider : duoAim.targeting.options(strafe, std::vector{slot})) {
				EXPECT_TRUE(raider.vehicle && duoAim.state.vehicle(*raider.vehicle).side == rules::Side::Raiders);
			}
		}
	}

	TEST(Targeting, EveryPathThroughTheOptionsEndsInTheLegalPlayItPicked) {
		expectEveryPathLegal(
			duo({"strafe", "juke", "shoulder_check", "leapfrog", "medical_kit", "point_blank", "armor_plating"},
				{"headshot", "flank", "cut_off", "hard_brake", "test_slam"})
		);
		expectEveryPathLegal(escorted({"fall_in", "rally_the_convoy", "covering_fire", "close_ranks", "draw_fire", "leapfrog"}));
	}

	TEST(Targeting, APreviewIsWhatThePlayDoesToTheFight) {
		const rules::BattleState base = duo({"point_blank", "test_slam", "strafe", "shoulder_check", "juke"}, {"headshot", "leapfrog"});
		for (const std::string_view id : {"point_blank", "test_slam", "strafe", "shoulder_check", "juke"}) {
			expectPreviewIsThePlay(base, kFirst, id);
		}
		expectPreviewIsThePlay(base, kSecond, "headshot");
		expectPreviewIsThePlay(base, kSecond, "leapfrog");

		rules::BattleState wrecking = base;
		wrecking.vehicle(rules::VehicleIndex{2}).structure = 3;
		const Aim		 aim(wrecking);
		const AimPreview slam =
			aim.targeting.preview(aim.card(kFirst, "test_slam"), std::vector{AimPick{.vehicle = rules::VehicleIndex{2}}});
		ASSERT_EQ(slam.hits.size(), 1U);
		EXPECT_TRUE(slam.hits[0].outOfFight);
		EXPECT_GT(slam.hits[0].driverHp, 0) << "a vehicle hit splits between structure and the driver";
		EXPECT_EQ(slam.from, kFirstVehicle);
		expectPreviewIsThePlay(wrecking, kFirst, "test_slam");

		// An attack order acts from the escort that carries it out.
		const rules::BattleState		ordered = escorted({"covering_fire"});
		const Aim						orderAim(ordered);
		const HandCard					order = orderAim.card(kFirst, "covering_fire");
		const std::vector<AimPick>		picks = orderAim.firstPicks(order);
		rules::BattleState				played = ordered;
		const std::vector<rules::Event> events =
			rules::apply(played, testContent(), orderAim.legal[*orderAim.targeting.action(order, picks)]);
		const std::vector<rules::event::OrderCarried> carried = eventsOf<rules::event::OrderCarried>(events);
		ASSERT_EQ(carried.size(), 1U);
		EXPECT_EQ(orderAim.targeting.preview(order, picks).from, carried[0].escort);
		expectPreviewIsThePlay(ordered, kFirst, "covering_fire");
	}

	TEST(Targeting, IncompletePicksPreviewTheFirstPlayTheyAllow) {
		const Aim				   aim(duo({"strafe"}));
		const HandCard			   strafe = aim.card(kFirst, "strafe");
		const std::vector<AimPick> slots = aim.targeting.options(strafe, {});
		ASSERT_FALSE(slots.empty());
		const std::vector<AimPick> chosen{slots.front()};
		const std::vector<AimPick> raiders = aim.targeting.options(strafe, chosen);
		ASSERT_FALSE(raiders.empty());
		const AimPreview partial = aim.targeting.preview(strafe, chosen);
		EXPECT_EQ(partial, aim.targeting.preview(strafe, std::vector{slots.front(), raiders.front()}));
		ASSERT_EQ(partial.moves.size(), 1U);
		EXPECT_EQ(partial.moves[0].to, *slots.front().slot);
		EXPECT_EQ(aim.targeting.preview(strafe, {}), aim.targeting.preview(strafe, chosen));
	}

	TEST(Targeting, RangeChipsReadFromWhereTheCardActs) {
		const Aim				  aim(duo({"point_blank", "strafe", "armor_plating"}));
		const rules::VehicleIndex scavBike{2};
		const rules::VehicleIndex rustBuggy{3};

		const std::vector<RangeChip> shot = aim.targeting.ranges(aim.card(kFirst, "point_blank"), {});
		EXPECT_EQ(
			shot,
			(std::vector{
				RangeChip{.vehicle = scavBike, .range = 1, .inReach = true, .lands = true},
				RangeChip{.vehicle = rustBuggy, .range = 2, .inReach = false, .lands = false},
			})
		);
		EXPECT_EQ(aim.targeting.ranges(aim.card(kFirst, "point_blank"), std::vector{AimPick{.vehicle = rustBuggy}}), shot)
			<< "pointing at a raider out of reach changes nothing";
		EXPECT_TRUE(aim.targeting.ranges(aim.card(kFirst, "armor_plating"), {}).empty()) << "it lands on nobody on the road";

		const HandCard strafe = aim.card(kFirst, "strafe");
		EXPECT_TRUE(aim.targeting.ranges(strafe, {}).empty()) << "a slot step reads out only the slot under the pointer";
		for (const AimPick& slot : aim.targeting.options(strafe, {})) {
			const std::vector<AimPick>	 hovered{slot};
			const std::vector<AimPick>	 raiders = aim.targeting.options(strafe, hovered);
			const std::vector<RangeChip> chips = aim.targeting.ranges(strafe, hovered);
			ASSERT_EQ(chips.size(), 2U);
			for (const RangeChip& chip : chips) {
				EXPECT_EQ(chip.range, rules::slotRange(*slot.slot, aim.state.vehicle(chip.vehicle).slot));
				EXPECT_EQ(chip.inReach, chip.range <= 1);
				EXPECT_EQ(chip.lands, std::ranges::find(raiders, AimPick{.vehicle = chip.vehicle}) != raiders.end());
			}
		}
	}

	TEST(Targeting, CertainOnlyWhenEveryPlayDoesTheSameToTheRoad) {
		const Aim aim(duo({"point_blank", "test_slam", "strafe", "armor_plating"}));
		EXPECT_TRUE(aim.targeting.certain(aim.card(kFirst, "point_blank"))) << "one raider in reach";
		EXPECT_FALSE(aim.targeting.certain(aim.card(kFirst, "test_slam"))) << "either raider, the player's pick";
		EXPECT_TRUE(aim.targeting.certain(aim.card(kFirst, "strafe"))) << "one slot puts a raider in reach";
		EXPECT_TRUE(aim.targeting.certain(aim.card(kFirst, "armor_plating")));

		const Aim convoyAim(escorted({"fall_in"}));
		EXPECT_FALSE(convoyAim.targeting.certain(convoyAim.card(kFirst, "fall_in"))) << "which escort goes where is picked";
	}

	TEST(Targeting, AShoulderCheckOnABoxedInRaiderNeedsNoSlot) {
		rules::BattleStart start = fight(
			{seat("road_warrior")},
			{raider("scav_bike"), raiderAt("rust_buggy", Lane::Inside, Row::Ahead), raiderAt("spike_buggy", Lane::Inside, Row::Behind)}
		);
		giveHand(start.state, kFirst, {"shoulder_check"});
		giveAdrenaline(start.state);
		const Aim				   aim(start.state);
		const HandCard			   check = aim.card(kFirst, "shoulder_check");
		const std::vector<AimPick> raiders = aim.targeting.options(check, {});
		ASSERT_EQ(raiders, (std::vector{AimPick{.vehicle = rules::VehicleIndex{1}}}));
		EXPECT_TRUE(aim.targeting.options(check, raiders).empty());
		const std::optional<size_t> index = aim.targeting.action(check, raiders);
		ASSERT_TRUE(index);
		EXPECT_FALSE(std::get<rules::action::PlayCard>(aim.legal[*index]).destination);
	}

	TEST(Targeting, ABlockedCardSaysWhyAndAnUnaffordableOneDoesnt) {
		rules::BattleState state = duo({"point_blank", "test_pair", "armor_plating"}, {"point_blank", "armor_plating"});
		state.driver(kFirst).adrenaline = 0;
		{
			const Aim	   aim(state);
			const HandCard broke = aim.card(kFirst, "armor_plating");
			EXPECT_FALSE(aim.targeting.affordable(broke));
			EXPECT_FALSE(aim.targeting.playable(broke));
			EXPECT_FALSE(aim.targeting.blockLabel(broke)) << "its cost goes dark red instead";
			EXPECT_EQ(aim.targeting.blockLabel(aim.card(kFirst, "test_pair")), "CAN'T PLAY") << "free, and the rules don't play it yet";
		}
		state.driver(kFirst).adrenaline = 9;
		// The Interceptor's vehicle wrecked and the Interceptor riding with the Road Warrior.
		rules::BattleVehicle& wreck = state.vehicle(rules::VehicleIndex{1});
		wreck.structure = 0;
		wreck.onRoad = false;
		wreck.driver = std::nullopt;
		state.vehicle(kFirstVehicle).passenger = kSecond;
		{
			const Aim aim(state);
			EXPECT_FALSE(aim.targeting.blockLabel(aim.card(kFirst, "point_blank"))) << "playable";
			EXPECT_EQ(aim.targeting.blockLabel(aim.card(kFirst, "test_pair")), "CAN'T PLAY");
			EXPECT_EQ(aim.targeting.blockLabel(aim.card(kSecond, "point_blank")), "NO ATTACKS");
			EXPECT_TRUE(aim.targeting.playable(aim.card(kSecond, "armor_plating")));
		}

		rules::BattleStart distant = fight({seat("road_warrior")}, {raiderAt("scav_bike", Lane::Outside, Row::Ahead)});
		giveHand(distant.state, kFirst, {"point_blank"});
		const Aim farAim(distant.state);
		EXPECT_EQ(farAim.targeting.blockLabel(farAim.card(kFirst, "point_blank")), "NO TARGET");
		EXPECT_TRUE(farAim.targeting.steps(farAim.card(kFirst, "point_blank")).empty());
	}

} // namespace game::battle
