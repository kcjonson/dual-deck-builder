#include "scenes/battle/BattleLog.h"

#include "Fonts.h"
#include "Words.h"
#include "scenes/battle/BattleInk.h"

#include <primitives/Primitives.h>
#include <rules/core/CardText.h>
#include <ui/Context.h>
#include <ui/shapes/Rectangle.h>
#include <ui/shapes/Text.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <optional>
#include <span>
#include <type_traits>
#include <utility>
#include <variant>

namespace game::battle {

	namespace {

		using rules::BattleState;
		using rules::DriverIndex;
		using rules::Event;
		using rules::VehicleIndex;
		namespace event = rules::event;

		// The mock's .drawer and its .ln lines.
		constexpr Foundation::Color kDrawerGround = cards::hex(0x0C0D0E, 0.96F);
		constexpr Foundation::Color kLineText = cards::hex(0xD5D0C3);
		constexpr float				kPadY = 10.0F;
		constexpr float				kPadX = 12.0F;
		constexpr float				kGap = 8.0F;
		constexpr float				kTitleSize = 15.0F;
		constexpr float				kLineSize = 13.0F;
		constexpr float				kTagSize = 11.0F;
		constexpr float				kTagWidth = 30.0F;
		constexpr float				kTagGap = 6.0F;
		constexpr float				kRuleGap = 6.0F;

		Foundation::Color toneColor(LogTone tone) {
			switch (tone) {
				case LogTone::Plain:
					return kLineText;
				case LogTone::Player:
					return ink::kBone;
				case LogTone::Raider:
					return ink::kRaider;
				case LogTone::Hit:
					return ink::kDamageNumber;
				case LogTone::Miss:
					return ink::kMuted;
				case LogTone::Turn:
				case LogTone::Outcome:
					return ink::kWarn;
			}
			return kLineText;
		}

		std::string turnsText(int turns) {
			return std::to_string(turns) + (turns == 1 ? " turn" : " turns");
		}

		// The player's lines for a run of events, worded as they go: a play's hits and misses carry its card's name, and
		// a hit takes the occupants' shares after it into its own line.
		class Wording {
		  public:
			Wording(const BattleState& after, const rules::Content& content, std::span<const std::string> seats)
				: after(after),
				  content(content),
				  seats(seats) {}

			std::vector<LogLine> wordAll(std::span<const Event> events, int startTurn) {
				turn = startTurn;
				for (size_t at = 0; at < events.size(); ++at) {
					at += wordOne(events, at);
				}
				return std::move(lines);
			}

		  private:
			void say(std::string text, LogTone tone = LogTone::Plain) {
				lines.push_back({.turn = turn, .text = std::move(text) + ".", .tone = tone});
			}

			[[nodiscard]] std::string person(DriverIndex driver) const { return fighterName(after, content, driver, seats); }
			[[nodiscard]] std::string vehicle(VehicleIndex index) const { return vehicleName(after, content, index, seats); }

			// A raider by the vehicle it drives, as the road shows it: the one it's in, or its own once it's out.
			[[nodiscard]] std::string raider(DriverIndex driver) const {
				if (const std::optional<VehicleIndex> riding = rules::vehicleCarrying(after, driver)) {
					return vehicle(*riding);
				}
				for (int index = 0; index < static_cast<int>(after.vehicles.size()); ++index) {
					if (after.vehicles[static_cast<size_t>(index)].owner == driver) {
						return vehicle(VehicleIndex{index});
					}
				}
				return person(driver);
			}

			[[nodiscard]] bool players(DriverIndex driver) const { return after.driver(driver).side == rules::Side::Player; }

			[[nodiscard]] std::string card(const rules::BattleCard& played) const {
				return rules::cardName(content.cards.at(played.card), played.upgraded);
			}

			// "to their inside lane, center": Words names a slot only as a play's destination.
			[[nodiscard]] std::string slot(rules::RoadSlot to) const { return playText(after, content, {.destination = to}, seats); }

			// What does the hit or the miss: the card being played, or the attacker.
			[[nodiscard]] std::string striker(VehicleIndex attacker) const { return playing ? *playing : vehicle(attacker); }

			// Words events[at], and returns how many after it went into the same line.
			size_t wordOne(std::span<const Event> events, size_t at) {
				const Event& happened = events[at];
				size_t		 took = 0;
				std::visit(
					[&](const auto& each) {
						using Kind = std::decay_t<decltype(each)>;
						if constexpr (std::is_same_v<Kind, event::VehicleDamaged>) {
							took = hit(each, events.subspan(at + 1));
						} else if constexpr (std::is_same_v<Kind, event::VehicleMoved>) {
							took = moved(each, events.subspan(at + 1));
						} else {
							word(each);
						}
					},
					happened
				);
				return took;
			}

			size_t hit(const event::VehicleDamaged& damaged, std::span<const Event> following) {
				std::vector<std::string>						 parts;
				const std::array<std::pair<int, const char*>, 3> split{
					{{damaged.shield, "shield"}, {damaged.armor, "armor"}, {damaged.structure, "structure"}}
				};
				for (const auto& [amount, where] : split) {
					if (amount > 0) {
						parts.push_back(std::to_string(amount) + " to " + where);
					}
				}
				// The occupants' shares follow the hit at once (damageVehicle), as intentsOf reads them.
				size_t took = 0;
				for (const Event& next : following) {
					const auto* hurt = std::get_if<event::DriverDamaged>(&next);
					if (hurt == nullptr) {
						break;
					}
					++took;
					if (hurt->hitpoints > 0) {
						parts.push_back(std::to_string(hurt->hitpoints) + " to " + person(hurt->driver));
					}
				}
				std::string text = playing ? *playing + " hits " + vehicle(damaged.vehicle) + " for " + std::to_string(damaged.damage)
										   : vehicle(damaged.vehicle) + " takes " + std::to_string(damaged.damage);
				for (size_t index = 0; index < parts.size(); ++index) {
					text += (index == 0 ? ": " : ", ") + parts[index];
				}
				say(std::move(text), LogTone::Hit);
				return took;
			}

			size_t moved(const event::VehicleMoved& move, std::span<const Event> following) {
				const std::string who = vehicle(move.vehicle);
				const auto		  nextMove = [&](size_t index) -> const event::VehicleMoved* {
					   return index < following.size() ? std::get_if<event::VehicleMoved>(&following[index]) : nullptr;
				};
				switch (move.cause) {
					case rules::MoveCause::Swap:
						if (const event::VehicleMoved* other = nextMove(0); other != nullptr && other->cause == rules::MoveCause::Swap) {
							say(who + " and " + vehicle(other->vehicle) + " swap places");
							return 1;
						}
						say(who + " swaps " + slot(move.to));
						return 0;
					case rules::MoveCause::FormationShift: {
						size_t took = 0;
						while (const event::VehicleMoved* other = nextMove(took)) {
							if (other->cause != rules::MoveCause::FormationShift) {
								break;
							}
							++took;
						}
						const bool yours = after.vehicle(move.vehicle).side == rules::Side::Player;
						say(yours ? "Your formation shifts lanes" : "The raiders' formation shifts lanes");
						return took;
					}
					case rules::MoveCause::Flank:
						say(who + " flanks " + slot(move.to));
						return 0;
					case rules::MoveCause::Swerve:
						say(who + " swerves " + slot(move.to));
						return 0;
					case rules::MoveCause::Relocate:
						say(who + " moves " + slot(move.to));
						return 0;
					case rules::MoveCause::DropBack:
						say(who + " drops back " + slot(move.to));
						return 0;
					case rules::MoveCause::LostTheFlank:
						say(who + " loses the flank and drops back " + slot(move.to));
						return 0;
					case rules::MoveCause::CloseUp:
						say(who + " closes up " + slot(move.to));
						return 0;
				}
				return 0;
			}

			void word(const event::TurnStarted& started) {
				turn = started.turn;
				playing.reset();
				say(started.side == rules::Side::Player ? "Your turn" : "The raiders' turn", LogTone::Turn);
			}

			void word(const event::CardPlayed& played) {
				playing = card(played.card);
				const bool	yours = players(played.driver);
				std::string text = (yours ? person(played.driver) : raider(played.driver)) + " plays " + *playing;
				if (played.target) {
					text += " at " + vehicle(*played.target);
				}
				if (played.exhausted) {
					text += ", exhausting it";
				}
				say(std::move(text), yours ? LogTone::Player : LogTone::Raider);
			}

			void word(const event::HitChecked& check) {
				if (check.hit) {
					return;
				}
				const std::string skill = check.attackType == rules::AttackType::Ramming ? "ramming " : "gunnery ";
				say(striker(check.attacker) + " misses " + vehicle(check.defender) + ": " + skill + std::to_string(check.skill) +
						" against evade " + std::to_string(check.evade),
					LogTone::Miss);
			}

			void word(const event::OutOfRange& out) {
				say(striker(out.attacker) + " can't reach " + vehicle(out.defender) + ": range " + std::to_string(out.range) + ", reach " +
						std::to_string(out.reach),
					LogTone::Miss);
			}

			void word(const event::DriverDamaged& hurt) {
				if (std::exchange(markedTaken, std::nullopt) == hurt.driver) {
					return;
				}
				say(playing ? *playing + " hits " + person(hurt.driver) + " for " + std::to_string(hurt.hitpoints)
							: person(hurt.driver) + " takes " + std::to_string(hurt.hitpoints),
					LogTone::Hit);
			}

			void word(const event::DriverDown& down) {
				say(person(down.driver) + (players(down.driver) ? " is down" : " is dead"), LogTone::Hit);
			}

			void word(const event::TookTheWheel& took) { say(person(took.driver) + " takes the wheel of " + vehicle(took.vehicle)); }

			void word(const event::CarriesOnAsEscort& carries) {
				say(vehicle(carries.vehicle) + " has nobody at the wheel and carries on as an escort");
			}

			void word(const event::Unmanned& unmanned) {
				say(vehicle(unmanned.vehicle) + " has nobody at the wheel and is out of the fight");
			}

			void word(const event::VehicleWrecked& wrecked) { say(vehicle(wrecked.vehicle) + " is wrecked", LogTone::Hit); }

			void word(const event::JumpedAboard& jumped) { say(person(jumped.driver) + " jumps aboard " + vehicle(jumped.vehicle)); }

			void word(const event::CrashedOut& crashed) { say(person(crashed.driver) + " has no free seat and crashes out of the fight"); }

			void word(const event::ShieldGained& gained) {
				say(vehicle(gained.vehicle) + " gains " + std::to_string(gained.shield) + " shield");
			}

			void word(const event::ArmorGained& gained) {
				say(vehicle(gained.vehicle) + " gains " + std::to_string(gained.armor) + " armor");
			}

			void word(const event::Repaired& repaired) {
				const std::string who = vehicle(repaired.vehicle);
				const std::string armor = "gains " + std::to_string(repaired.armor) + " armor";
				if (repaired.structure == 0) {
					say(who + (repaired.armor > 0 ? " " + armor : " is already whole"));
					return;
				}
				say(who + " repairs " + std::to_string(repaired.structure) + " structure" + (repaired.armor > 0 ? " and " + armor : ""));
			}

			void word(const event::DriverHealed& healed) {
				say(person(healed.driver) + " heals " + std::to_string(healed.hitpoints) + " HP");
			}

			void word(const event::AdrenalineGained& gained) {
				if (gained.adrenaline > 0) {
					say(person(gained.driver) + " gains " + std::to_string(gained.adrenaline) + " adrenaline");
				}
			}

			void word(const event::CardBurned& burned) {
				if (players(burned.driver)) {
					say(person(burned.driver) + "'s hand is full, so " + card(burned.card) + " goes to the discard pile");
				}
			}

			void word(const event::MoveBlocked& blocked) {
				say(vehicle(blocked.vehicle) + (blocked.cancelsCard ? " can't move, and the rest of the card is lost" : " can't move"),
					LogTone::Miss);
			}

			void word(const event::StatusApplied& applied) {
				std::string text = statusName(applied.status);
				if (applied.value != 0) {
					text += " " + std::to_string(applied.value) + (applied.status == rules::Status::DamageBonus ? "%" : "");
				}
				text += " on " + vehicle(applied.vehicle);
				if (applied.turns) {
					text += " for " + turnsText(*applied.turns);
				}
				say(std::move(text));
			}

			void word(const event::StatusEnded& ended) { say(statusName(ended.status) + " on " + vehicle(ended.vehicle) + " wears off"); }

			void word(const event::BecameSteady& steady) {
				say(vehicle(steady.vehicle) + " holds steady: it can't be stunned again until your next turn");
			}

			void word(const event::ShookOffStun& shook) {
				say(vehicle(shook.vehicle) + " is steady and shrugs off the stun", LogTone::Miss);
			}

			void word(const event::RaiderStunned& stunned) { say(raider(stunned.raider) + " is stunned and skips its turn"); }

			void word(const event::OrderCarried& order) {
				say(vehicle(order.escort) + " carries out the order" + (order.target ? " at " + vehicle(*order.target) : std::string()));
			}

			void word(const event::DrawingFire& drawing) { say(vehicle(drawing.escort) + " draws fire across its row"); }

			void word(const event::FireDrawn& drawn) {
				say(vehicle(drawn.to) + " draws " + raider(drawn.raider) + "'s fire away from " + vehicle(drawn.from));
			}

			void word(const event::PlannedStepFizzled& fizzled) {
				say(raider(fizzled.raider) + "'s " + card(fizzled.card) + " fizzles: " + fizzled.reason, LogTone::Miss);
			}

			void word(const event::PlanRedirected& redirected) {
				say(vehicle(redirected.from) + " is wrecked, so " + raider(redirected.raider) + " turns on " + vehicle(redirected.to));
			}

			void word(const event::PlanDropped& dropped) { say(raider(dropped.raider) + " drops its plan"); }

			void word(const event::DeathMarkTaken& taken) {
				// The death mark's own line says what the HP loss after it is.
				markedTaken = taken.driver;
				say("The death mark on " + vehicle(taken.vehicle) + " takes " + person(taken.driver), LogTone::Hit);
			}

			void word(const event::WaveDue& due) {
				say("Wave " + std::to_string(due.wave) + " of " + std::to_string(after.reinforcements.total) +
						" pulls in after the raiders' turn",
					LogTone::Raider);
			}

			void word(const event::RaiderArrived& arrived) {
				say(vehicle(arrived.vehicle) + " pulls in " + slot(arrived.slot), LogTone::Raider);
			}

			void word(const event::FightEnded& ended) {
				switch (ended.outcome) {
					case rules::Outcome::Won:
						if (ended.rout == rules::RoutCause::LeaderOut) {
							say("The raiders' leader is out and the rest flee. Fight won", LogTone::Outcome);
						} else if (ended.rout == rules::RoutCause::ThreatThinned) {
							say("The raiders are thinned out and flee. Fight won", LogTone::Outcome);
						} else {
							say("Every raider is out of the fight. Fight won", LogTone::Outcome);
						}
						return;
					case rules::Outcome::Lost:
						say("Nobody is left to drive. Fight lost", LogTone::Outcome);
						return;
					case rules::Outcome::BrokenOff:
						say("The raiders break off", LogTone::Outcome);
						return;
				}
			}

			// The record's alone: draws, shuffles, a hand discarded, adrenaline refilled, a shield cleared at the turn, a
			// plan committed or a step about to play, a raider coming up, an escort spent, a wreck leaving the road.
			void word(const auto& /*recordOnly*/) {}

			const BattleState&			 after;
			const rules::Content&		 content;
			std::span<const std::string> seats;
			std::vector<LogLine>		 lines;
			int							 turn = 1;
			std::optional<std::string>	 playing;
			std::optional<DriverIndex>	 markedTaken;
		};

	} // namespace

	std::vector<LogLine> logLines(
		const BattleState&			 after,
		const rules::Content&		 content,
		std::span<const Event>		 events,
		int							 turn,
		std::span<const std::string> seats
	) {
		return Wording(after, content, seats).wordAll(events, turn);
	}

	LogLine matchupLine(const BattleState& state, const rules::Content& content, std::span<const std::string> seats) {
		std::string crew;
		std::string raiders;
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			const bool	 yours = state.drivers[static_cast<size_t>(index)].side == rules::Side::Player;
			std::string& side = yours ? crew : raiders;
			if (!side.empty()) {
				side += yours ? " and " : ", ";
			}
			side += fighterName(state, content, DriverIndex{index}, seats);
		}
		return {.turn = state.turn, .text = crew + " vs " + raiders + ".", .tone = LogTone::Plain};
	}

	LogDrawer::LogDrawer(const Args& /*args*/) {}

	void LogDrawer::onMount() {
		if (getSizeSpec().width.isAuto()) {
			setSize({kWidth, getSizeSpec().height});
		}
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Column;
		layout.alignItems = ui::AlignItems::Stretch;
		layout.padding = ui::Edges(kPadY, kPadX);
		layout.gap = kGap;
		setLayout(layout);
		const std::string id = getId().empty() ? std::string("log") : getId();
		addChild<ui::Text>({
			.id = id + "_title",
			.layout = {.flexShrink = 0.0F},
			.style =
				{.color = ink::kMuted,
				 .fontFamily = fonts::kDisplaySemibold,
				 .fontSize = kTitleSize,
				 .letterSpacing = kTitleSize * 0.12F,
				 .textTransform = Foundation::TextTransform::Uppercase,
				 .fontWeight = 600.0F},
			.text = "Combat log",
		});
		scroller = addChild<ui::Component>({
			.id = id + "_scroll",
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
			.overflow = ui::Overflow::Scroll,
		});
		column = scroller.addChild<ui::Component>({
			.id = id + "_lines",
			.size = {ui::percent(100.0F), ui::kAuto},
			.minSize = {0.0F, ui::percent(100.0F)},
			.layout =
				{.display = ui::Display::Flex,
				 .flexDirection = ui::FlexDirection::Column,
				 .gap = kGap,
				 .alignItems = ui::AlignItems::Stretch},
			.onLayout = [this](ui::Component& /*lines*/) { followFoot(); },
		});
		for (const LogLine& line : kept) {
			addRow(line);
		}
	}

	void LogDrawer::add(std::span<const LogLine> lines) {
		following = following || atFoot();
		for (const LogLine& line : lines) {
			kept.push_back(line);
			if (column.get() != nullptr) {
				addRow(line);
			}
		}
		const size_t over = kept.size() > static_cast<size_t>(kKept) ? kept.size() - static_cast<size_t>(kKept) : 0;
		kept.erase(kept.begin(), kept.begin() + static_cast<std::ptrdiff_t>(over));
		if (ui::Component* rows = column.get()) {
			for (size_t dropped = 0; dropped < over; ++dropped) {
				rows->removeChild(getContext()->find(rows->getChildren().front())->self());
			}
		}
	}

	bool LogDrawer::atFoot() const {
		const ui::Component* scroll = scroller.get();
		return scroll == nullptr || scroll->getScroll().y >= scroll->getScrollMax().y - 1.0F;
	}

	void LogDrawer::followFoot() {
		ui::Component* scroll = scroller.get();
		if (!following || scroll == nullptr) {
			return;
		}
		following = false;
		scroll->scrollTo({0.0F, scroll->getScrollMax().y});
	}

	void LogDrawer::addRow(const LogLine& line) {
		ui::Ref<ui::Rectangle> row = column.addChild<ui::Rectangle>({
			.layout =
				{.display = ui::Display::Flex,
				 .flexDirection = ui::FlexDirection::Row,
				 .gap = kTagGap,
				 .padding = ui::Edges(0.0F, 0.0F, kRuleGap, 0.0F),
				 .alignItems = ui::AlignItems::Start},
			.style = {
				.backgroundColor = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
				.borderColor = ink::kLine,
				.borderWidth = 1.0F,
				.borderSides = Foundation::BorderSides{.top = false, .right = false, .bottom = true, .left = false}
			},
		});
		row.addChild<ui::Text>({
			.size = {kTagWidth, ui::kAuto},
			.margin = ui::Edges(2.0F, 0.0F, 0.0F, 0.0F),
			.style = {.color = ink::kDim, .fontFamily = fonts::kMono, .fontSize = kTagSize},
			.text = "T" + std::to_string(line.turn),
		});
		row.addChild<ui::Text>({
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
			.style = {.color = toneColor(line.tone), .fontFamily = fonts::kBody, .fontSize = kLineSize},
			.text = line.text,
			.wrap = true,
		});
	}

	void LogDrawer::render() {
		Renderer::Primitives::drawRect({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.style =
				{.fill = kDrawerGround,
				 .border =
					 Foundation::BorderStyle{
						 .color = ink::kLine2,
						 .width = 1.0F,
						 .position = Foundation::BorderPosition::Inside,
						 .sides = {.top = false, .right = false, .bottom = false, .left = true},
					 }},
			.key = drawKey(),
		});
	}

} // namespace game::battle
