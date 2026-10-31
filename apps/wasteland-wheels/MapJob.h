#pragma once

#include <rules/campaign/CampaignMap.h>

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

namespace game {

	// Where a map being made is, as the last stage attempt to start reported it: what the founding and loading scenes
	// show ("Making the area map: water (2 of 9)").
	struct MapProgress {
		std::string stage;
		// From 0, and how many stages there are.
		size_t	 index{0};
		size_t	 count{0};
		uint32_t attempt{0};
		uint32_t mapAttempt{0};
	};

	// A map made off the frame (map-pipeline-worker.md, The founding contract): the work runs on a thread of its own from
	// construction, a scene polls it from its update, and cancel() asks the work's MapMaking to stop, which the pipeline
	// reads before each stage attempt. Destroying a job still running cancels it and waits for it, at most a stage.
	template <typename Result>
	class MapJob {
	  public:
		using Work = std::function<Result(const rules::campaign::MapMaking& making)>;

		explicit MapJob(Work work)
			: worker([this, run = std::move(work)](std::stop_token stop) { runWork(run, std::move(stop)); }) {}

		~MapJob() = default;

		MapJob(const MapJob&) = delete;
		MapJob& operator=(const MapJob&) = delete;
		MapJob(MapJob&&) = delete;
		MapJob& operator=(MapJob&&) = delete;

		void			   cancel() { worker.request_stop(); }
		[[nodiscard]] bool cancelled() const { return worker.get_stop_token().stop_requested(); }
		// The work has returned or thrown, and take() has it.
		[[nodiscard]] bool done() const { return finished.load(std::memory_order_acquire); }

		[[nodiscard]] std::optional<MapProgress> progress() const {
			const std::scoped_lock lock(guard);
			return latest;
		}

		// What the work returned, or what it threw, rethrown; once, after done().
		[[nodiscard]] Result take() {
			if (!done()) {
				throw std::logic_error("MapJob::take before the work is done");
			}
			worker.join();
			if (failure) {
				std::rethrow_exception(std::exchange(failure, nullptr));
			}
			if (!result) {
				throw std::logic_error("MapJob::take twice");
			}
			Result taken = std::move(*result);
			result.reset();
			return taken;
		}

	  private:
		void runWork(const Work& run, std::stop_token stop) {
			const rules::campaign::MapMaking making{
				.onProgress =
					[this](const rules::map::StageAttempt& attempt) {
						const std::scoped_lock lock(guard);
						latest = MapProgress{
							.stage = std::string(attempt.stage),
							.index = attempt.index,
							.count = attempt.count,
							.attempt = attempt.attempt,
							.mapAttempt = attempt.mapAttempt,
						};
					},
				.cancel = std::move(stop),
			};
			try {
				result.emplace(run(making));
			} catch (...) {
				failure = std::current_exception();
			}
			finished.store(true, std::memory_order_release);
		}

		mutable std::mutex		   guard;
		std::optional<MapProgress> latest;
		std::optional<Result>	   result;
		std::exception_ptr		   failure;
		std::atomic<bool>		   finished{false};
		// Last, so it starts once everything it writes to is made, and stops before any of it goes.
		std::jthread worker;
	};

} // namespace game
