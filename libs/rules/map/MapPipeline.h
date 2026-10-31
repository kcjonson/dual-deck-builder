#pragma once

#include <random/Rng.h>
#include <utils/Log.h>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <stdexcept>
#include <stop_token>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rules::map {

	// Attempts a stage gets, unless it sets its own, before the map restarts.
	inline constexpr uint32_t kStageAttempts = 8;
	// Map attempts on one seed before the run throws; founding answers that with the next seed.
	inline constexpr uint32_t kMapAttempts = 32;

	// Debug and RelWithDebInfo, where a run is a debug run unless told otherwise.
#ifdef DEVELOPMENT_BUILD
	inline constexpr bool kDevelopmentBuild = true;
#else
	inline constexpr bool kDevelopmentBuild = false;
#endif

	// What a stage's check or the accept hook found wrong with its output. Empty passes.
	using Problems = std::vector<std::string>;

	// One attempt at one stage, as progress and the accept hook are told it.
	struct StageAttempt {
		std::string_view stage;
		// The stage's place in the pipeline, from 0, and how many stages there are.
		size_t index{0};
		size_t count{0};
		// From 0, counted afresh whenever the stage's upstream changes.
		uint32_t attempt{0};
		uint32_t mapAttempt{0};
		// The root seed every stream forks from.
		uint32_t seed{0};
	};

	struct StageFailure {
		std::string stage;
		uint32_t	attempt{0};
		uint32_t	mapAttempt{0};
		Problems	problems;
	};

	// What a run gave up on: every map attempt on the seed, in any build, or, in a debug run, a local-retry stage's
	// attempts when it had one it could have kept.
	enum class Exhausted { Map, Stage };

	// The runner never moves to another seed itself; founding answers an exhausted map with the next one.
	class MapPipelineError : public std::runtime_error {
	  public:
		MapPipelineError(uint32_t seed, Exhausted what, StageFailure last)
			: std::runtime_error(message(seed, what, last)),
			  exhausted(what),
			  failure(std::move(last)) {}

		Exhausted	 exhausted;
		StageFailure failure;

	  private:
		static std::string message(uint32_t seed, Exhausted what, const StageFailure& last) {
			const std::string problem = last.problems.empty() ? "" : last.problems.front();
			if (what == Exhausted::Map) {
				return "MapPipeline: seed " + std::to_string(seed) + " failed " + std::to_string(kMapAttempts) +
					   " map attempts; the last ran out on " + last.stage + " attempt " + std::to_string(last.attempt) + ": " + problem;
			}
			return "MapPipeline: seed " + std::to_string(seed) + " map attempt " + std::to_string(last.mapAttempt) + ": " + last.stage +
				   " failed every attempt, the last with " + std::to_string(last.problems.size()) + " problems, first " + problem;
		}
	};

	// A run whose stop was requested, thrown before the next stage attempt starts, so nothing half-made is handed back.
	class MapPipelineCancelled : public std::runtime_error {
	  public:
		MapPipelineCancelled(uint32_t seed, std::string_view stage)
			: std::runtime_error("MapPipeline: seed " + std::to_string(seed) + " cancelled before " + std::string(stage)),
			  before(stage) {}

		// The stage it would have run next.
		std::string before;
	};

	// A stage: it fills its product in from its upstream's and its own stream, and its check says what's
	// wrong with it.
	template <typename Input, typename Products>
	struct MapStage {
		// Names its stream; unique in a pipeline.
		std::string name;
		// 1 for a stage that takes no draws, whose every attempt would be the same.
		uint32_t attempts{kStageAttempts};
		// Writes this stage's product into `products`, reading only what earlier stages wrote. A stage that
		// throws has a bug, not a failure, so the exception goes straight out.
		std::function<void(const Input&, Products&, foundation::Rng&)> run;
		std::function<Problems(const Input&, const Products&)>		   check{};
		// A stage upstream of it to rerun, on its next attempt, once this one is out of attempts, instead of
		// restarting the map; empty for none. Everything after the upstream stage reruns on fresh streams, this one
		// counting from 0 again. Never to or from a local-retry stage.
		std::string escalate{};
		// Retries only itself and never restarts the map for failing (the stops, and every inert stage). Past its cap
		// a debug run throws and a release run logs and keeps its best attempt, the fewest problems, the earliest on a
		// tie. So its check reports every problem it finds: one that stopped at a limit couldn't rank two attempts past
		// it.
		bool localRetry{false};
		// For a local-retry stage: whether a failing attempt with these problems may be kept past the cap. When none
		// may, the map restarts on its next attempt, in any build. Any may when empty.
		std::function<bool(const Problems&)> keepable{};
		// Carries no gameplay (the dressing), so nothing play reads may depend on it: a local-retry stage that may keep
		// any attempt, which only inert stages follow. A replay that names no attempt for it runs its first, so adding
		// or changing one never breaks a save.
		bool inert{false};
	};

	// The map so far, with the stage that just passed its own check in it; anything returned rejects that
	// stage's output as a failed check would. Where the map validator plugs in.
	template <typename Products>
	using AcceptHook = std::function<Problems(const Products&, const StageAttempt&)>;

	// Where a map sits among its seed's attempts: with the seed and the input, all it takes to make it
	// again, which is what a load does. Every gameplay stage has an attempt; an inert stage left out runs its first.
	struct PipelineReplay {
		uint32_t									 mapAttempt{0};
		std::map<std::string, uint32_t, std::less<>> attempts;
	};

	template <typename Products>
	struct PipelineOptions {
		AcceptHook<Products> accept{};
		// Told as each stage attempt starts.
		std::function<void(const StageAttempt&)> onProgress{};
		// Make an earlier run's map again: each stage runs once on its winning attempt, nothing checked.
		std::optional<PipelineReplay> replay{};
		// Asked before every stage attempt, a replay's and a kept attempt's rerun included: once a stop is requested the
		// run throws MapPipelineCancelled there. A stage runs to its end, so the wait is at most one stage's.
		std::stop_token cancel{};
		// Past a local-retry stage's cap with an attempt it may keep: throw a MapPipelineError (debug) or log and keep
		// it (release).
		bool debug{kDevelopmentBuild};
	};

	struct StageRecord {
		std::string name;
		// The winning attempt and its stream's seed: foundation::Rng(stream) replays it.
		uint32_t attempt{0};
		uint32_t stream{0};
		// Every attempt run, across every map attempt, and the time they took, checks included.
		uint32_t				 runs{0};
		std::chrono::nanoseconds time{0};
		// A local-retry stage's best failing attempt, kept past its cap by a release run.
		bool kept{false};
	};

	template <typename Products>
	struct PipelineResult {
		Products products;
		uint32_t mapAttempt{0};
		// In pipeline order.
		std::vector<StageRecord> stages;
		// Every failed attempt, in the order they ran.
		std::vector<StageFailure> failures;
	};

	// The area map generator's runner (Area Map Generation, Seeds and determinism, and Validation and
	// retries; map-pipeline-worker.md): stages in order, each on a stream nested in its upstream's winning
	// stream, root.fork("map", m).fork(first, a).fork(second, b) and so on, each checked and retried. A
	// stage out of attempts restarts the map on its next attempt, up to kMapAttempts, then the run throws
	// a MapPipelineError; a local-retry stage reruns alone, and past its cap throws or keeps its best attempt.
	// fork reads only its parent's seed, so how many draws a stage made never moves its children, and a failed
	// attempt leaves nothing behind.
	template <typename Input, typename Products>
	class MapPipeline {
	  public:
		using Stage = MapStage<Input, Products>;

		[[nodiscard]] MapPipeline then(Stage stage) const {
			assert(!stage.name.empty() && stage.attempts >= 1 && stage.run && "MapPipeline: a stage has a name, an attempt, and a run");
			for ([[maybe_unused]] const Stage& earlier : stages) {
				assert(earlier.name != stage.name && "MapPipeline: stage names are unique");
				assert((stage.inert || !earlier.inert) && "MapPipeline: only an inert stage follows an inert one");
			}
			assert(!(stage.inert && stage.keepable) && "MapPipeline: an inert stage may keep any attempt");
			stage.localRetry = stage.localRetry || stage.inert;
			assert(
				(
					stage.escalate.empty() ||
					std::ranges::any_of(stages, [&](const Stage& earlier) { return earlier.name == stage.escalate && !earlier.localRetry; })
				) &&
				"MapPipeline: a stage escalates only to one upstream of it, never a local-retry stage"
			);
			assert(!(stage.localRetry && !stage.escalate.empty()) && "MapPipeline: a local-retry stage retries only itself");
			assert((stage.localRetry || !stage.keepable) && "MapPipeline: only a local-retry stage keeps a failing attempt");
			MapPipeline next = *this;
			next.stages.push_back(std::move(stage));
			return next;
		}

		[[nodiscard]] PipelineResult<Products> run(uint32_t seed, const Input& input, const PipelineOptions<Products>& options = {}) const {
			Run run{.pipeline = *this, .seed = seed, .input = input, .options = options, .result = {}};
			return run.go();
		}

		// Its stages, inert ones included: how many records a run's result holds.
		[[nodiscard]] size_t stageCount() const { return stages.size(); }

	  private:
		std::vector<Stage> stages;

		struct Run {
			const MapPipeline&				 pipeline;
			uint32_t						 seed;
			const Input&					 input;
			const PipelineOptions<Products>& options;
			PipelineResult<Products>		 result;

			PipelineResult<Products> go() {
				for (const Stage& stage : pipeline.stages) {
					result.stages.push_back({.name = stage.name});
				}
				const foundation::Rng root(seed);
				if (options.replay) {
					replay(root, *options.replay);
					return std::move(result);
				}
				for (uint32_t mapAttempt = 0; mapAttempt < kMapAttempts; ++mapAttempt) {
					result.products = Products{};
					if (runMap(root.fork("map", mapAttempt).seed(), mapAttempt)) {
						result.mapAttempt = mapAttempt;
						return std::move(result);
					}
				}
				throw MapPipelineError(seed, Exhausted::Map, result.failures.back());
			}

			// A local-retry stage's failing attempt it may keep.
			struct Keepable {
				uint32_t attempt{0};
				size_t	 problems{0};
			};

			// Each stage forks from its upstream's winning stream and counts its attempts from 0 whenever that changes.
			// One out of attempts escalates to the stage it names, which goes on from its next attempt; keeps its best,
			// if it's a local-retry stage with one it may keep; or restarts the map.
			bool runMap(uint32_t mapStream, uint32_t mapAttempt) {
				const size_t		  count = pipeline.stages.size();
				std::vector<uint32_t> upstreams(count, mapStream);
				std::vector<uint32_t> nextAttempt(count, 0);
				size_t				  index = 0;
				while (index < count) {
					const Stage&			stage = pipeline.stages[index];
					std::optional<uint32_t> winner;
					std::optional<Keepable> best;
					while (nextAttempt[index] < stage.attempts && !winner) {
						const uint32_t	   attempt = nextAttempt[index]++;
						foundation::Rng	   stream = foundation::Rng(upstreams[index]).fork(stage.name, attempt);
						const StageAttempt at = attemptAt(index, attempt, mapAttempt);
						Problems		   problems = attemptStage(index, at, stream, true);
						if (problems.empty()) {
							winner = stream.seed();
							result.stages[index].attempt = attempt;
							result.stages[index].stream = stream.seed();
							result.stages[index].kept = false;
							continue;
						}
						const bool keepable = stage.localRetry && (!stage.keepable || stage.keepable(problems));
						if (keepable && (!best || problems.size() < best->problems)) {
							best = Keepable{.attempt = attempt, .problems = problems.size()};
						}
						result.failures.push_back(
							{.stage = stage.name, .attempt = attempt, .mapAttempt = mapAttempt, .problems = std::move(problems)}
						);
					}
					if (!winner && best) {
						if (options.debug) {
							throw MapPipelineError(seed, Exhausted::Stage, result.failures.back());
						}
						LOG_ERROR(
							Game,
							"MapPipeline: seed %u map attempt %u: %s failed all %u attempts; keeping attempt %u, with %zu problems",
							seed,
							mapAttempt,
							stage.name.c_str(),
							stage.attempts,
							best->attempt,
							best->problems
						);
						winner = keep(index, upstreams[index], attemptAt(index, best->attempt, mapAttempt));
					}
					if (winner) {
						if (index + 1 < count) {
							upstreams[index + 1] = *winner;
							nextAttempt[index + 1] = 0;
						}
						index += 1;
						continue;
					}
					if (stage.escalate.empty()) {
						return false;
					}
					// The upstream stage's attempts are spent as its own are, so past its last its escalation applies.
					index = static_cast<size_t>(std::ranges::find(pipeline.stages, stage.escalate, &Stage::name) - pipeline.stages.begin());
				}
				return true;
			}

			[[nodiscard]] StageAttempt attemptAt(size_t index, uint32_t attempt, uint32_t mapAttempt) const {
				return {
					.stage = pipeline.stages[index].name,
					.index = index,
					.count = pipeline.stages.size(),
					.attempt = attempt,
					.mapAttempt = mapAttempt,
					.seed = seed,
				};
			}

			// A stage writes its product into the one products struct, which each later attempt overwrites, so the
			// attempt kept runs again on its stream, unchecked, and makes what it made before.
			uint32_t keep(size_t index, uint32_t upstream, const StageAttempt& at) {
				foundation::Rng stream = foundation::Rng(upstream).fork(pipeline.stages[index].name, at.attempt);
				(void)attemptStage(index, at, stream, false);
				StageRecord& record = result.stages[index];
				record.attempt = at.attempt;
				record.stream = stream.seed();
				record.kept = true;
				return stream.seed();
			}

			// Runs one attempt and, when `checked`, its check and then the accept hook.
			Problems attemptStage(size_t index, const StageAttempt& at, foundation::Rng& stream, bool checked) {
				const Stage& stage = pipeline.stages[index];
				if (options.cancel.stop_requested()) {
					throw MapPipelineCancelled(seed, stage.name);
				}
				if (options.onProgress) {
					options.onProgress(at);
				}
				const auto started = std::chrono::steady_clock::now();
				stage.run(input, result.products, stream);
				Problems problems;
				if (checked && stage.check) {
					problems = stage.check(input, result.products);
				}
				if (checked && problems.empty() && options.accept) {
					problems = options.accept(result.products, at);
				}
				StageRecord& record = result.stages[index];
				record.runs += 1;
				record.time += std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - started);
				return problems;
			}

			void replay(const foundation::Rng& root, const PipelineReplay& replay) {
				if (replay.mapAttempt >= kMapAttempts) {
					throw std::invalid_argument(
						"MapPipeline: map attempt " + std::to_string(replay.mapAttempt) + " is past the " + std::to_string(kMapAttempts) +
						" a seed gets"
					);
				}
				for (const auto& [name, attempt] : replay.attempts) {
					const bool known = std::ranges::any_of(pipeline.stages, [&](const Stage& stage) { return stage.name == name; });
					if (!known) {
						throw std::invalid_argument("MapPipeline: the replay names " + name + ", which isn't a stage");
					}
				}
				// Every stage's attempt is checked before any stage runs, so a replay that doesn't fit costs nothing. An inert
				// stage it names no attempt for runs its first.
				for (const Stage& stage : pipeline.stages) {
					const auto found = replay.attempts.find(stage.name);
					if (found == replay.attempts.end()) {
						if (stage.inert) {
							continue;
						}
						throw std::invalid_argument("MapPipeline: the replay has no attempt for " + stage.name);
					}
					if (found->second >= stage.attempts) {
						throw std::invalid_argument(
							"MapPipeline: " + stage.name + " attempt " + std::to_string(found->second) + " is past the " +
							std::to_string(stage.attempts) + " it gets"
						);
					}
				}
				result.mapAttempt = replay.mapAttempt;
				uint32_t upstream = root.fork("map", replay.mapAttempt).seed();
				for (size_t index = 0; index < pipeline.stages.size(); ++index) {
					const Stage&	   stage = pipeline.stages[index];
					const auto		   found = replay.attempts.find(stage.name);
					const uint32_t	   attempt = found == replay.attempts.end() ? 0 : found->second;
					foundation::Rng	   stream = foundation::Rng(upstream).fork(stage.name, attempt);
					const StageAttempt at = attemptAt(index, attempt, replay.mapAttempt);
					(void)attemptStage(index, at, stream, false);
					result.stages[index].attempt = attempt;
					result.stages[index].stream = stream.seed();
					upstream = stream.seed();
				}
			}
		};
	};

} // namespace rules::map
