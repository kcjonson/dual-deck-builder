#pragma once

#include <random/Rng.h>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rules::map {

	// Attempts a stage gets, unless it sets its own, before the map restarts.
	inline constexpr uint32_t kStageAttempts = 8;
	// Map attempts on one seed before the run throws; founding answers that with the next seed.
	inline constexpr uint32_t kMapAttempts = 32;

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

	// Every map attempt on the seed failed. The runner never moves to another seed itself.
	class MapPipelineError : public std::runtime_error {
	  public:
		MapPipelineError(uint32_t seed, StageFailure last)
			: std::runtime_error(
				  "MapPipeline: seed " + std::to_string(seed) + " failed " + std::to_string(kMapAttempts) +
				  " map attempts; the last ran out on " + last.stage + " attempt " + std::to_string(last.attempt) + ": " +
				  (last.problems.empty() ? "" : last.problems.front())
			  ),
			  failure(std::move(last)) {}

		StageFailure failure;
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
		// counting from 0 again.
		std::string escalate{};
	};

	// The map so far, with the stage that just passed its own check in it; anything returned rejects that
	// stage's output as a failed check would. Where the map validator plugs in.
	template <typename Products>
	using AcceptHook = std::function<Problems(const Products&, const StageAttempt&)>;

	// Where a map sits among its seed's attempts: with the seed and the input, all it takes to make it
	// again, which is what a load does.
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
	};

	struct StageRecord {
		std::string name;
		// The winning attempt and its stream's seed: foundation::Rng(stream) replays it.
		uint32_t attempt{0};
		uint32_t stream{0};
		// Every attempt run, across every map attempt, and the time they took, checks included.
		uint32_t				 runs{0};
		std::chrono::nanoseconds time{0};
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
	// a MapPipelineError. fork reads only its parent's seed, so how many draws a stage made never moves its
	// children, and a failed attempt leaves nothing behind.
	template <typename Input, typename Products>
	class MapPipeline {
	  public:
		using Stage = MapStage<Input, Products>;

		[[nodiscard]] MapPipeline then(Stage stage) const {
			assert(!stage.name.empty() && stage.attempts >= 1 && stage.run && "MapPipeline: a stage has a name, an attempt, and a run");
			for ([[maybe_unused]] const Stage& earlier : stages) {
				assert(earlier.name != stage.name && "MapPipeline: stage names are unique");
			}
			assert(
				(stage.escalate.empty() ||
				 std::ranges::any_of(stages, [&](const Stage& earlier) { return earlier.name == stage.escalate; })) &&
				"MapPipeline: a stage escalates only to one upstream of it"
			);
			MapPipeline next = *this;
			next.stages.push_back(std::move(stage));
			return next;
		}

		[[nodiscard]] PipelineResult<Products> run(uint32_t seed, const Input& input, const PipelineOptions<Products>& options = {}) const {
			Run run{.pipeline = *this, .seed = seed, .input = input, .options = options, .result = {}};
			return run.go();
		}

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
				throw MapPipelineError(seed, result.failures.back());
			}

			// Each stage forks from its upstream's winning stream and counts its attempts from 0 whenever that changes.
			// One out of attempts escalates to the stage it names, which goes on from its next attempt, or with none
			// restarts the map.
			bool runMap(uint32_t mapStream, uint32_t mapAttempt) {
				const size_t		  count = pipeline.stages.size();
				std::vector<uint32_t> upstreams(count, mapStream);
				std::vector<uint32_t> nextAttempt(count, 0);
				size_t				  index = 0;
				while (index < count) {
					const Stage&			stage = pipeline.stages[index];
					std::optional<uint32_t> winner;
					while (nextAttempt[index] < stage.attempts && !winner) {
						const uint32_t	   attempt = nextAttempt[index]++;
						foundation::Rng	   stream = foundation::Rng(upstreams[index]).fork(stage.name, attempt);
						const StageAttempt at{
							.stage = stage.name,
							.index = index,
							.count = pipeline.stages.size(),
							.attempt = attempt,
							.mapAttempt = mapAttempt,
							.seed = seed,
						};
						Problems problems = attemptStage(index, at, stream, true);
						if (problems.empty()) {
							winner = stream.seed();
							result.stages[index].attempt = attempt;
							result.stages[index].stream = stream.seed();
						} else {
							result.failures.push_back(
								{.stage = stage.name, .attempt = attempt, .mapAttempt = mapAttempt, .problems = std::move(problems)}
							);
						}
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

			// Runs one attempt and, when `checked`, its check and then the accept hook.
			Problems attemptStage(size_t index, const StageAttempt& at, foundation::Rng& stream, bool checked) {
				const Stage& stage = pipeline.stages[index];
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
				// Every stage's attempt is checked before any stage runs, so a replay that doesn't fit costs nothing.
				for (const Stage& stage : pipeline.stages) {
					const auto found = replay.attempts.find(stage.name);
					if (found == replay.attempts.end()) {
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
					const uint32_t	   attempt = replay.attempts.find(stage.name)->second;
					foundation::Rng	   stream = foundation::Rng(upstream).fork(stage.name, attempt);
					const StageAttempt at{
						.stage = stage.name,
						.index = index,
						.count = pipeline.stages.size(),
						.attempt = attempt,
						.mapAttempt = replay.mapAttempt,
						.seed = seed,
					};
					(void)attemptStage(index, at, stream, false);
					result.stages[index].attempt = attempt;
					result.stages[index].stream = stream.seed();
					upstream = stream.seed();
				}
			}
		};
	};

} // namespace rules::map
