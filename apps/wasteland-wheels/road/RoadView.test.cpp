// The road component (road-view.md, targeting-preview.md, slot-targeting.md) headless through the App's frame and input:
// tokens in their slots at the spec's sizes and linting 0, updated in place and swerving on the animator, cards dragged
// onto tokens, slots and the road and dropped through Aim, asked once per card and pick, and a two-step play's picks.

#include "road/RoadView.h"
#include "GameTesting.h"

#include <nlohmann/json.hpp>

#include <string>
#include <utility>
#include <vector>

namespace {

	using namespace game;
	using game::battle::AimPick;
	using game::battle::HandCard;
	using game::road::RoadPicture;
	using game::road::RoadVehicle;
	using game::road::RoadView;
	using game::road::TokenData;
	using game::road::TokenSide;
	using game::road::VehicleToken;
	using rules::DriverIndex;
	using rules::RoadLane;
	using rules::RoadSlot;
	using rules::Row;
	using rules::VehicleIndex;
	using InputType = foundation::InputEvent::Type;

	constexpr HandCard kCard{.driver = DriverIndex{0}, .handIndex = 0};
	constexpr RoadSlot kEmptySlot{.lane = RoadLane::RaiderOutside, .row = Row::Behind};

	TokenData tokenFor(TokenSide side, std::optional<int> seat, const char* name) {
		return {
			.name = name,
			.side = side,
			.seat = seat,
			.structure = {.value = 20, .max = 30},
			.armor = 2,
			.driver = side == TokenSide::Escort ? std::nullopt : std::optional(road::Meter{.value = 12, .max = 20}),
			.speed = 4,
		};
	}

	RoadVehicle vehicle(int index, TokenData token, RoadSlot slot) {
		return {.index = VehicleIndex{index}, .token = std::move(token), .slot = slot, .reserved = std::nullopt, .aboard = {}};
	}

	// Two raiders across from your two driven vehicles and an escort.
	RoadPicture picture() {
		return {
			.vehicles =
				{vehicle(0, tokenFor(TokenSide::Raider, std::nullopt, "Scavenger"), {.lane = RoadLane::RaiderInside, .row = Row::Center}),
				 vehicle(1, tokenFor(TokenSide::Raider, std::nullopt, "Warlord"), {.lane = RoadLane::RaiderOutside, .row = Row::Ahead}),
				 vehicle(2, tokenFor(TokenSide::Player, 0, "Road Warrior 1"), {.lane = RoadLane::PlayerInside, .row = Row::Center}),
				 vehicle(3, tokenFor(TokenSide::Player, 1, "Interceptor 2"), {.lane = RoadLane::PlayerInside, .row = Row::Behind}),
				 vehicle(4, tokenFor(TokenSide::Escort, std::nullopt, "Outrider"), {.lane = RoadLane::PlayerOutside, .row = Row::Center})},
			.arrivals = {Row::Behind},
		};
	}

	Foundation::Vec2 middleOf(const Foundation::Rect& box) {
		return {box.x + box.width * 0.5F, box.y + box.height * 0.5F};
	}

	class RoadViews : public game::testing::GameTest {
	  protected:
		// What the road asked Aim, and what it was told to do.
		struct Asked {
			std::vector<AimPick>									 offer;
			bool													 anywhere = false;
			int														 picks = 0;
			int														 previews = 0;
			int														 ranges = 0;
			std::vector<std::pair<HandCard, std::optional<AimPick>>> drops;
			std::vector<AimPick>									 picked;
		};

		road::Aim aim() {
			return {
				.picks =
					[this](const HandCard&) {
						++asked.picks;
						return asked.offer;
					},
				.anywhere = [this](const HandCard&) { return asked.anywhere; },
				.preview =
					[this](const HandCard&, const AimPick& pick) {
						++asked.previews;
						battle::AimPreview preview{.from = VehicleIndex{2}};
						if (pick.vehicle) {
							preview.hits.push_back({.vehicle = *pick.vehicle, .structure = 4, .driverHp = 3});
						}
						return preview;
					},
				.ranges =
					[this](const HandCard&, std::optional<AimPick> /*pick*/) {
						++asked.ranges;
						return std::vector<battle::RangeChip>{
							{.vehicle = VehicleIndex{0}, .range = 1, .inReach = true, .lands = true},
							{.vehicle = VehicleIndex{1}, .range = 4, .inReach = false, .lands = false},
						};
					},
				.onDrop = [this](const HandCard& card, std::optional<AimPick> pick) { asked.drops.emplace_back(card, pick); },
			};
		}

		// The road in its band at the window's size, and a card in the hand to drag onto it.
		void open(bool withCard = true) {
			start();
			openParts([this, withCard](ui::Ref<ui::Component> root) {
				const road::Bands bands = road::bandsFor({1280.0F, 800.0F});
				road = root.addChild<RoadView>({
					.id = "road",
					.position = bands.road.position(),
					.aim = aim(),
					.onPick = [this](const AimPick& pick) { asked.picked.push_back(pick); },
				});
				road.get()->setBand(bands.road.size(), bands.bleed);
				road.get()->show(picture());
				if (withCard) {
					const ui::Ref<ui::Component> card = root.addChild<ui::Component>({
						.id = "card",
						.position = {40.0F, 600.0F},
						.size = {128.0F, 180.0F},
						.pointerEvents = ui::PointerEvents::Auto,
						.focusable = true,
					});
					card.get()->setDragSource({.kind = std::string(battle::kCardDrag), .value = kCard});
				}
			});
		}

		[[nodiscard]] RoadView& view() { return *road.get(); }

		[[nodiscard]] Foundation::Vec2 middleOf(std::string_view id) {
			ui::Component* component = find(id);
			EXPECT_NE(component, nullptr) << id;
			return component != nullptr ? ::middleOf(component->screenBounds()) : Foundation::Vec2{};
		}

		// The card picked up and carried to `to`, released there unless `hold`.
		void dragTo(Foundation::Vec2 to, bool hold = false) {
			const Foundation::Vec2 from = middleOf("card");
			platform->push({.type = InputType::PointerMove, .position = from});
			platform->push({.type = InputType::PointerDown, .mouseButton = foundation::MouseButton::Left, .position = from});
			platform->push({.type = InputType::PointerMove, .position = {from.x, from.y - 20.0F}});
			platform->push({.type = InputType::PointerMove, .position = to});
			frame();
			if (!hold) {
				platform->push({.type = InputType::PointerUp, .mouseButton = foundation::MouseButton::Left, .position = to});
				frame();
			}
		}

		void key(foundation::Key pressed) {
			platform->push({.type = InputType::KeyDown, .key = pressed});
			frame();
		}

		// Where a token of `data` sits in `slot`, in the window.
		[[nodiscard]] Foundation::Vec2 placeIn(RoadSlot slot, const TokenData& data) {
			const road::RoadGrid&  grid = view().grid();
			const Foundation::Rect box = grid.slotRect(slot);
			const float			   scale = VehicleToken::fitScale(box.size(), VehicleToken::heightFor(data), grid.tokenScale);
			const Foundation::Vec2 origin = view().screenBounds().position();
			return {
				origin.x + box.x + (box.width - VehicleToken::kWidth * scale) * 0.5F,
				origin.y + box.y + (box.height - VehicleToken::heightFor(data) * scale) * 0.5F,
			};
		}

		ui::Ref<RoadView> road;
		Asked			  asked;
	};

	TEST_F(RoadViews, EveryTokenSitsInItsSlotAtTheGridsScaleAndTheRoadLintsZeroAtEverySpecSize) {
		open(false);
		for (const Foundation::Vec2 window :
			 {Foundation::Vec2{1280.0F, 720.0F}, {1280.0F, 800.0F}, {1440.0F, 900.0F}, {1920.0F, 1080.0F}}) {
			const road::Bands bands = road::bandsFor(window);
			platform->resize(static_cast<int>(window.x), static_cast<int>(window.y));
			view().setPosition(bands.road.position());
			view().setBand(bands.road.size(), bands.bleed);
			EXPECT_EQ(lintAt(static_cast<int>(window.x), static_cast<int>(window.y)), "") << window.x << "x" << window.y;
			EXPECT_TRUE(view().grid().tokensFit);
			for (const RoadVehicle& vehicle : picture().vehicles) {
				const ui::Component* token = find("vehicle_" + std::to_string(vehicle.index.value));
				ASSERT_NE(token, nullptr);
				const Foundation::Rect box = token->screenBounds();
				EXPECT_NEAR(box.x, placeIn(vehicle.slot, vehicle.token).x, 0.01F);
				EXPECT_NEAR(box.y, placeIn(vehicle.slot, vehicle.token).y, 0.01F);
				EXPECT_FLOAT_EQ(view().token(vehicle.index)->scale(), view().grid().tokenScale);
			}
			// Each of the 18 slots has its target over its cell.
			const Foundation::Rect cell = view().grid().slotRect(kEmptySlot);
			const Foundation::Rect target = find("slot_4_2")->screenBounds();
			EXPECT_NEAR(target.x, bands.road.x + cell.x, 0.01F);
			EXPECT_NEAR(target.width, cell.width, 0.01F);
		}
		EXPECT_FLOAT_EQ(view().grid().laneWidth, 1550.0F / 6.0F) << "the stage capped at 1600";
	}

	TEST_F(RoadViews, ShowUpdatesTokensInPlaceAddsAndRemovesThemAndSwervesAChangedSlot) {
		open(false);
		VehicleToken* scavenger = view().token(VehicleIndex{0});
		ASSERT_NE(scavenger, nullptr);
		RoadPicture	   next = picture();
		const RoadSlot to{.lane = RoadLane::RaiderOutside, .row = Row::Behind};
		next.vehicles[0].slot = to;
		next.vehicles[0].token.structure.value = 5;
		next.vehicles.pop_back();
		next.vehicles.push_back(
			vehicle(5, tokenFor(TokenSide::Raider, std::nullopt, "Spike Raider"), {.lane = RoadLane::PlayerShoulder, .row = Row::Center})
		);
		const Foundation::Vec2 from = scavenger->screenBounds().position();
		view().show(next);
		EXPECT_EQ(view().token(VehicleIndex{0}), scavenger) << "kept, not rebuilt";
		EXPECT_EQ(scavenger->data().structure.value, 5);
		EXPECT_EQ(find("vehicle_4"), nullptr);
		EXPECT_NE(find("vehicle_5"), nullptr);
		EXPECT_TRUE(view().moving());
		EXPECT_EQ(scavenger->getZIndex(), 2) << "raised over the others while it moves";

		frame(0.1);
		const Foundation::Vec2 midway = scavenger->screenBounds().position();
		const Foundation::Vec2 there = placeIn(to, next.vehicles[0].token);
		EXPECT_GT(midway.y, from.y);
		EXPECT_LT(midway.y, there.y);
		for (int step = 0; step < 6; ++step) {
			frame(0.1);
		}
		EXPECT_FALSE(view().moving());
		EXPECT_EQ(scavenger->getZIndex(), std::nullopt);
		EXPECT_NEAR(scavenger->screenBounds().x, there.x, 0.01F);
		EXPECT_NEAR(scavenger->screenBounds().y, there.y, 0.01F);
	}

	TEST_F(RoadViews, UnderReducedMotionASwerveLandsOnTheFirstTick) {
		open(false);
		app->scenes().top()->ui().setReducedMotion(true);
		RoadPicture next = picture();
		next.vehicles[2].slot = {.lane = RoadLane::PlayerOutside, .row = Row::Ahead};
		view().show(next);
		frame();
		EXPECT_FALSE(view().moving());
		const Foundation::Vec2 there = placeIn(next.vehicles[2].slot, next.vehicles[2].token);
		EXPECT_NEAR(view().token(VehicleIndex{2})->screenBounds().y, there.y, 0.01F);
	}

	TEST_F(RoadViews, ACardDroppedOnATokenItOffersPlaysThereAndAimIsAskedOncePerCardAndPick) {
		open();
		asked.offer = {AimPick{.vehicle = VehicleIndex{0}}};
		dragTo(middleOf("vehicle_0"), true);
		const VehicleToken* aimed = view().token(VehicleIndex{0});
		EXPECT_TRUE(aimed->acceptsDrag());
		EXPECT_TRUE(aimed->isDropActive());
		EXPECT_FALSE(view().token(VehicleIndex{1})->acceptsDrag()) << "not one of the card's picks";
		EXPECT_FALSE(find("slot_4_2")->acceptsDrag());
		for (int step = 0; step < 5; ++step) {
			frame();
		}
		EXPECT_EQ(asked.picks, 1);
		EXPECT_EQ(asked.previews, 1);
		EXPECT_EQ(asked.ranges, 1);

		platform->push({.type = InputType::PointerUp, .mouseButton = foundation::MouseButton::Left, .position = middleOf("vehicle_0")});
		frame();
		ASSERT_EQ(asked.drops.size(), 1U);
		EXPECT_EQ(asked.drops[0].first, kCard);
		EXPECT_EQ(asked.drops[0].second, (AimPick{.vehicle = VehicleIndex{0}}));
	}

	TEST_F(RoadViews, ARefusedReleaseCancelsAndASlotPickDropsOnItsSlot) {
		open();
		asked.offer = {AimPick{.slot = kEmptySlot}};
		dragTo(middleOf("vehicle_1"));
		dragTo(middleOf("slot_4_0"));
		EXPECT_TRUE(asked.drops.empty()) << "a vehicle and a slot it doesn't offer refuse it";
		dragTo(middleOf("slot_4_2"));
		ASSERT_EQ(asked.drops.size(), 1U);
		EXPECT_EQ(asked.drops[0].second, (AimPick{.slot = kEmptySlot}));
	}

	TEST_F(RoadViews, ACardThatTakesNoPickPlaysWhereverItsDroppedOnTheRoad) {
		open();
		asked.anywhere = true;
		const Foundation::Rect band = find("road")->screenBounds();
		dragTo({band.x + band.width * 0.5F, band.y + road::kLaneHeader * 0.5F});
		dragTo(middleOf("vehicle_1"));
		ASSERT_EQ(asked.drops.size(), 2U);
		EXPECT_EQ(asked.drops[0].second, std::nullopt);
		EXPECT_EQ(asked.drops[1].second, std::nullopt);
	}

	TEST_F(RoadViews, AnOccupantPickTakesWhoeverRidesInTheRowItsDroppedOn) {
		open();
		RoadPicture carrying = picture();
		carrying.vehicles[2].token.passenger = road::Meter{.value = 9, .max = 20};
		carrying.vehicles[2].aboard = {DriverIndex{0}, DriverIndex{5}};
		view().show(carrying);
		frame();
		asked.offer = {AimPick{.occupant = DriverIndex{0}}, AimPick{.occupant = DriverIndex{5}}};
		const VehicleToken*	   rig = view().token(VehicleIndex{2});
		const Foundation::Rect box = rig->screenBounds();
		const float			   down = (VehicleToken::passengerRowY() + 8.0F) * rig->scale();
		dragTo({box.x + box.width * 0.6F, box.y + down});
		dragTo({box.x + box.width * 0.6F, box.y + 40.0F * rig->scale()});
		ASSERT_EQ(asked.drops.size(), 2U);
		EXPECT_EQ(asked.drops[0].second, (AimPick{.occupant = DriverIndex{5}})) << "the passenger's row";
		EXPECT_EQ(asked.drops[1].second, (AimPick{.occupant = DriverIndex{0}})) << "anywhere else on it, the driver";
	}

	TEST_F(RoadViews, TheKeysPickACardUpOntoTheOneTargetThatTakesItAndDropIt) {
		open();
		asked.offer = {AimPick{.vehicle = VehicleIndex{1}}};
		ASSERT_TRUE(find("card")->focus());
		key(foundation::Key::Enter);
		EXPECT_TRUE(view().token(VehicleIndex{1})->isDropActive());
		key(foundation::Key::Enter);
		ASSERT_EQ(asked.drops.size(), 1U);
		EXPECT_EQ(asked.drops[0].second, (AimPick{.vehicle = VehicleIndex{1}}));
	}

	TEST_F(RoadViews, ATwoStepPlayOffersItsNextPicksFocusedFirstAndAPressPicks) {
		open(false);
		view().wait(
			road::WaitingPick{
				.card = kCard,
				.chosen = {AimPick{.slot = kEmptySlot}},
				.options = {AimPick{.vehicle = VehicleIndex{0}}, AimPick{.vehicle = VehicleIndex{1}}},
				.ranges = {},
			}
		);
		frame();
		ui::Component* first = find("pick_vehicle_0");
		ASSERT_NE(first, nullptr);
		EXPECT_TRUE(first->isFocused());
		ASSERT_TRUE(press("pick_vehicle_1"));
		EXPECT_EQ(asked.picked, (std::vector<AimPick>{AimPick{.vehicle = VehicleIndex{1}}}));
		view().wait(std::nullopt);
		frame();
		EXPECT_EQ(find("pick_vehicle_0"), nullptr);
	}

	TEST_F(RoadViews, AHitsNumberRisesOffThePlateAndGoes) {
		open(false);
		view().popNumber(VehicleIndex{2}, "-6", false);
		view().setActing(VehicleIndex{0});
		nlohmann::json described;
		view().describe(described);
		EXPECT_EQ(described["pops"], 1);
		for (int step = 0; step < 10; ++step) {
			frame(0.1);
		}
		described.clear();
		view().describe(described);
		EXPECT_EQ(described["pops"], 0);
	}

	TEST_F(RoadViews, TwoHitsOnOneVehicleStackClearOfEachOtherThePlateAndTheRoadsEdges) {
		open(false);
		// The road as picture() has it, with a raider and an escort moved out to the shoulders, the road's outermost lanes.
		RoadPicture edges = picture();
		edges.vehicles[1].slot = {.lane = RoadLane::RaiderShoulder, .row = Row::Ahead};
		edges.vehicles[4].slot = {.lane = RoadLane::PlayerShoulder, .row = Row::Behind};
		view().show(edges);
		frame();
		const Foundation::Vec2 road = view().getSize();
		const auto			   overlap = [](const Foundation::Rect& a, const Foundation::Rect& b) {
			return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
		};
		for (const int index : {1, 2, 4}) {
			const VehicleToken* on = view().token(VehicleIndex{index});
			ASSERT_NE(on, nullptr) << index;
			view().popNumber(VehicleIndex{index}, "-12", false);
			view().popNumber(VehicleIndex{index}, "-3", false);
			for (int step = 0; step < 8; ++step) {
				const Foundation::Rect plate{
					on->getPosition().x + on->plateRect().x * on->scale(),
					on->getPosition().y + on->plateRect().y * on->scale(),
					on->plateRect().width * on->scale(),
					on->plateRect().height * on->scale(),
				};
				std::vector<Foundation::Rect> mine;
				for (const auto& popped : view().popBoxes()) {
					if (popped.vehicle == VehicleIndex{index}) {
						mine.push_back(popped.box);
					}
				}
				ASSERT_EQ(mine.size(), 2U);
				EXPECT_FALSE(overlap(mine[0], mine[1])) << "vehicle " << index << " step " << step;
				for (const Foundation::Rect& box : mine) {
					EXPECT_FALSE(overlap(box, plate)) << "vehicle " << index << " step " << step;
					EXPECT_GE(box.x, 0.0F) << "vehicle " << index << " step " << step;
					EXPECT_GE(box.y, 0.0F) << "vehicle " << index << " step " << step;
					EXPECT_LE(box.x + box.width, road.x) << "vehicle " << index << " step " << step;
					EXPECT_LE(box.y + box.height, road.y) << "vehicle " << index << " step " << step;
				}
				frame(0.1);
			}
		}
	}

	TEST_F(RoadViews, TheHandsPreviewAndTheEndTurnLinesDrawOverTheRoadUntilTakenDown) {
		open(false);
		RoadPicture planned = picture();
		planned.intents = {
			{.from = VehicleIndex{0}, .to = VehicleIndex{2}, .attack = true},
			{.from = VehicleIndex{1}, .to = std::nullopt, .attack = true},
		};
		planned.planned = {{.raider = VehicleIndex{1}, .to = kEmptySlot}};
		view().show(planned);
		view().showIntentLines(true);
		view().present(
			battle::AimPreview{
				.from = VehicleIndex{2},
				.hits = {{.vehicle = VehicleIndex{0}}, {.vehicle = VehicleIndex{3}}},
				.moves =
					{{.vehicle = VehicleIndex{2},
					  .from = planned.vehicles[2].slot,
					  .to = {.lane = RoadLane::PlayerInside, .row = Row::Ahead}}},
			},
			false
		);
		frame();
		nlohmann::json described;
		view().describe(described);
		EXPECT_EQ(described["presented"], true);
		EXPECT_EQ(described["intentLines"], true);
		view().present(std::nullopt, false);
		view().showIntentLines(false);
		frame();
		described.clear();
		view().describe(described);
		EXPECT_EQ(described["presented"], false);
		EXPECT_EQ(described["intentLines"], false);
	}

} // namespace
