#include <rules/map/MapPipeline.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

	using namespace rules::map;

	// Stand-in stages: each stores its stream's first draw, so a test can see which stream it ran on.
	struct Draws {
		std::optional<uint32_t> first;
		std::optional<uint32_t> second;
	};

	struct Script {
		// How many runs of each stage fail their check before one passes, counted across map attempts.
		int firstFailures = 0;
		int secondFailures = 0;
	};

	using Pipeline = MapPipeline<Script, Draws>;

	Pipeline standIns(int* firstRuns, int* secondRuns, uint32_t secondAttempts = kStageAttempts) {
		return Pipeline{}
			.then({
				.name = "first",
				.run = [](const Script&, Draws& draws, foundation::Rng& stream) { draws.first = stream.nextUInt32(); },
				.check = [firstRuns](
							 const Script& script, const Draws&
						 ) { return (*firstRuns)++ < script.firstFailures ? Problems{"first: not yet"} : Problems{}; },
			})
			.then({
				.name = "second",
				.attempts = secondAttempts,
				.run = [](const Script&, Draws& draws, foundation::Rng& stream) { draws.second = stream.nextUInt32(); },
				.check =
					[secondRuns](const Script& script, const Draws& draws) {
						EXPECT_TRUE(draws.first.has_value()) << "second ran before first";
						return (*secondRuns)++ < script.secondFailures ? Problems{"second: not yet"} : Problems{};
					},
			});
	}

	uint32_t firstDraw(uint32_t seed) {
		return foundation::Rng(seed).nextUInt32();
	}

	TEST(MapPipeline, NestsEachStagesStreamInItsUpstreamsWinnerAndRetriesOnTheNextAttempt) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		const Script				script{.firstFailures = 2};
		const PipelineResult<Draws> result = standIns(&firstRuns, &secondRuns).run(7, script);
		const foundation::Rng		map = foundation::Rng(7).fork("map", 0);
		const uint32_t				first = map.fork("first", 2).seed();
		const uint32_t				second = foundation::Rng(first).fork("second", 0).seed();
		EXPECT_EQ(result.mapAttempt, 0U);
		ASSERT_EQ(result.stages.size(), 2U);
		EXPECT_EQ(result.stages[0].attempt, 2U);
		EXPECT_EQ(result.stages[0].stream, first);
		EXPECT_EQ(result.stages[0].runs, 3U);
		EXPECT_EQ(result.stages[1].attempt, 0U);
		EXPECT_EQ(result.stages[1].stream, second);
		EXPECT_EQ(result.products.first, firstDraw(first));
		EXPECT_EQ(result.products.second, firstDraw(second));
		ASSERT_EQ(result.failures.size(), 2U);
		EXPECT_EQ(result.failures[1].stage, "first");
		EXPECT_EQ(result.failures[1].attempt, 1U);
		EXPECT_EQ(result.failures[1].problems, Problems{"first: not yet"});
	}

	TEST(MapPipeline, RestartsTheMapOnItsNextAttemptWhenAStageRunsOutUpstreamIncluded) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		const Script				script{.secondFailures = 3};
		const PipelineResult<Draws> result = standIns(&firstRuns, &secondRuns, 2).run(7, script);
		// Map 0 ran out after two seconds; map 1's second failed once more, then passed.
		EXPECT_EQ(result.mapAttempt, 1U);
		EXPECT_EQ(result.stages[0].attempt, 0U);
		EXPECT_EQ(result.stages[0].stream, foundation::Rng(7).fork("map", 1).fork("first", 0).seed());
		EXPECT_EQ(result.stages[1].attempt, 1U);
		EXPECT_EQ(result.stages[0].runs, 2U);
		EXPECT_EQ(result.stages[1].runs, 4U);
		ASSERT_EQ(result.failures.size(), 3U);
		EXPECT_EQ(result.failures[2].mapAttempt, 1U);
	}

	TEST(MapPipeline, GivesUpPastTheMapCapNamingTheLastFailureAndNeverMovesSeed) {
		int	   firstRuns = 0;
		int	   secondRuns = 0;
		Script script{.secondFailures = 1000};
		try {
			(void)standIns(&firstRuns, &secondRuns, 1).run(7, script);
			FAIL() << "expected a MapPipelineError";
		} catch (const MapPipelineError& error) {
			EXPECT_EQ(error.failure.stage, "second");
			EXPECT_EQ(error.failure.mapAttempt, kMapAttempts - 1);
			EXPECT_NE(std::string(error.what()).find("seed 7 failed 32 map attempts"), std::string::npos) << error.what();
		}
		EXPECT_EQ(secondRuns, static_cast<int>(kMapAttempts));
	}

	TEST(MapPipeline, CountsTheAcceptHooksRejectionAsTheStageFailing) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		int							rejected = 0;
		std::vector<uint32_t>		acceptedAt;
		const PipelineResult<Draws> result =
			standIns(&firstRuns, &secondRuns).run(7, Script{}, {.accept = [&](const Draws& draws, const StageAttempt& attempt) {
													  EXPECT_EQ(attempt.count, 2U);
													  EXPECT_EQ(attempt.seed, 7U);
													  if (attempt.stage == "second" && rejected++ == 0) {
														  return Problems{"validator: no"};
													  }
													  EXPECT_EQ(draws.second.has_value(), attempt.stage == "second");
													  acceptedAt.push_back(attempt.attempt);
													  return Problems{};
												  }});
		EXPECT_EQ(result.stages[1].attempt, 1U);
		EXPECT_EQ(acceptedAt, (std::vector<uint32_t>{0, 1}));
		ASSERT_EQ(result.failures.size(), 1U);
		EXPECT_EQ(result.failures[0].problems, Problems{"validator: no"});
	}

	TEST(MapPipeline, ReplaysARunsWinnersOnTheirStreamsCheckingNothing) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		const PipelineResult<Draws> original = standIns(&firstRuns, &secondRuns, 2).run(9, Script{.firstFailures = 1, .secondFailures = 2});
		const int					checksBefore = firstRuns + secondRuns;
		const PipelineReplay		replay{
				   .mapAttempt = original.mapAttempt,
				   .attempts = {{"first", original.stages[0].attempt}, {"second", original.stages[1].attempt}},
		   };
		const PipelineResult<Draws> again = standIns(&firstRuns, &secondRuns, 2).run(9, Script{}, {.replay = replay});
		EXPECT_EQ(firstRuns + secondRuns, checksBefore);
		EXPECT_EQ(again.mapAttempt, original.mapAttempt);
		EXPECT_EQ(again.products.first, original.products.first);
		EXPECT_EQ(again.products.second, original.products.second);
		EXPECT_EQ(again.stages[1].stream, original.stages[1].stream);
		EXPECT_TRUE(again.failures.empty());
	}

	TEST(MapPipeline, RefusesAReplayThatDoesntFitThePipeline) {
		int			   firstRuns = 0;
		int			   secondRuns = 0;
		const Pipeline pipeline = standIns(&firstRuns, &secondRuns, 2);
		int			   started = 0;
		const auto	   replayWith = [&](PipelineReplay replay) {
			(void)pipeline.run(9, Script{}, {.onProgress = [&](const StageAttempt&) { started += 1; }, .replay = std::move(replay)});
		};
		EXPECT_THROW((replayWith({.mapAttempt = 0, .attempts = {{"first", 0}}})), std::invalid_argument);
		EXPECT_THROW((replayWith({.mapAttempt = 0, .attempts = {{"first", 0}, {"second", 0}, {"third", 0}}})), std::invalid_argument);
		EXPECT_THROW((replayWith({.mapAttempt = 0, .attempts = {{"first", 0}, {"second", 2}}})), std::invalid_argument);
		EXPECT_THROW((replayWith({.mapAttempt = kMapAttempts, .attempts = {{"first", 0}, {"second", 0}}})), std::invalid_argument);
		// Before any stage runs, the last stage's attempt included.
		EXPECT_EQ(started, 0);
	}

} // namespace
