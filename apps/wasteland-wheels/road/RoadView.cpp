#include "road/RoadView.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "scenes/battle/BattleInk.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/components/Control.h>
#include <ui/theme/Tokens.h>
#include <utils/Log.h>

#include <nlohmann/json.hpp>

#include <glm/geometric.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <any>
#include <cctype>
#include <cmath>
#include <numbers>

namespace game::road {

	namespace {

		using battle::AimPick;
		using battle::HandCard;
		using cards::hex;
		using Foundation::Color;
		using Foundation::Rect;
		using Foundation::Vec2;
		using rules::RoadLane;
		using rules::RoadSlot;
		using rules::Row;
		using rules::VehicleIndex;
		namespace ink = battle::ink;
		namespace Primitives = Renderer::Primitives;

		constexpr Color kRoadGround = hex(0x151618);
		constexpr Color kTargetRed = hex(0xFF6A55);
		constexpr Color kInteraction = ink::kWarn;
		constexpr Color kPlannedEdge = hex(0xD4513F, 0.8F);
		constexpr Color kPlannedFill = hex(0xD4513F, 0.08F);
		constexpr Color kPlannedFaint = hex(0xD4513F, 0.3F);
		constexpr Color kLineAttack = hex(0xFF6A55, 0.8F);
		constexpr Color kLineOther = hex(0xA39E92, 0.8F);
		constexpr Color kClear{0.0F, 0.0F, 0.0F, 0.0F};

		constexpr float	 kStripe = 12.0F;
		constexpr float	 kLaneDashes = 26.0F;
		constexpr float	 kSlotInsetX = 6.0F;
		constexpr float	 kSlotInsetY = 4.0F;
		constexpr float	 kSlotRadius = 4.0F;
		constexpr float	 kHeaderFace = 12.0F;
		constexpr float	 kGutterFace = 11.0F;
		constexpr float	 kArcLift = 30.0F;
		constexpr float	 kArcLastControl = 40.0F;
		constexpr float	 kHead = 9.0F;
		constexpr double kPopMs = 900.0;
		constexpr float	 kPopRise = 28.0F;
		constexpr float	 kPopFace = 30.0F;
		// The row half of a swerve leads with the speed change (road-view.md): the theme has no emphasized curve, so it's
		// the TypeScript's ease_emphasized.
		const ui::Easing kEmphasized{0.16F, 1.0F, 0.3F, 1.0F};

		constexpr std::array<RoadLane, 6> kLanes{
			RoadLane::PlayerShoulder,
			RoadLane::PlayerOutside,
			RoadLane::PlayerInside,
			RoadLane::RaiderInside,
			RoadLane::RaiderOutside,
			RoadLane::RaiderShoulder,
		};
		constexpr std::array<Row, 3>		 kRows{Row::Ahead, Row::Center, Row::Behind};
		constexpr std::array<const char*, 6> kLaneNames{"RAIDER FLANK", "OUTSIDE", "INSIDE", "INSIDE", "OUTSIDE", "YOUR FLANK"};
		constexpr std::array<const char*, 3> kRowNames{"AHEAD", "CENTER", "BEHIND"};

		// The raiders' half of the road: their formation, and your shoulder, which only their flankers take.
		bool raidersLane(RoadLane lane) {
			return lane == RoadLane::PlayerShoulder || lane == RoadLane::RaiderInside || lane == RoadLane::RaiderOutside;
		}

		size_t slotIndex(RoadSlot slot) {
			return static_cast<size_t>(slot.lane) * kRows.size() + static_cast<size_t>(slot.row);
		}

		Rect inset(const Rect& box) {
			return {box.x + kSlotInsetX, box.y + kSlotInsetY, box.width - kSlotInsetX * 2.0F, box.height - kSlotInsetY * 2.0F};
		}

		Vec2 centreOf(const Rect& box) {
			return {box.x + box.width * 0.5F, box.y + box.height * 0.5F};
		}

		Color withAlpha(Color color, float alpha) {
			color.a = alpha;
			return color;
		}

		const HandCard* cardOf(const ui::Drag& drag) {
			return drag.kind == battle::kCardDrag ? std::any_cast<HandCard>(&drag.value) : nullptr;
		}

		std::string pickKey(const AimPick& pick) {
			if (pick.vehicle) {
				return "pick_vehicle_" + std::to_string(pick.vehicle->value);
			}
			if (pick.slot) {
				return "pick_slot_" + std::to_string(static_cast<int>(pick.slot->lane)) + "_" +
					   std::to_string(static_cast<int>(pick.slot->row));
			}
			return "pick_occupant_" + std::to_string(pick.occupant.value_or(rules::DriverIndex{-1}).value);
		}

		std::vector<Vec2> bezier(Vec2 from, Vec2 first, Vec2 second, Vec2 to) {
			constexpr int	  kSteps = 24;
			std::vector<Vec2> points;
			points.reserve(kSteps + 1);
			for (int step = 0; step <= kSteps; ++step) {
				const float t = static_cast<float>(step) / kSteps;
				const float u = 1.0F - t;
				points.push_back(u * u * u * from + 3.0F * u * u * t * first + 3.0F * u * t * t * second + t * t * t * to);
			}
			return points;
		}

		// A stroke along `points`, solid, or dotted for a line that hangs on a pick, with a head at its end.
		void drawArrow(std::span<const Vec2> points, Color color, bool dotted, int32_t key) {
			if (points.size() < 2) {
				return;
			}
			Primitives::drawPolyline({
				.points = points,
				.width = dotted ? 3.0F : 2.5F,
				.color = color,
				.cap = dotted ? Primitives::LineCap::Round : Primitives::LineCap::Butt,
				.dash = dotted ? std::optional(Foundation::DashPattern{.dash = 0.0F, .gap = 7.0F, .cap = Foundation::DashCap::Round})
							   : std::nullopt,
				.key = key,
			});
			const Vec2				  tip = points.back();
			const Vec2				  along = glm::normalize(tip - points[points.size() - 2]);
			const Vec2				  across{-along.y, along.x};
			const std::array<Vec2, 3> head{
				tip, tip - along * kHead + across * (kHead * 0.55F), tip - along * kHead - across * (kHead * 0.55F)
			};
			Primitives::drawPolygon({.vertices = head, .style = {.fill = color}, .key = key});
		}

		// The 135 degree hatch of the shoulders, `stripe` wide and as far apart across, over `ground`.
		void drawHatch(const Rect& box, Color ground, Color stripe, int32_t key) {
			Primitives::drawRect({.bounds = box, .style = {.fill = ground}, .key = key});
			Primitives::pushClip(box);
			const float step = kStripe * 2.0F * std::numbers::sqrt2_v<float>;
			for (float x = box.x - box.height; x < box.x + box.width + step; x += step) {
				Primitives::drawLine({
					.start = {x, box.y + box.height},
					.end = {x + box.height, box.y},
					.style = {.color = stripe, .width = kStripe},
					.key = key,
				});
			}
			Primitives::popClip();
		}

		// What the road draws through and hangs its drop targets on: a slot's target, and the ink over the tokens, which
		// takes no pointer.
		class Painter : public ui::Component {
		  public:
			struct Args {
				UI_COMMON_ARGS
				const char*										   type = "RoadPainter";
				std::function<void(const ui::Component&, int32_t)> paint;
				std::function<void(nlohmann::json&)>			   details;
			};

			explicit Painter(const Args& args)
				: type(args.type),
				  paint(args.paint),
				  details(args.details) {}

			[[nodiscard]] const char* typeName() const override { return type; }
			void					  describe(nlohmann::json& node) const override {
				 if (details) {
					 details(node);
				 }
			}

		  protected:
			void render() override {
				if (paint) {
					paint(*this, drawKey());
				}
			}
			[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::Auto; }

		  private:
			const char*										   type;
			std::function<void(const ui::Component&, int32_t)> paint;
			std::function<void(nlohmann::json&)>			   details;
		};

		// One of a waiting step's picks: a press, or the activate with focus on it, makes it.
		class PickSpot : public ui::Control {
		  public:
			struct Args {
				UI_COMMON_ARGS
				Color				  color;
				std::function<void()> onPress;
			};

			explicit PickSpot(const Args& args)
				: color(args.color),
				  onPress(args.onPress) {}

			[[nodiscard]] const char* typeName() const override { return "RoadPick"; }

		  protected:
			void activate() override { onPress(); }

			void render() override {
				ui::Control::render();
				const ui::InteractionState now = interaction();
				const bool				   lit = now.hovered || now.focused;
				cards::drawRounded(
					{0.0F, 0.0F, size.x, size.y},
					kSlotRadius,
					withAlpha(color, lit ? 0.12F : 0.05F),
					color,
					lit ? 3.0F : 2.0F,
					drawKey(),
					lit ? std::nullopt : std::optional(Foundation::DashPattern{.dash = 6.0F, .gap = 4.0F})
				);
			}

		  private:
			Color				  color;
			std::function<void()> onPress;
		};

		// A token's box and its plate's, in the road's space.
		struct Placed {
			Rect token;
			Rect plate;
		};

		// A link from one vehicle to another (hand-target-preview.md): up off the top of the first's plate and down onto
		// the top of the second's token over the raiders' pills, or between two in one lane the short way, bowed.
		std::vector<Vec2> linkBetween(const Placed& from, const Placed& to) {
			const Vec2 start{centreOf(from.plate).x, from.plate.y};
			if (std::abs(centreOf(from.token).x - centreOf(to.token).x) < 1.0F) {
				const bool	down = to.token.y > from.token.y;
				const Vec2	a{centreOf(from.plate).x, down ? from.token.y + from.token.height : from.token.y};
				const Vec2	b{centreOf(to.plate).x, down ? to.token.y : to.token.y + to.token.height};
				const float bow = 24.0F;
				return bezier(a, a + Vec2{bow, (b.y - a.y) * 0.3F}, b + Vec2{bow, (a.y - b.y) * 0.3F}, b);
			}
			const Vec2	end{centreOf(to.plate).x, to.token.y};
			const float lift = std::max(kLaneHeader + 4.0F, std::min(start.y, end.y) - kArcLift);
			return bezier(start, {start.x, lift}, {end.x, std::max(lift, end.y - kArcLastControl)}, end);
		}

	} // namespace

	RoadView::RoadView(const Args& args)
		: aim(args.aim),
		  onPick(args.onPick) {}

	void RoadView::onMount() {
		setIsolation(true);
		const ui::Ref<ui::Component> slotLayer =
			addChild<ui::Component>({.id = "road_slots", .size = {ui::percent(100.0F), ui::percent(100.0F)}});
		for (const RoadLane lane : kLanes) {
			for (const Row row : kRows) {
				const RoadSlot		   slot{.lane = lane, .row = row};
				const std::string	   id = "slot_" + std::to_string(static_cast<int>(lane)) + "_" + std::to_string(static_cast<int>(row));
				const ui::Ref<Painter> target = slotLayer.addChild<Painter>({
					.id = id,
					.type = "RoadSlot",
					.paint = [this, slot](const ui::Component& component, int32_t key) { renderSlot(component, slot, key); },
					.details =
						[slot](nlohmann::json& node) {
							node["lane"] = static_cast<int>(slot.lane);
							node["row"] = static_cast<int>(slot.row);
						},
				});
				target.get()->setDropTarget({
					.accepts =
						[this, slot](const ui::Drag& drag) {
							const HandCard* card = cardOf(drag);
							if (card == nullptr) {
								return false;
							}
							const AimCache& answers = aimFor(*card);
							return answers.anywhere || pickOn(answers, slot).has_value();
						},
					.onDrop = [this, slot](const ui::Drag& drag) { drop(drag, pickOn(aimFor(*cardOf(drag)), slot)); },
				});
				slotTargets.at(slotIndex(slot)) = target;
			}
		}
		tokenLayer = addChild<ui::Component>({.id = "road_tokens", .size = {ui::percent(100.0F), ui::percent(100.0F)}, .zIndex = 1});
		spotLayer = addChild<ui::Component>({.id = "road_picks", .size = {ui::percent(100.0F), ui::percent(100.0F)}, .zIndex = 3});
		inkLayer = addChild<Painter>({
			.id = "road_ink",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.zIndex = 4,
			.pointerEvents = ui::PointerEvents::None,
			.type = "RoadInk",
			.paint = [this](const ui::Component& /*ink*/, int32_t key) { renderInk(key); },
		});
		setDropTarget({
			.accepts =
				[this](const ui::Drag& drag) {
					const HandCard* card = cardOf(drag);
					return card != nullptr && aimFor(*card).anywhere;
				},
			.onDrop = [this](const ui::Drag& drag) { drop(drag, std::nullopt); },
		});
		placeSlots();
	}

	void RoadView::setBand(Foundation::Vec2 band, float spare) {
		roadGridNow = roadGrid(band);
		bleed = spare;
		setSize(ui::Size(band));
		placeSlots();
		// A resize lands every token where it's going.
		for (auto& [key, going] : swerves) {
			going.progress.cancel();
			landed[key] = going.to;
		}
		swerves.clear();
		for (const RoadVehicle& vehicle : shown.vehicles) {
			if (VehicleToken* token = this->token(vehicle.index)) {
				token->setZIndex(std::nullopt);
				token->setScale(tokenScaleFor(vehicle.token));
				token->setPosition(tokenPlace(landed.at(vehicle.index.value), vehicle.token));
			}
		}
		placeSpots();
	}

	void RoadView::placeSlots() {
		for (const RoadLane lane : kLanes) {
			for (const Row row : kRows) {
				const RoadSlot slot{.lane = lane, .row = row};
				if (ui::Component* target = slotTargets.at(slotIndex(slot)).get()) {
					const Rect box = roadGridNow.slotRect(slot);
					target->setPosition(box.position());
					target->setSize(ui::Size(box.size()));
				}
			}
		}
	}

	float RoadView::tokenScaleFor(const TokenData& data) const {
		return VehicleToken::fitScale(
			{roadGridNow.laneWidth, roadGridNow.rowHeight}, VehicleToken::heightFor(data), roadGridNow.tokenScale
		);
	}

	Foundation::Vec2 RoadView::tokenPlace(RoadSlot slot, const TokenData& data) const {
		const Rect	box = roadGridNow.slotRect(slot);
		const float scale = tokenScaleFor(data);
		return {
			box.x + (box.width - VehicleToken::kWidth * scale) * 0.5F,
			box.y + (box.height - VehicleToken::heightFor(data) * scale) * 0.5F,
		};
	}

	const RoadVehicle* RoadView::vehicleIn(VehicleIndex vehicle) const {
		const auto found = std::ranges::find(shown.vehicles, vehicle, &RoadVehicle::index);
		return found != shown.vehicles.end() ? &*found : nullptr;
	}

	VehicleToken* RoadView::token(VehicleIndex vehicle) const {
		const auto found = tokens.find(vehicle.value);
		return found != tokens.end() ? found->second.get() : nullptr;
	}

	void RoadView::show(const RoadPicture& picture) {
		std::erase_if(tokens, [&picture](const auto& entry) {
			return std::ranges::find(picture.vehicles, VehicleIndex{entry.first}, &RoadVehicle::index) == picture.vehicles.end();
		});
		std::erase_if(landed, [this](const auto& entry) { return !tokens.contains(entry.first); });
		std::erase_if(swerves, [this](const auto& entry) { return !tokens.contains(entry.first); });
		shown = picture;
		cache.reset();
		tokenLayer.get()->reconcileChildren(
			shown.vehicles,
			[](const RoadVehicle& vehicle) { return "vehicle_" + std::to_string(vehicle.index.value); },
			[this](const RoadVehicle& vehicle) {
				const VehicleIndex			index = vehicle.index;
				const ui::Ref<VehicleToken> made = tokenLayer.addChild<VehicleToken>({
					.id = "vehicle_" + std::to_string(index.value),
					.position = tokenPlace(vehicle.slot, vehicle.token),
					.data = vehicle.token,
					.scale = tokenScaleFor(vehicle.token),
					.look = [this, index] { return lookOf(index); },
				});
				made.get()->setDropTarget({
					.accepts =
						[this, index](const ui::Drag& drag) {
							const HandCard* card = cardOf(drag);
							if (card == nullptr) {
								return false;
							}
							const AimCache& answers = aimFor(*card);
							return answers.anywhere || pickOn(answers, index).has_value();
						},
					.onDrop = [this,
							   index](const ui::Drag& drag) { drop(drag, pickOn(aimFor(*cardOf(drag)), index, screenToLocal(drag.at))); },
				});
				tokens[index.value] = made;
				landed[index.value] = vehicle.slot;
				return ui::Ref<ui::Component>(made);
			},
			[this](ui::Component& child, const RoadVehicle& vehicle) {
				auto& token = static_cast<VehicleToken&>(child);
				token.setData(vehicle.token);
				token.setScale(tokenScaleFor(vehicle.token));
				const auto	   going = swerves.find(vehicle.index.value);
				const bool	   swerving = going != swerves.end() && going->second.progress.running();
				const RoadSlot heading = swerving ? going->second.to : landed.at(vehicle.index.value);
				if (heading != vehicle.slot) {
					swerve(vehicle.index, vehicle.slot);
				} else if (!swerving) {
					token.setPosition(tokenPlace(vehicle.slot, vehicle.token));
				}
			}
		);
	}

	void RoadView::swerve(VehicleIndex vehicle, RoadSlot to) {
		VehicleToken* moving = token(vehicle);
		if (moving == nullptr) {
			LOG_ERROR(Game, "RoadView: a swerve for vehicle %d, which has no token", vehicle.value);
			return;
		}
		const int		 key = vehicle.value;
		const ui::Theme& theme = getContext()->getTheme();
		const ui::Easing lane(theme.get(ui::tokens::motion::easing::standard));
		Swerve&			 going = swerves[key];
		going.from = moving->getPosition();
		going.to = to;
		moving->setZIndex(2);
		going.progress = moving->tween<float>({
			.from = 0.0F,
			.to = 1.0F,
			.durationMs = theme.get(ui::tokens::motion::duration::slow),
			.easing = ui::Easing(),
			.onUpdate =
				[this, key, lane](const float& progress) {
					VehicleToken* token = this->token(VehicleIndex{key});
					const auto	  going = swerves.find(key);
					if (token == nullptr || going == swerves.end()) {
						return;
					}
					const Vec2 from = going->second.from;
					const Vec2 to = tokenPlace(going->second.to, token->data());
					token->setPosition({from.x + (to.x - from.x) * lane(progress), from.y + (to.y - from.y) * kEmphasized(progress)});
				},
			.onComplete =
				[this, key] {
					if (const auto going = swerves.find(key); going != swerves.end()) {
						landed[key] = going->second.to;
					}
					if (VehicleToken* token = this->token(VehicleIndex{key})) {
						token->setZIndex(std::nullopt);
					}
				},
		});
	}

	bool RoadView::moving() const {
		return std::ranges::any_of(swerves, [](const auto& entry) { return entry.second.progress.running(); });
	}

	// --- Aiming ---

	const HandCard* RoadView::draggedCard() const {
		const ui::Drag* drag = getContext() != nullptr ? getContext()->drag() : nullptr;
		return drag != nullptr ? cardOf(*drag) : nullptr;
	}

	RoadView::AimCache& RoadView::aimFor(const HandCard& card) {
		if (!cache || cache->card != card) {
			cache.emplace(AimCache{.card = card, .picks = aim.picks(card), .anywhere = aim.anywhere(card)});
		}
		return *cache;
	}

	const battle::AimPreview& RoadView::previewFor(AimCache& answers, const AimPick& pick) {
		const auto found = std::ranges::find(answers.previews, pick, &std::pair<AimPick, battle::AimPreview>::first);
		if (found != answers.previews.end()) {
			return found->second;
		}
		return answers.previews.emplace_back(pick, aim.preview(answers.card, pick)).second;
	}

	const std::vector<battle::RangeChip>& RoadView::rangesFor(AimCache& answers, const std::optional<AimPick>& pick) {
		using Entry = std::pair<std::optional<AimPick>, std::vector<battle::RangeChip>>;
		const auto found = std::ranges::find(answers.ranges, pick, &Entry::first);
		if (found != answers.ranges.end()) {
			return found->second;
		}
		return answers.ranges.emplace_back(pick, aim.ranges(answers.card, pick)).second;
	}

	std::optional<AimPick> RoadView::pickOn(const AimCache& answers, VehicleIndex vehicle, std::optional<Vec2> at) const {
		for (const AimPick& pick : answers.picks) {
			if (pick.vehicle == vehicle) {
				return pick;
			}
		}
		const RoadVehicle* on = vehicleIn(vehicle);
		if (on == nullptr) {
			return std::nullopt;
		}
		std::vector<AimPick> aboard;
		for (const AimPick& pick : answers.picks) {
			if (pick.occupant && std::ranges::find(on->aboard, *pick.occupant) != on->aboard.end()) {
				aboard.push_back(pick);
			}
		}
		if (aboard.empty()) {
			return std::nullopt;
		}
		// Two people aboard to pick from: the passenger's row takes the passenger.
		const VehicleToken* shownToken = token(vehicle);
		if (aboard.size() > 1 && at && shownToken != nullptr && on->aboard.size() > 1) {
			const float				 down = (at->y - shownToken->getPosition().y) / shownToken->scale();
			const rules::DriverIndex who = down >= VehicleToken::passengerRowY() ? on->aboard[1] : on->aboard[0];
			for (const AimPick& pick : aboard) {
				if (pick.occupant == who) {
					return pick;
				}
			}
		}
		return aboard.front();
	}

	std::optional<AimPick> RoadView::pickOn(const AimCache& answers, RoadSlot slot) const {
		for (const AimPick& pick : answers.picks) {
			if (pick.slot == slot) {
				return pick;
			}
		}
		return std::nullopt;
	}

	std::optional<AimPick> RoadView::pickUnderDrag(const AimCache& answers) const {
		const ui::Drag* drag = getContext()->drag();
		for (const auto& [key, ref] : tokens) {
			if (const VehicleToken* under = ref.get(); under != nullptr && under->isDropActive()) {
				return pickOn(answers, VehicleIndex{key}, drag != nullptr ? std::optional(screenToLocal(drag->at)) : std::nullopt);
			}
		}
		for (const RoadLane lane : kLanes) {
			for (const Row row : kRows) {
				const RoadSlot slot{.lane = lane, .row = row};
				if (const ui::Component* under = slotTargets.at(slotIndex(slot)).get(); under != nullptr && under->isDropActive()) {
					return pickOn(answers, slot);
				}
			}
		}
		return std::nullopt;
	}

	void RoadView::drop(const ui::Drag& drag, std::optional<AimPick> pick) {
		const HandCard* card = cardOf(drag);
		if (card == nullptr) {
			LOG_ERROR(Game, "RoadView: a drop that carries no card");
			return;
		}
		const HandCard dropped = *card;
		aim.onDrop(dropped, std::move(pick));
	}

	TokenLook RoadView::lookOf(VehicleIndex vehicle) {
		TokenLook		   look;
		const RoadVehicle* on = vehicleIn(vehicle);
		VehicleToken*	   shownToken = token(vehicle);
		if (on == nullptr || shownToken == nullptr) {
			return look;
		}
		look.acting = acting == vehicle;
		const bool raider = on->token.side == TokenSide::Raider;
		look.outlineColor = raider ? kTargetRed : kInteraction;
		const auto chipFrom = [&look, vehicle](const std::vector<battle::RangeChip>& chips) {
			const auto chip = std::ranges::find(chips, vehicle, &battle::RangeChip::vehicle);
			if (chip != chips.end()) {
				look.rangeChip = chip->inReach ? "R" + std::to_string(chip->range) : "OUT";
				look.chipLands = chip->lands;
				look.dimmed = !chip->inReach;
			}
		};
		if (waiting) {
			const bool chosen = std::ranges::any_of(waiting->chosen, [on](const AimPick& pick) {
				return pick.vehicle == on->index || (pick.occupant && std::ranges::find(on->aboard, *pick.occupant) != on->aboard.end());
			});
			look.outline = chosen ? TokenLook::Outline::Chosen : TokenLook::Outline::None;
			if (raider) {
				chipFrom(waiting->ranges);
			}
			return look;
		}
		const HandCard* card = draggedCard();
		if (card == nullptr) {
			return look;
		}
		AimCache&					 answers = aimFor(*card);
		const std::optional<AimPick> pick = pickOn(answers, vehicle);
		if (pick && shownToken->acceptsDrag()) {
			if (shownToken->isDropActive()) {
				look.outline = TokenLook::Outline::Chosen;
				const std::optional<AimPick> under = pickUnderDrag(answers);
				const battle::AimPreview&	 preview = previewFor(answers, under.value_or(*pick));
				const auto					 hit = std::ranges::find(preview.hits, vehicle, &battle::AimHit::vehicle);
				if (hit != preview.hits.end()) {
					const bool escort = on->token.side == TokenSide::Escort;
					look.structureLoss = hit->structure;
					look.driverLoss = escort ? hit->passengerHp : hit->driverHp;
					look.passengerLoss = escort ? 0 : hit->passengerHp;
				}
			} else {
				look.outline = TokenLook::Outline::Legal;
			}
		}
		if (raider) {
			chipFrom(rangesFor(answers, pickUnderDrag(answers)));
		}
		return look;
	}

	// --- Waiting on a pick ---

	void RoadView::wait(std::optional<WaitingPick> next) {
		waiting = std::move(next);
		placeSpots();
		if (waiting && !waiting->options.empty()) {
			if (ui::Component* first = spotLayer.get()->getContext()->find(spotLayer.get()->getChildren().front())) {
				first->focus();
			}
		}
	}

	void RoadView::placeSpots() {
		if (spotLayer.get() == nullptr) {
			return;
		}
		const std::vector<AimPick> options = waiting ? waiting->options : std::vector<AimPick>{};
		const auto				   spotFor = [this](const AimPick& pick) -> std::pair<Rect, Color> {
			if (pick.slot) {
				return {inset(roadGridNow.slotRect(*pick.slot)), raidersLane(pick.slot->lane) ? kTargetRed : kInteraction};
			}
			const std::optional<VehicleIndex> vehicle = pick.vehicle ? pick.vehicle : [&]() -> std::optional<VehicleIndex> {
				for (const RoadVehicle& on : shown.vehicles) {
					if (std::ranges::find(on.aboard, pick.occupant.value_or(rules::DriverIndex{-1})) != on.aboard.end()) {
						return on.index;
					}
				}
				return std::nullopt;
			}();
			const RoadVehicle*	on = vehicle ? vehicleIn(*vehicle) : nullptr;
			const VehicleToken* shownToken = vehicle ? token(*vehicle) : nullptr;
			if (on == nullptr || shownToken == nullptr) {
				LOG_ERROR(Game, "RoadView: a pick on nothing on the road");
				return {{}, kInteraction};
			}
			const float scale = shownToken->scale();
			const Vec2	at = shownToken->getPosition();
			Rect		part = shownToken->plateRect();
			if (pick.occupant) {
				const bool	passengerRow = on->token.side != TokenSide::Escort && on->aboard.size() > 1 && *pick.occupant == on->aboard[1];
				const float top = VehicleToken::passengerRowY() - (passengerRow ? 0.0F : 20.0F);
				part = {part.x, top - 2.0F, part.width, 20.0F};
			}
			const Color color = on->token.side == TokenSide::Raider ? kTargetRed : kInteraction;
			return {
				{at.x + (part.x - 4.0F) * scale, at.y + (part.y - 4.0F) * scale, (part.width + 8.0F) * scale, (part.height + 8.0F) * scale},
				color
			};
		};
		spotLayer.get()->reconcileChildren(
			options,
			[](const AimPick& pick) { return pickKey(pick); },
			[this, &spotFor](const AimPick& pick) {
				const auto [box, color] = spotFor(pick);
				return ui::Ref<ui::Component>(spotLayer.addChild<PickSpot>({
					.id = pickKey(pick),
					.position = box.position(),
					.size = ui::Size(box.size()),
					.color = color,
					.onPress = [this, pick] { onPick(pick); },
				}));
			},
			[&spotFor](ui::Component& spot, const AimPick& pick) {
				const auto [box, color] = spotFor(pick);
				spot.setPosition(box.position());
				spot.setSize(ui::Size(box.size()));
			}
		);
	}

	// --- Marks ---

	void RoadView::present(std::optional<battle::AimPreview> preview, bool certain) {
		presented = std::move(preview);
		presentedCertain = certain;
	}

	void RoadView::showIntentLines(bool lines) {
		intentLines = lines;
	}

	void RoadView::popNumber(VehicleIndex vehicle, std::string text, bool miss) {
		const double started = getContext()->getClock().now();
		pops.push_back({.vehicle = vehicle, .text = std::move(text), .miss = miss, .started = started});
		after(kPopMs, [this, vehicle, started] {
			std::erase_if(pops, [vehicle, started](const Pop& pop) { return pop.vehicle == vehicle && pop.started == started; });
		});
	}

	void RoadView::setActing(std::optional<VehicleIndex> vehicle) {
		acting = vehicle;
	}

	void RoadView::describe(nlohmann::json& node) const {
		node["grid"] = {
			{"laneWidth", roadGridNow.laneWidth},
			{"rowHeight", roadGridNow.rowHeight},
			{"tokenScale", roadGridNow.tokenScale},
			{"tokensFit", roadGridNow.tokensFit},
		};
		node["vehicles"] = shown.vehicles.size();
		node["moving"] = moving();
		node["waiting"] = waiting ? waiting->options.size() : 0U;
		node["intentLines"] = intentLines;
		node["presented"] = presented.has_value();
		node["pops"] = pops.size();
	}

	// --- Drawing ---

	void RoadView::render() {
		if (getContext()->drag() == nullptr) {
			cache.reset();
		}
		const int32_t key = drawKey();
		renderLanes(key);
		renderHeader(key);
	}

	void RoadView::renderLanes(int32_t key) {
		const RoadGrid& grid = roadGridNow;
		const float		width = grid.band.x;
		const float		height = grid.band.y;
		const float		laneWidth = grid.laneWidth;
		Primitives::drawRect({.bounds = {-bleed, 0.0F, width + bleed * 2.0F, height}, .style = {.fill = kRoadGround}, .key = key});
		drawHatch({-bleed, 0.0F, grid.laneX[1] + bleed, height}, ink::kShoulderGround, ink::kShoulderStripe, key);
		drawHatch({grid.laneX[5], 0.0F, width + bleed - grid.laneX[5], height}, ink::kShoulderGround, ink::kShoulderStripe, key);
		for (size_t lane = 0; lane < kLanes.size(); ++lane) {
			const RoadLane which = kLanes.at(lane);
			if (which == RoadLane::PlayerOutside || which == RoadLane::PlayerInside) {
				continue;
			}
			const Color tint = which == RoadLane::RaiderShoulder ? ink::kPlayerShoulderTint : ink::kRaiderLaneTint;
			Primitives::drawRect({.bounds = {grid.laneX.at(lane), 0.0F, laneWidth, height}, .style = {.fill = tint}, .key = key});
		}
		// The lines between lanes: your formation's and the raiders' outer edges solid, the centre line yellow where the
		// inside lanes meet, the rest dashed.
		for (size_t line = 1; line < kLanes.size(); ++line) {
			const float x = grid.laneX.at(line);
			const bool	centre = line == 3;
			const bool	edge = line == 1 || line == 5;
			Primitives::drawLine({
				.start = {x, kLaneHeader},
				.end = {x, height},
				.style =
					{.color = centre ? ink::kCentreLine : (edge ? ink::kEdgeLine : ink::kLaneDash),
					 .width = centre ? 4.0F : 2.0F,
					 .dash = edge ? std::nullopt : std::optional(Foundation::DashPattern{.dash = kLaneDashes, .gap = kLaneDashes})},
				.key = key,
			});
		}

		// Empty slots, by where tokens have landed, not where they're headed; a planned swerve's slot is outlined instead.
		const HandCard* card = draggedCard();
		const bool		slotTargeting =
			(waiting && std::ranges::any_of(waiting->options, [](const AimPick& pick) { return pick.slot.has_value(); })) ||
			(card != nullptr && std::ranges::any_of(aimFor(*card).picks, [](const AimPick& pick) { return pick.slot.has_value(); }));
		for (const RoadLane lane : kLanes) {
			for (const Row row : kRows) {
				const RoadSlot slot{.lane = lane, .row = row};
				const bool	   taken = std::ranges::any_of(landed, [slot](const auto& entry) { return entry.second == slot; });
				const bool	   planned = std::ranges::find(shown.planned, slot, &PlannedMove::to) != shown.planned.end();
				const Rect	   box = inset(grid.slotRect(slot));
				if (planned) {
					cards::drawRounded(
						box, kSlotRadius, slotTargeting ? kClear : kPlannedFill, slotTargeting ? kPlannedFaint : kPlannedEdge, 2.0F, key
					);
					// The swerve mark: a lane change bending up and across.
					const Vec2				middle = centreOf(box);
					const std::vector<Vec2> bend = bezier(
						middle + Vec2{-7.0F, 9.0F}, middle + Vec2{-7.0F, -2.0F}, middle + Vec2{0.0F, -6.0F}, middle + Vec2{8.0F, -7.0F}
					);
					drawArrow(bend, slotTargeting ? kPlannedFaint : kPlannedEdge, false, key);
				} else if (!taken) {
					cards::drawRounded(
						box,
						kSlotRadius,
						kClear,
						raidersLane(lane) ? ink::kRaiderSlotOutline : ink::kSlotOutline,
						1.0F,
						key,
						Foundation::DashPattern{.dash = 6.0F, .gap = 4.0F}
					);
				}
			}
		}
	}

	void RoadView::renderHeader(int32_t key) {
		const RoadGrid& grid = roadGridNow;
		const float		width = grid.band.x;
		Primitives::drawRect({.bounds = {-bleed, 0.0F, width + bleed * 2.0F, kLaneHeader}, .style = {.fill = ink::kHeader}, .key = key});
		Primitives::drawRect(
			{.bounds = {-bleed, kLaneHeader - 1.0F, width + bleed * 2.0F, 1.0F}, .style = {.fill = ink::kHeaderRule}, .key = key}
		);
		for (size_t lane = 0; lane < kLanes.size(); ++lane) {
			cards::drawWords({
				.text = kLaneNames.at(lane),
				.at = {grid.laneX.at(lane), 0.0F},
				.face = fonts::kDisplaySemibold,
				.size = kHeaderFace,
				.color = raidersLane(kLanes.at(lane)) ? ink::kRaiderHeaderLabel : ink::kHeaderLabel,
				.align = Foundation::HorizontalAlign::Center,
				.boxWidth = grid.laneWidth,
				.boxHeight = kLaneHeader,
				.letterSpacing = kHeaderFace * 0.12F,
				.key = key,
			});
		}
		// The row gutter: each row's name turned up the road, in the raiders' red when a wave will pull into it.
		for (size_t row = 0; row < kRows.size(); ++row) {
			const bool	arriving = std::ranges::find(shown.arrivals, kRows.at(row)) != shown.arrivals.end();
			const float top = grid.rowY.at(row);
			if (arriving) {
				Primitives::drawRect(
					{.bounds = {kRoadPad, top + kSlotInsetY, 2.0F, grid.rowHeight - kSlotInsetY * 2.0F},
					 .style = {.fill = ink::kArrivalRow},
					 .key = key}
				);
			}
			const Vec2 middle{kRoadPad + kRowGutter * 0.5F, top + grid.rowHeight * 0.5F};
			glm::mat4  turn = glm::translate(glm::mat4(1.0F), glm::vec3(middle.x, middle.y, 0.0F));
			turn = glm::rotate(turn, -std::numbers::pi_v<float> * 0.5F, glm::vec3(0.0F, 0.0F, 1.0F));
			Primitives::PushTransform(turn);
			cards::drawWords({
				.text = kRowNames.at(row),
				.at = {-grid.rowHeight * 0.5F, -kRowGutter * 0.5F},
				.face = fonts::kMono,
				.size = kGutterFace,
				.color = arriving ? ink::kArrivalRow : ink::kDim,
				.align = Foundation::HorizontalAlign::Center,
				.boxWidth = grid.rowHeight,
				.boxHeight = kRowGutter,
				.letterSpacing = kGutterFace * 0.14F,
				.key = key,
			});
			Primitives::PopTransform();
		}
	}

	void RoadView::renderSlot(const ui::Component& target, RoadSlot slot, int32_t key) {
		const Rect	box = inset({0.0F, 0.0F, target.getSize().x, target.getSize().y});
		const Color color = raidersLane(slot.lane) ? kTargetRed : kInteraction;
		const auto	solid = [&] {
			 cards::drawRounded(box, kSlotRadius, withAlpha(color, 0.1F), color, 3.0F, key);
		};
		if (waiting) {
			if (std::ranges::find(waiting->chosen, AimPick{.slot = slot}) != waiting->chosen.end()) {
				solid();
			}
			return;
		}
		const HandCard* card = draggedCard();
		if (card == nullptr || !pickOn(aimFor(*card), slot) || !target.acceptsDrag()) {
			return;
		}
		if (target.isDropActive()) {
			solid();
		} else {
			cards::drawRounded(
				box, kSlotRadius, kClear, withAlpha(color, 0.8F), 2.0F, key, Foundation::DashPattern{.dash = 6.0F, .gap = 4.0F}
			);
		}
	}

	void RoadView::renderInk(int32_t key) {
		if (intentLines) {
			renderIntentLines(key);
		}
		if (presented) {
			renderArrows(key);
		}
		renderPops(key);
	}

	void RoadView::renderArrows(int32_t key) {
		const auto placedOf = [this](VehicleIndex vehicle) -> std::optional<Placed> {
			const VehicleToken* shownToken = token(vehicle);
			if (shownToken == nullptr) {
				return std::nullopt;
			}
			const float scale = shownToken->scale();
			const Vec2	at = shownToken->getPosition();
			const Rect	plate = shownToken->plateRect();
			return Placed{
				.token = {at.x, at.y, shownToken->getSize().x, shownToken->getSize().y},
				.plate = {at.x + plate.x * scale, at.y + plate.y * scale, plate.width * scale, plate.height * scale},
			};
		};
		const auto sideColor = [this](VehicleIndex vehicle) {
			const RoadVehicle* on = vehicleIn(vehicle);
			return withAlpha(on != nullptr && on->token.side == TokenSide::Raider ? kTargetRed : kInteraction, 0.8F);
		};
		if (presented->from) {
			if (const std::optional<Placed> from = placedOf(*presented->from)) {
				for (const battle::AimHit& hit : presented->hits) {
					const std::optional<Placed> to = placedOf(hit.vehicle);
					if (hit.vehicle == *presented->from || !to) {
						continue;
					}
					drawArrow(linkBetween(*from, *to), sideColor(hit.vehicle), !presentedCertain, key);
				}
			}
		}
		for (const battle::AimMove& move : presented->moves) {
			const std::optional<Placed> mover = placedOf(move.vehicle);
			if (!mover) {
				continue;
			}
			const Vec2 start = centreOf(mover->plate);
			const Vec2 end = centreOf(roadGridNow.slotRect(move.to));
			const Vec2 along = end - start;
			if (glm::length(along) < 1.0F) {
				continue;
			}
			// Bowed left of the way it goes, so two vehicles trading slots draw two arcs.
			const Vec2 left = Vec2{along.y, -along.x} * 0.2F;
			drawArrow(
				bezier(start, start + along * 0.33F + left, start + along * 0.66F + left, end),
				sideColor(move.vehicle),
				!presentedCertain,
				key
			);
		}
	}

	void RoadView::renderIntentLines(int32_t key) {
		std::map<int, int> pillOf;
		for (const IntentLine& line : shown.intents) {
			const VehicleToken* from = token(line.from);
			if (from == nullptr) {
				continue;
			}
			const int	pill = std::min(pillOf[line.from.value]++, VehicleToken::kMaxIntents - 1);
			const float scale = from->scale();
			// From the raider's pill, right-aligned along its top, to the top of each plate it hits.
			const Vec2 start{
				from->getPosition().x +
					(VehicleToken::kWidth - 30.0F - static_cast<float>(VehicleToken::kMaxIntents - 1 - pill) * 70.0F) * scale,
				from->getPosition().y + 12.0F * scale,
			};
			std::vector<VehicleIndex> targets;
			if (line.to) {
				targets.push_back(*line.to);
			} else {
				for (const RoadVehicle& vehicle : shown.vehicles) {
					if (vehicle.token.side != TokenSide::Raider && vehicle.token.wreck == Wreck::None) {
						targets.push_back(vehicle.index);
					}
				}
			}
			const Color color = line.attack ? kLineAttack : kLineOther;
			for (const VehicleIndex target : targets) {
				const VehicleToken* to = token(target);
				if (to == nullptr) {
					continue;
				}
				const Vec2	end{to->getPosition().x + (to->plateRect().x + 66.0F) * to->scale(), to->getPosition().y + 26.0F * to->scale()};
				const float lift = std::max(kLaneHeader + 4.0F, std::min(start.y, end.y) - 20.0F);
				const std::vector<Vec2> arc = bezier(start, {start.x, lift}, {end.x, lift}, end);
				Primitives::drawPolyline({
					.points = arc,
					.width = 2.0F,
					.color = color,
					.dash = Foundation::DashPattern{.dash = 6.0F, .gap = 5.0F},
					.key = key,
				});
				Primitives::drawCircle({.center = end, .radius = 4.0F, .style = {.fill = color}, .key = key});
			}
		}
	}

	void RoadView::renderPops(int32_t key) {
		const double now = getContext()->getClock().now();
		const bool	 still = getContext()->isReducedMotion();
		for (const Pop& pop : pops) {
			const VehicleToken* on = token(pop.vehicle);
			if (on == nullptr) {
				continue;
			}
			const float progress = std::clamp(static_cast<float>((now - pop.started) / kPopMs), 0.0F, 1.0F);
			const float rise = still ? 0.0F : kPopRise * progress;
			const float fade = still || progress < 0.6F ? 1.0F : 1.0F - (progress - 0.6F) / 0.4F;
			const Rect	plate = on->plateRect();
			cards::drawWords({
				.text = pop.text,
				.at = {on->getPosition().x + (plate.x + 10.0F) * on->scale(), on->getPosition().y + plate.y * on->scale() - rise},
				.face = fonts::kDisplayBold,
				.size = kPopFace,
				.color = withAlpha(pop.miss ? ink::kMissNumber : ink::kDamageNumber, fade),
				.key = key,
			});
		}
	}

} // namespace game::road
