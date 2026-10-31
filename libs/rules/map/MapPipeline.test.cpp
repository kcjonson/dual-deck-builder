#include <rules/map/MapPipeline.h>

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <functional>
#include <map>
#include <optional>
#include <stdexcept>
#include <stop_token>
#include <string>
#include <utility>
#include <vector>

namespace {

	using namespace rules::map;

	// Stand-in stages: each stores its stream's first draw, so a test can see which stream it ran on.
	struct Draws {
		std::optional<uint32_t> first;
		std::optional<uint32_t> second;
		std::optional<uint32_t> third;
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

	// The stand-ins and a third stage after them, which escalates to the first and fails its first `failures` runs.
	struct Escalating {
		Pipeline pipeline;
		int		 thirdRuns = 0;

		Escalating(int* firstRuns, int* secondRuns, int failures) {
			pipeline = standIns(firstRuns, secondRuns)
						   .then({
							   .name = "third",
							   .run = [](const Script&, Draws&, foundation::Rng&) {},
							   .check = [this, failures](
											const Script&, const Draws&
										) { return thirdRuns++ < failures ? Problems{"third: not yet"} : Problems{}; },
							   .escalate = "first",
						   });
		}
	};

	TEST(MapPipeline, EscalatesToTheStageItNamesWhichGoesOnFromItsNextAttemptAndEverythingAfterOnFreshStreams) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		Escalating					escalating(&firstRuns, &secondRuns, static_cast<int>(kStageAttempts) + 2);
		const PipelineResult<Draws> result = escalating.pipeline.run(9, Script{});
		EXPECT_EQ(result.mapAttempt, 0U);
		ASSERT_EQ(result.stages.size(), 3U);
		// Out of its eight, it reran the first on attempt 1, then failed twice more under it.
		EXPECT_EQ(result.stages[0].attempt, 1U);
		EXPECT_EQ(result.stages[1].attempt, 0U);
		EXPECT_EQ(result.stages[2].attempt, 2U);
		EXPECT_EQ(escalating.thirdRuns, static_cast<int>(kStageAttempts) + 3);
		const uint32_t first = foundation::Rng(9).fork("map", 0).fork("first", 1).seed();
		EXPECT_EQ(result.stages[0].stream, first);
		EXPECT_EQ(result.stages[1].stream, foundation::Rng(first).fork("second", 0).seed());
		EXPECT_EQ(result.stages[2].stream, foundation::Rng(result.stages[1].stream).fork("third", 2).seed());
		EXPECT_EQ(result.products.first, firstDraw(first));
	}

	TEST(MapPipeline, RestartsTheMapOnceAnEscalationHasSpentItsUpstreamsAttempts) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		const int					perMap = static_cast<int>(kStageAttempts * kStageAttempts);
		Escalating					escalating(&firstRuns, &secondRuns, perMap);
		const PipelineResult<Draws> result = escalating.pipeline.run(9, Script{});
		EXPECT_EQ(result.mapAttempt, 1U);
		EXPECT_EQ(firstRuns, static_cast<int>(kStageAttempts) + 1);
		EXPECT_EQ(result.stages[0].attempt, 0U);
	}

	// The stand-ins and a local-retry third stage whose runs fail with the problems the script lists, run by run across
	// map attempts, and pass once it runs out of them.
	struct LocalRetry {
		Pipeline			  pipeline;
		int					  thirdRuns = 0;
		std::vector<Problems> failing;

		LocalRetry(int* firstRuns, int* secondRuns, std::vector<Problems> script, std::function<bool(const Problems&)> keepable = {})
			: failing(std::move(script)) {
			pipeline = standIns(firstRuns, secondRuns)
						   .then({
							   .name = "third",
							   .run = [](const Script&, Draws& draws, foundation::Rng& stream) { draws.third = stream.nextUInt32(); },
							   .check =
								   [this](const Script&, const Draws&) {
									   const auto run = static_cast<size_t>(thirdRuns++);
									   return run < failing.size() ? failing[run] : Problems{};
								   },
							   .localRetry = true,
							   .keepable = std::move(keepable),
						   });
		}
	};

	TEST(MapPipeline, RetriesALocalRetryStageAloneLeavingTheStagesBeforeItOnTheirStreams) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		LocalRetry					local(&firstRuns, &secondRuns, {{"third: not yet"}, {"third: not yet"}});
		const PipelineResult<Draws> result = local.pipeline.run(9, Script{});
		EXPECT_EQ(result.mapAttempt, 0U);
		EXPECT_EQ(firstRuns, 1);
		EXPECT_EQ(secondRuns, 1);
		EXPECT_EQ(result.stages[0].attempt, 0U);
		EXPECT_EQ(result.stages[1].attempt, 0U);
		EXPECT_EQ(result.stages[2].attempt, 2U);
		EXPECT_FALSE(result.stages[2].kept);
		EXPECT_EQ(result.stages[2].stream, foundation::Rng(result.stages[1].stream).fork("third", 2).seed());
	}

	TEST(MapPipeline, PastALocalRetryStagesCapAReleaseRunKeepsItsFewestProblemsAndADebugRunThrows) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		const Problems				one{"third: no"};
		const Problems				two{"third: no", "third: nor that"};
		const std::vector<Problems> script{two, two, one, two, one, two, two, two};
		LocalRetry					release(&firstRuns, &secondRuns, script);
		const PipelineResult<Draws> kept = release.pipeline.run(9, Script{}, {.debug = false});
		EXPECT_EQ(kept.mapAttempt, 0U);
		// The earlier of the two with one problem, run again on its stream.
		EXPECT_EQ(kept.stages[2].attempt, 2U);
		EXPECT_TRUE(kept.stages[2].kept);
		EXPECT_EQ(kept.stages[2].runs, kStageAttempts + 1);
		const uint32_t stream = foundation::Rng(kept.stages[1].stream).fork("third", 2).seed();
		EXPECT_EQ(kept.stages[2].stream, stream);
		EXPECT_EQ(kept.products.third, firstDraw(stream));
		EXPECT_EQ(kept.failures.size(), kStageAttempts);
		LocalRetry debug(&firstRuns, &secondRuns, script);
		try {
			(void)debug.pipeline.run(9, Script{}, {.debug = true});
			FAIL() << "expected a MapPipelineError";
		} catch (const MapPipelineError& error) {
			EXPECT_EQ(error.exhausted, Exhausted::Stage);
			EXPECT_EQ(error.failure.stage, "third");
			EXPECT_EQ(error.failure.mapAttempt, 0U);
		}
	}

	TEST(MapPipeline, RestartsTheMapWhenALocalRetryStageMayKeepNoneOfItsAttemptsInAnyBuild) {
		const std::vector<Problems> script(kStageAttempts, Problems{"floor: none", "band: short"});
		const auto					keepable = [](const Problems& problems) {
			 return std::ranges::none_of(problems, [](const std::string& problem) { return problem.starts_with("floor: "); });
		};
		for (const bool debug : {true, false}) {
			int							firstRuns = 0;
			int							secondRuns = 0;
			LocalRetry					local(&firstRuns, &secondRuns, script, keepable);
			const PipelineResult<Draws> result = local.pipeline.run(9, Script{}, {.debug = debug});
			EXPECT_EQ(result.mapAttempt, 1U);
			EXPECT_EQ(result.stages[2].attempt, 0U);
			EXPECT_FALSE(result.stages[2].kept);
			EXPECT_EQ(firstRuns, 2);
		}
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

	// An inert stage, its runs failing with the problems the script lists, run by run, and passing once it runs out.
	MapStage<Script, Draws> inertStage(std::string name, int* runs, std::vector<Problems> failing = {}) {
		return {
			.name = std::move(name),
			.run = [](const Script&, Draws& draws, foundation::Rng& stream) { draws.third = stream.nextUInt32(); },
			.check =
				[runs, failing = std::move(failing)](const Script&, const Draws&) {
					const auto run = static_cast<size_t>((*runs)++);
					return run < failing.size() ? failing[run] : Problems{};
				},
			.inert = true,
		};
	}

	TEST(MapPipeline, RetriesAnInertStageAloneAndPastItsCapKeepsItsBestInAReleaseRunAndThrowsInADebugOne) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		int							thirdRuns = 0;
		const PipelineResult<Draws> retried =
			standIns(&firstRuns, &secondRuns).then(inertStage("third", &thirdRuns, {{"third: not yet"}})).run(9, Script{});
		EXPECT_EQ(firstRuns, 1);
		EXPECT_EQ(secondRuns, 1);
		EXPECT_EQ(retried.stages[2].attempt, 1U);
		EXPECT_EQ(retried.stages[2].stream, foundation::Rng(retried.stages[1].stream).fork("third", 1).seed());
		const Problems				one{"third: no"};
		const Problems				two{"third: no", "third: nor that"};
		const std::vector<Problems> script{two, one, two, two, two, two, two, two};
		thirdRuns = 0;
		const PipelineResult<Draws> kept =
			standIns(&firstRuns, &secondRuns).then(inertStage("third", &thirdRuns, script)).run(9, Script{}, {.debug = false});
		EXPECT_EQ(kept.mapAttempt, 0U);
		EXPECT_EQ(kept.stages[2].attempt, 1U);
		EXPECT_TRUE(kept.stages[2].kept);
		thirdRuns = 0;
		EXPECT_THROW(
			(void)standIns(&firstRuns, &secondRuns).then(inertStage("third", &thirdRuns, script)).run(9, Script{}, {.debug = true}),
			MapPipelineError
		);
	}

	// So a save made before an inert stage existed, or one that leaves it out, makes the same map with it.
	TEST(MapPipeline, ReplaysAnInertStageTheReplayNamesNoAttemptForOnItsFirst) {
		int							firstRuns = 0;
		int							secondRuns = 0;
		int							thirdRuns = 0;
		const Pipeline				pipeline = standIns(&firstRuns, &secondRuns).then(inertStage("third", &thirdRuns, {{"no"}, {"no"}}));
		const PipelineResult<Draws> original = pipeline.run(9, Script{.firstFailures = 1});
		ASSERT_EQ(original.stages[2].attempt, 2U);
		const std::map<std::string, uint32_t, std::less<>> gameplay{
			{"first", original.stages[0].attempt},
			{"second", original.stages[1].attempt},
		};
		const PipelineResult<Draws> unnamed = pipeline.run(9, Script{}, {.replay = PipelineReplay{.mapAttempt = 0, .attempts = gameplay}});
		EXPECT_EQ(unnamed.products.first, original.products.first);
		EXPECT_EQ(unnamed.products.second, original.products.second);
		EXPECT_EQ(unnamed.stages[2].attempt, 0U);
		EXPECT_EQ(unnamed.stages[2].stream, foundation::Rng(original.stages[1].stream).fork("third", 0).seed());
		std::map<std::string, uint32_t, std::less<>> named = gameplay;
		named["third"] = 2;
		const PipelineResult<Draws> again = pipeline.run(9, Script{}, {.replay = PipelineReplay{.mapAttempt = 0, .attempts = named}});
		EXPECT_EQ(again.products.third, original.products.third);
		// A gameplay stage it leaves out is still refused.
		EXPECT_THROW(
			(void)pipeline.run(9, Script{}, {.replay = PipelineReplay{.mapAttempt = 0, .attempts = {{"first", 0}, {"third", 0}}}}),
			std::invalid_argument
		);
	}

	// A stop requested as the first stage's second attempt starts lets that attempt finish, check and all, and the run
	// throws before the second stage, handing back nothing it made.
	TEST(MapPipeline, StopsBetweenStageAttemptsOnceCancelled) {
		int						 firstRuns = 0;
		int						 secondRuns = 0;
		std::stop_source		 source;
		std::vector<std::string> started;
		try {
			(void)standIns(&firstRuns, &secondRuns)
				.run(
					7,
					Script{.firstFailures = 1},
					{.onProgress =
						 [&](const StageAttempt& attempt) {
							 started.emplace_back(attempt.stage);
							 if (attempt.attempt == 1) {
								 source.request_stop();
							 }
						 },
					 .cancel = source.get_token()}
				);
			FAIL() << "expected a MapPipelineCancelled";
		} catch (const MapPipelineCancelled& cancelled) {
			EXPECT_EQ(cancelled.before, "second");
		}
		EXPECT_EQ(started, (std::vector<std::string>{"first", "first"}));
		EXPECT_EQ(firstRuns, 2);
		EXPECT_EQ(secondRuns, 0);
	}

	TEST(MapPipeline, CancelsAReplayBetweenItsStagesAndARunStoppedBeforeItStartsRunsNothing) {
		int						 firstRuns = 0;
		int						 secondRuns = 0;
		const Pipeline			 pipeline = standIns(&firstRuns, &secondRuns);
		std::stop_source		 source;
		std::vector<std::string> started;
		const auto				 progress = [&](const StageAttempt& attempt) {
			  started.emplace_back(attempt.stage);
			  source.request_stop();
		};
		const PipelineReplay replay{.mapAttempt = 0, .attempts = {{"first", 0}, {"second", 0}}};
		EXPECT_THROW(
			(void)pipeline.run(7, Script{}, {.onProgress = progress, .replay = replay, .cancel = source.get_token()}), MapPipelineCancelled
		);
		EXPECT_EQ(started, (std::vector<std::string>{"first"}));
		EXPECT_THROW((void)pipeline.run(7, Script{}, {.onProgress = progress, .cancel = source.get_token()}), MapPipelineCancelled);
		EXPECT_EQ(started.size(), 1U);
		EXPECT_EQ(firstRuns + secondRuns, 0);
	}

	TEST(MapPipeline, LetsOnlyAnInertStageFollowAnInertOneNestingEachInTheOneBefore) {
		int			   firstRuns = 0;
		int			   secondRuns = 0;
		int			   inertRuns = 0;
		const Pipeline dressed =
			standIns(&firstRuns, &secondRuns).then(inertStage("third", &inertRuns)).then(inertStage("fourth", &inertRuns));
		EXPECT_EQ(dressed.stageCount(), 4U);
		const PipelineResult<Draws> result = dressed.run(9, Script{});
		EXPECT_EQ(result.stages[3].stream, foundation::Rng(result.stages[2].stream).fork("fourth", 0).seed());
		const MapStage<Script, Draws> gameplay{.name = "fifth", .run = [](const Script&, Draws&, foundation::Rng&) {}};
		EXPECT_DEBUG_DEATH((void)dressed.then(gameplay), "only an inert stage follows an inert one");
		MapStage<Script, Draws> keeping = inertStage("fifth", &inertRuns);
		keeping.keepable = [](const Problems&) {
			return true;
		};
		EXPECT_DEBUG_DEATH((void)dressed.then(keeping), "an inert stage may keep any attempt");
		MapStage<Script, Draws> escalating = inertStage("fifth", &inertRuns);
		escalating.escalate = "first";
		EXPECT_DEBUG_DEATH((void)dressed.then(escalating), "retries only itself");
	}

} // namespace
