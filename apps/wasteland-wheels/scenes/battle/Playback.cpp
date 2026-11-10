#include "scenes/battle/Playback.h"

#include <utils/Log.h>

#include <algorithm>
#include <iterator>
#include <utility>
#include <variant>

namespace game::battle {

	namespace {

		using rules::Event;
		namespace event = rules::event;

		// Slack on a beat's time, so a clock moved on in frame steps lands a beat on the frame that reaches it.
		constexpr double kSlack = 1e-9;

		template <typename... Visitors>
		struct Overloaded : Visitors... {
			using Visitors::operator()...;
		};

		bool turnStarts(const Event& happened, rules::Side side) {
			const auto* started = std::get_if<event::TurnStarted>(&happened);
			return started != nullptr && started->side == side;
		}

		// Where the enemy turn's close starts: the raiders' death marks, a flanker dropping back, a wreck leaving the road,
		// the close-up, and a wave announced or pulling in. None of them happens in a raider's part.
		bool closesTheTurn(const Event& happened) {
			if (const auto* moved = std::get_if<event::VehicleMoved>(&happened)) {
				return moved->cause == rules::MoveCause::LostTheFlank || moved->cause == rules::MoveCause::CloseUp;
			}
			return std::holds_alternative<event::DeathMarkTaken>(happened) || std::holds_alternative<event::LeftRoad>(happened) ||
				   std::holds_alternative<event::WaveDue>(happened) || std::holds_alternative<event::RaiderArrived>(happened);
		}

		// A raider's turn that shows nothing: its turn coming up, a plan dropped, a stun that skips it.
		bool quiet(const Event& happened) {
			return std::holds_alternative<event::RaiderActing>(happened) || std::holds_alternative<event::PlanDropped>(happened) ||
				   std::holds_alternative<event::RaiderStunned>(happened);
		}

		std::optional<rules::DriverIndex> raiderOf(const Event& happened) {
			if (const auto* dropped = std::get_if<event::PlanDropped>(&happened)) {
				return dropped->raider;
			}
			if (const auto* stunned = std::get_if<event::RaiderStunned>(&happened)) {
				return stunned->raider;
			}
			return std::nullopt;
		}

		// A stretch of the enemy turn after its opening: a raider's part, the close, or the player's turn opening.
		struct Part {
			std::vector<Event>				  events;
			std::optional<rules::DriverIndex> acting;
			bool							  opensPlayer = false;
			bool							  shows = false;
		};

		std::vector<Part> partsOf(std::vector<Event>::iterator from, std::vector<Event>::iterator to) {
			std::vector<Part> parts;
			Part			  current;
			bool			  closing = false;
			bool			  opened = false;
			const auto		  cut = [&](Part next) {
				   if (!current.events.empty()) {
					   parts.push_back(std::move(current));
				   }
				   current = std::move(next);
			};
			for (auto at = from; at != to; ++at) {
				Event& happened = *at;
				if (!opened && turnStarts(happened, rules::Side::Player)) {
					cut({.opensPlayer = true, .shows = true});
					opened = true;
				} else if (!opened && !closing && closesTheTurn(happened)) {
					cut({.shows = true});
					closing = true;
				} else if (!opened && !closing) {
					if (const auto* acting = std::get_if<event::RaiderActing>(&happened)) {
						cut({.acting = acting->raider});
					} else if (const std::optional<rules::DriverIndex> raider = raiderOf(happened); raider && raider != current.acting) {
						// Another raider's dropped plan or stun goes with the next beat, not this raider's.
						cut({});
					}
				}
				current.shows = current.shows || !quiet(happened);
				current.events.push_back(std::move(happened));
			}
			cut({});
			return parts;
		}

		bool endsTheFight(const Beat& beat) {
			return std::ranges::any_of(beat.events, [](const Event& happened) {
				return std::holds_alternative<event::FightEnded>(happened);
			});
		}

		// The beats `events` land in (enemy-turn-pacing.md): one at 0 for anything but an end turn; for an end turn, its
		// opening at 0, then each raider's part, the close and the player's turn a beat each from kEnemyLeadIn,
		// kEnemyBeat apart, a part that shows nothing riding with the next. The beat that ends the fight, or the last,
		// settles.
		std::vector<std::pair<double, Beat>> schedule(std::vector<Event> events) {
			std::vector<std::pair<double, Beat>> beats;
			if (events.empty()) {
				return beats;
			}
			const auto raiders =
				std::ranges::find_if(events, [](const Event& happened) { return turnStarts(happened, rules::Side::Raiders); });
			if (raiders == events.end()) {
				const bool opens =
					std::ranges::any_of(events, [](const Event& happened) { return turnStarts(happened, rules::Side::Player); });
				beats.emplace_back(
					0.0,
					Beat{.events = std::move(events), .opens = opens ? std::optional(rules::Side::Player) : std::nullopt, .settles = true}
				);
				return beats;
			}

			const auto		  rest = std::next(raiders);
			std::vector<Part> parts = partsOf(rest, events.end());
			beats.emplace_back(
				0.0,
				Beat{
					.events = std::vector<Event>(std::make_move_iterator(events.begin()), std::make_move_iterator(rest)),
					.opens = rules::Side::Raiders
				}
			);
			std::vector<Event> carried;
			int				   slot = 0;
			for (Part& part : parts) {
				if (!part.shows) {
					std::ranges::move(part.events, std::back_inserter(carried));
					continue;
				}
				Beat beat{.events = std::move(carried), .acting = part.acting};
				carried.clear();
				std::ranges::move(part.events, std::back_inserter(beat.events));
				if (part.opensPlayer) {
					beat.opens = rules::Side::Player;
				}
				beats.emplace_back(kEnemyLeadIn + slot * kEnemyBeat, std::move(beat));
				++slot;
			}
			std::ranges::move(carried, std::back_inserter(beats.back().second.events));

			const auto ending = std::ranges::find_if(beats, [](const auto& timed) { return endsTheFight(timed.second); });
			if (ending != beats.end() && std::next(ending) != beats.end()) {
				LOG_ERROR(Game, "Playback: events go on past the fight's end");
				beats.erase(std::next(ending), beats.end());
			}
			beats.back().second.settles = true;
			return beats;
		}

		void takeOff(int& value, int amount, const char* what) {
			if (amount > value) {
				LOG_ERROR(Game, "mirror: %s takes %d off %d", what, amount, value);
				value = 0;
				return;
			}
			value -= amount;
		}

		void leaveSeat(rules::BattleState& picture, rules::DriverIndex driver) {
			for (rules::BattleVehicle& vehicle : picture.vehicles) {
				if (vehicle.driver == driver) {
					vehicle.driver.reset();
					return;
				}
				if (vehicle.passenger == driver) {
					vehicle.passenger.reset();
					return;
				}
			}
			LOG_ERROR(Game, "mirror: driver %d is down but rides in nothing", driver.value);
		}

		// One application of `status` off: the one with the fewest turns left, since the picture's turns don't tick, and
		// one with no end last.
		void endStatus(rules::BattleVehicle& vehicle, rules::Status status) {
			auto ending = vehicle.statuses.end();
			for (auto at = vehicle.statuses.begin(); at != vehicle.statuses.end(); ++at) {
				if (at->status != status) {
					continue;
				}
				if (ending == vehicle.statuses.end() || (at->turns && (!ending->turns || *at->turns < *ending->turns))) {
					ending = at;
				}
			}
			if (ending == vehicle.statuses.end()) {
				LOG_ERROR(Game, "mirror: a status ends that the picture doesn't have");
				return;
			}
			vehicle.statuses.erase(ending);
		}

		void arrive(rules::BattleState& picture, const event::RaiderArrived& arrived, const rules::BattleState& after) {
			if (static_cast<int>(picture.drivers.size()) != arrived.raider.value ||
				static_cast<int>(picture.vehicles.size()) != arrived.vehicle.value ||
				static_cast<int>(after.drivers.size()) <= arrived.raider.value ||
				static_cast<int>(after.vehicles.size()) <= arrived.vehicle.value) {
				LOG_ERROR(Game, "mirror: raider %d arrives out of turn", arrived.raider.value);
				return;
			}
			picture.drivers.push_back(after.driver(arrived.raider));
			rules::BattleVehicle vehicle = after.vehicle(arrived.vehicle);
			vehicle.slot = arrived.slot;
			picture.vehicles.push_back(std::move(vehicle));
			rules::Reinforcements& reinforcements = picture.reinforcements;
			if (reinforcements.queue.empty() || reinforcements.queue.front().raiders.empty()) {
				LOG_ERROR(Game, "mirror: a raider arrives with no wave queued");
				return;
			}
			rules::QueuedWave& wave = reinforcements.queue.front();
			wave.raiders.erase(wave.raiders.begin());
			wave.started = true;
			if (wave.raiders.empty()) {
				reinforcements.queue.erase(reinforcements.queue.begin());
				reinforcements.due = false;
			}
		}

	} // namespace

	void mirror(rules::BattleState& picture, const rules::Event& happened, const rules::BattleState& after) {
		std::visit(
			Overloaded{
				[&](const event::TurnStarted& started) {
					picture.turn = started.turn;
					picture.phase = started.side == rules::Side::Player ? rules::Phase::Planning : rules::Phase::EnemyTurn;
					picture.actingRaider.reset();
				},
				[&](const event::RaiderActing& acting) { picture.actingRaider = acting.raider; },
				[&](const event::ShieldCleared& cleared) { takeOff(picture.vehicle(cleared.vehicle).shield, cleared.shield, "a clear"); },
				[&](const event::VehicleDamaged& hit) {
					rules::BattleVehicle& vehicle = picture.vehicle(hit.vehicle);
					takeOff(vehicle.shield, hit.shield, "a hit's shield");
					takeOff(vehicle.armor, hit.armor, "a hit's armor");
					takeOff(vehicle.structure, hit.structure, "a hit's structure");
				},
				[&](const event::DriverDamaged& hurt) { takeOff(picture.driver(hurt.driver).hitpoints, hurt.hitpoints, "a hurt"); },
				[&](const event::DriverDown& down) { leaveSeat(picture, down.driver); },
				[&](const event::TookTheWheel& took) {
					rules::BattleVehicle& vehicle = picture.vehicle(took.vehicle);
					if (vehicle.passenger == took.driver) {
						vehicle.passenger.reset();
					}
					vehicle.driver = took.driver;
				},
				[&](const event::CarriesOnAsEscort& carries) {
					rules::BattleVehicle& vehicle = picture.vehicle(carries.vehicle);
					vehicle.crew = rules::kUnmannedCrew;
					vehicle.spent = true;
				},
				[&](const event::VehicleWrecked& wrecked) {
					rules::BattleVehicle& vehicle = picture.vehicle(wrecked.vehicle);
					vehicle.driver.reset();
					vehicle.passenger.reset();
				},
				[&](const event::JumpedAboard& jumped) { picture.vehicle(jumped.vehicle).passenger = jumped.driver; },
				[&](const event::CrashedOut& crashed) { picture.driver(crashed.driver).crashedOut = true; },
				[&](const event::LeftRoad& left) { picture.vehicle(left.vehicle).onRoad = false; },
				[&](const event::ShieldGained& gained) { picture.vehicle(gained.vehicle).shield += gained.shield; },
				[&](const event::ArmorGained& gained) { picture.vehicle(gained.vehicle).armor += gained.armor; },
				[&](const event::Repaired& repaired) {
					rules::BattleVehicle& vehicle = picture.vehicle(repaired.vehicle);
					vehicle.structure += repaired.structure;
					vehicle.armor += repaired.armor;
				},
				[&](const event::DriverHealed& healed) { picture.driver(healed.driver).hitpoints += healed.hitpoints; },
				[&](const event::VehicleMoved& moved) {
					rules::BattleVehicle& vehicle = picture.vehicle(moved.vehicle);
					vehicle.slot = moved.to;
					vehicle.flank.reset();
					if (moved.cause == rules::MoveCause::Flank) {
						// Whom it outran isn't in the event; the fight after has it while it's still out there.
						const std::optional<rules::FlankState>& later = after.vehicle(moved.vehicle).flank;
						vehicle.flank = rules::FlankState{
							.reservedSlot = moved.from,
							.outran = later && later->reservedSlot == moved.from ? later->outran : std::nullopt,
						};
					}
				},
				[&](const event::StatusApplied& applied) {
					picture.vehicle(applied.vehicle)
						.statuses.push_back({.status = applied.status, .value = applied.value, .turns = applied.turns});
				},
				[&](const event::StatusEnded& ended) { endStatus(picture.vehicle(ended.vehicle), ended.status); },
				[&](const event::BecameSteady& steady) { picture.vehicle(steady.vehicle).steady = true; },
				[&](const event::EscortSpent& spent) { picture.vehicle(spent.escort).spent = true; },
				[&](const event::DrawingFire& drawing) {
					std::erase(picture.drawFireCovers, drawing.escort);
					picture.drawFireCovers.push_back(drawing.escort);
				},
				[&](const event::WaveDue& /*due*/) { picture.reinforcements.due = true; },
				[&](const event::RaiderArrived& arrived) { arrive(picture, arrived, after); },
				[&](const event::FightEnded& ended) {
					picture.phase = rules::Phase::Over;
					picture.outcome = ended.outcome;
					picture.rout = ended.rout;
					picture.actingRaider.reset();
				},
				// Cards, piles and adrenaline aren't on the road, and a plan's steps say nothing the picture holds; the
				// settle brings them.
				[](const auto& /*recordOnly*/) {},
			},
			happened
		);
	}

	void Playback::start(const rules::BattleState& before, const rules::BattleState& after, std::vector<rules::Event> events) {
		if (playing()) {
			(void)finish();
		}
		picture = before;
		settled = after;
		pending.clear();
		for (auto& [at, beat] : schedule(std::move(events))) {
			pending.push_back({.at = at, .beat = std::move(beat)});
		}
		next = 0;
		clock = 0.0;
	}

	bool Playback::playing() const {
		return next < pending.size();
	}

	const rules::BattleState& Playback::shown() const {
		return playing() ? picture : settled;
	}

	std::vector<Beat> Playback::advance(double seconds) {
		if (seconds < 0.0) {
			LOG_ERROR(Game, "Playback: the clock can't go back %f s", seconds);
			seconds = 0.0;
		}
		clock += seconds;
		std::vector<Beat> landed;
		while (playing() && pending[next].at <= clock + kSlack) {
			landed.push_back(land(pending[next]));
		}
		return landed;
	}

	std::vector<Beat> Playback::finish() {
		std::vector<Beat> landed;
		while (playing()) {
			landed.push_back(land(pending[next]));
		}
		return landed;
	}

	Beat Playback::land(Timed& timed) {
		Beat beat = std::move(timed.beat);
		beat.turn = picture.turn;
		for (const rules::Event& happened : beat.events) {
			mirror(picture, happened, settled);
		}
		++next;
		if (!playing()) {
			pending.clear();
			next = 0;
		}
		return beat;
	}

} // namespace game::battle
