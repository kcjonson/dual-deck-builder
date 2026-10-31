#include <rules/core/RandomStreams.h>

#include <gtest/gtest.h>

namespace {

	using rules::RandomStreams;

	TEST(RandomStreams, ACopyDrawsWhatTheOriginalWould) {
		RandomStreams original(7);
		(void)original.next("deal");
		RandomStreams copy = original;
		EXPECT_EQ(copy, original);
		EXPECT_EQ(copy.next("deal").nextUInt32(), original.next("deal").nextUInt32());
		EXPECT_EQ(copy.next("hit").nextUInt32(), original.next("hit").nextUInt32());
	}

	TEST(RandomStreams, EachEventGetsItsOwnDraws) {
		RandomStreams streams(7);
		const uint32_t first = streams.next("deal").nextUInt32();
		const uint32_t second = streams.next("deal").nextUInt32();
		EXPECT_NE(first, second);
		EXPECT_EQ(streams.eventsOn("deal"), 2U);
	}

	TEST(RandomStreams, DrawingOnOneStreamLeavesTheOthers) {
		RandomStreams quiet(7);
		RandomStreams busy(7);
		for (int event = 0; event < 5; ++event) {
			(void)busy.next("hit");
		}
		EXPECT_EQ(busy.next("deal").nextUInt32(), quiet.next("deal").nextUInt32());
		EXPECT_EQ(quiet.eventsOn("hit"), 0U);
	}

	TEST(RandomStreams, SeedsDrawApart) {
		RandomStreams one(7);
		RandomStreams other(8);
		EXPECT_NE(one.next("deal").nextUInt32(), other.next("deal").nextUInt32());
	}

} // namespace
