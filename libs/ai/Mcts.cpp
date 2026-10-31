#include "Mcts.h"

#include "Preferences.h"
#include "Weights.h"

#include <rules/battle/Battle.h>

#include <cmath>
#include <stdexcept>
#include <vector>

namespace ai {

	namespace {

		using rules::BattleState;
		using rules::Side;

		constexpr WeightNames<Mcts::Weights, 2> kWeightNames{{
			{"iterations", &Mcts::Weights::iterations},
			{"exploration", &Mcts::Weights::exploration},
		}};

		constexpr int kMostIterations = 10000;
		// More actions than a turn cycle takes; a playout past it is cut off where it stands.
		constexpr int kMostPlayoutSteps = 400;
		// A won or lost fight, against what's left on the road, and how far a playout's value has to move to be
		// worth most of a win.
		constexpr double kDecided = 500;
		constexpr double kSpread = 40;

		// ln(x) for x >= 1 from frexp, which is exact, and the atanh series, which is adds, multiplies, and divides,
		// where std::log may round differently from one standard library to the next.
		double naturalLog(double x) {
			int			 exponent = 0;
			const double mantissa = std::frexp(x, &exponent);
			const double t = (mantissa - 1) / (mantissa + 1);
			const double squared = t * t;
			double		 term = t;
			double		 sum = 0;
			for (int odd = 1; odd < 40; odd += 2) {
				sum += term / odd;
				term *= squared;
			}
			return 2 * sum + exponent * 0.6931471805599453;
		}

		// A playout's value against the root's, squashed into 0 to 1 for UCB1.
		double reward(double value, double root) {
			const double moved = value - root;
			return 0.5 + 0.5 * moved / (std::abs(moved) + kSpread);
		}

		void playOut(BattleState& board, const rules::Content& content, foundation::Rng& rng) {
			for (int step = 0; step < kMostPlayoutSteps; ++step) {
				if (board.phase != rules::Phase::PlayerTurn && board.phase != rules::Phase::EnemyTurn) {
					return;
				}
				const std::vector<rules::Action> actions = rules::legalActions(board, content);
				(void)rules::apply(board, content, rng.pick(actions));
			}
		}

	} // namespace

	Mcts::Weights Mcts::weightsFrom(const std::map<std::string, double>& named) {
		const Weights weights = weightsNamed(named, kWeightNames, "Monte Carlo tree search");
		if (weights.iterations < 1 || weights.iterations > kMostIterations || weights.iterations != std::floor(weights.iterations)) {
			throw std::invalid_argument("iterations has to be a whole number from 1 to " + std::to_string(kMostIterations));
		}
		if (weights.exploration < 0) {
			throw std::invalid_argument("exploration can't be negative");
		}
		return weights;
	}

	Mcts::Mcts(Weights weights)
		: iterations(static_cast<int>(weights.iterations)),
		  exploration(weights.exploration) {}

	double Mcts::valueOf(const BattleState& board, Side side) {
		double	   value = 0;
		const auto count = [&](Side owner, int points) {
			value += owner == side ? points : -points;
		};
		for (int index = 0; index < static_cast<int>(board.vehicles.size()); ++index) {
			const rules::BattleVehicle& vehicle = board.vehicles[static_cast<size_t>(index)];
			count(vehicle.side, rules::vehicleInFight(board, rules::VehicleIndex{index}) ? vehicle.structure + vehicle.armor : 0);
		}
		for (int index = 0; index < static_cast<int>(board.drivers.size()); ++index) {
			const rules::BattleDriver& driver = board.drivers[static_cast<size_t>(index)];
			count(driver.side, rules::driverInFight(board, rules::DriverIndex{index}) ? driver.hitpoints : 0);
		}
		for (const rules::QueuedWave& wave : board.reinforcements.queue) {
			for (const rules::QueuedRaider& raider : wave.raiders) {
				count(Side::Raiders, raider.vehicle.structure + raider.vehicle.armor + raider.driver.hitpoints);
			}
		}
		if (board.outcome == rules::Outcome::Won || board.outcome == rules::Outcome::Lost) {
			const Side winner = board.outcome == rules::Outcome::Won ? Side::Player : Side::Raiders;
			value += winner == side ? kDecided : -kDecided;
		}
		return value;
	}

	rules::Action Mcts::choose(
		const BattleState&			   board,
		const rules::Content&		   content,
		std::span<const rules::Action> actions,
		foundation::Rng&			   rng
	) const {
		const std::vector<rules::Action> offered = preferredPlays(board, content, actions);
		if (offered.size() == 1) {
			return offered.front();
		}
		const Side	 side = board.phase == rules::Phase::EnemyTurn ? Side::Raiders : Side::Player;
		const double root = valueOf(board, side);

		std::vector<int>	visits(offered.size(), 0);
		std::vector<double> rewards(offered.size(), 0);
		for (int iteration = 0; iteration < iterations; ++iteration) {
			size_t pick = 0;
			double pickScore = -1;
			for (size_t index = 0; index < offered.size(); ++index) {
				if (visits[index] == 0) {
					pick = index;
					break;
				}
				const double score =
					rewards[index] / visits[index] + exploration * std::sqrt(naturalLog(static_cast<double>(iteration)) / visits[index]);
				if (score > pickScore) {
					pick = index;
					pickScore = score;
				}
			}
			BattleState playout = board;
			(void)rules::apply(playout, content, offered[pick]);
			playOut(playout, content, rng);
			++visits[pick];
			rewards[pick] += reward(valueOf(playout, side), root);
		}

		size_t best = 0;
		double bestMean = -1;
		for (size_t index = 0; index < offered.size(); ++index) {
			if (visits[index] > 0 && rewards[index] / visits[index] > bestMean) {
				best = index;
				bestMean = rewards[index] / visits[index];
			}
		}
		return offered[best];
	}

} // namespace ai
