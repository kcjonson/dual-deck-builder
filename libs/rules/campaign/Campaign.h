#pragma once

#include <rules/core/Ids.h>
#include <rules/core/JsonReader.h>

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace rules::campaign {

	// The campaign as a plain value (campaign.md): everything a save keeps, from founding to the run out. The functions
	// beside it (Founding.h, Locker.h, RunDecks.h, CombatBridge.h) are how play changes it, and CampaignJson.h reads and
	// writes it.

	// The campaign's own ids, each handed out once from a counter the save keeps, so none is ever reused: a driver in
	// the pool is "driver-3", an escort in the convoy "escort-2", a run "run-5".
	using CrewId = Id<struct CrewTag>;
	using ConvoyId = Id<struct ConvoyTag>;
	using RunId = Id<struct RunTag>;

	inline constexpr std::string_view kCrewPrefix = "driver-";
	inline constexpr std::string_view kConvoyPrefix = "escort-";
	inline constexpr std::string_view kRunPrefix = "run-";

	// The number in an id like "driver-3", or nullopt for one that isn't `prefix` and a number from 1.
	[[nodiscard]] std::optional<int> idNumber(std::string_view id, std::string_view prefix);

	// The compound's stores (Compound and Supply Runs, Resources), and a run's cargo: whole numbers, never below 0.
	struct Resources {
		int food{0};
		int water{0};
		int fuel{0};
		int meds{0};
		int scrap{0};
		int people{0};

		bool operator==(const Resources&) const = default;
	};

	[[nodiscard]] Resources operator+(const Resources& left, const Resources& right);

	// The compound's buildings (Compound and Supply Runs, Buildings), in the order the compound numbers them.
	enum class Building { Bunkhouse, RadioMast, Infirmary, MapRoom, Garage, Stores };

	inline constexpr EnumNames<Building, 6> kBuildingNames{{
		{"bunkhouse", Building::Bunkhouse},
		{"radio_mast", Building::RadioMast},
		{"infirmary", Building::Infirmary},
		{"map_room", Building::MapRoom},
		{"garage", Building::Garage},
		{"stores", Building::Stores},
	}};

	// How many copies of each card a deck, the locker, or a run's cargo holds. Copies have no identity, so a count is all
	// there is to one. A card with none isn't listed, so equal counts compare and write the same.
	using CardCounts = std::map<CardId, int>;

	[[nodiscard]] int countOf(const CardCounts& counts, const CardId& card);
	[[nodiscard]] int totalCards(const CardCounts& counts);
	void			  addCards(CardCounts& counts, const CardId& card, int count);
	void			  addCards(CardCounts& counts, const CardCounts& more);
	// Asserts the counts hold that many.
	void takeCards(CardCounts& counts, const CardId& card, int count);

	enum class DriverStatus { Ready, Injured, Dead, Missing };

	inline constexpr EnumNames<DriverStatus, 4> kDriverStatusNames{{
		{"ready", DriverStatus::Ready},
		{"injured", DriverStatus::Injured},
		{"dead", DriverStatus::Dead},
		{"missing", DriverStatus::Missing},
	}};

	// The damage a driver's own vehicle carries between fights. A wreck limps on, so structure is at least 1.
	struct VehicleCondition {
		int structure{0};
		int armor{0};

		bool operator==(const VehicleCondition&) const = default;
	};

	// A driver in the compound's pool (Compound and Supply Runs, The driver pool). It keeps what play changes; max HP,
	// skills, adrenaline, the hand limit, and the vehicle's maximums are the archetype's, read from the packs each
	// fight (call 394). A fight clamps HP and the vehicle to those maximums as they stand, so a retune doesn't break a
	// save. Who they are on screen, "Road Warrior 2", is their archetype and how many of it joined the pool before them.
	struct DriverRecord {
		CrewId		 id;
		DriverId	 archetype;
		DriverStatus status{DriverStatus::Ready};
		// 0 exactly when dead.
		int hitpoints{0};
		// Day ends until fit, above 0 exactly while injured.
		int				 injuredDays{0};
		VehicleCondition vehicle;
		// Empty while the driver is out on a run, whose run deck holds it, and once they're dead.
		CardCounts defaultDeck;

		bool operator==(const DriverRecord&) const = default;
	};

	// The most escorts the convoy holds (Combat Rules, Owning escorts).
	inline constexpr int kMostEscorts = 4;

	// An escort in the compound's convoy. Its type gives everything but the structure it carries from earlier fights
	// (call 395), at least 1, since a wreck is lost.
	struct ConvoyEscort {
		ConvoyId id;
		EscortId type;
		int		 structure{0};

		bool operator==(const ConvoyEscort&) const = default;
	};

	// The signature order an escort that came along brings into a run deck (Compound and Supply Runs, At load out):
	// locked there, outside the deck limits, and gone when the run ends or the escort is lost. It's never the compound's.
	struct EscortCard {
		CardId	 card;
		ConvoyId broughtBy;

		bool operator==(const EscortCard&) const = default;
	};

	// A seated driver's deck for one run (run-decks.md). While the run is out it holds their whole default deck, the
	// copies going (`own`) and the ones staying home for them (`leftHome`), beside what they borrowed from the locker and
	// the escorts' cards. No card is both left at home and borrowed: into a run deck the driver's own come back first,
	// and out of one borrowed copies go back first.
	struct RunDeck {
		CrewId					driver;
		CardCounts				own;
		CardCounts				leftHome;
		CardCounts				borrowed;
		std::vector<EscortCard> escortCards;

		bool operator==(const RunDeck&) const = default;
	};

	// What the deck rules count and a fight deals besides the escort cards: the driver's own going, and what they borrowed.
	[[nodiscard]] CardCounts runDeckCards(const RunDeck& deck);

	// A supply run out from the compound: who went with what, and what it has picked up on the way.
	struct Run {
		RunId id;
		// The game stage it left at, which grows its fights (Runs and Encounters, Game stage).
		int stage{0};
		// Driver 1 first; one or two.
		std::vector<RunDeck> seats;
		// The convoy's escorts that came along, in roster order, each with one card in a run deck.
		std::vector<ConvoyId> escorts;
		// What it brings home, or loses with a failed run: resources, and the cards it won (call 19).
		Resources  cargo;
		CardCounts cargoCards;
		// Fights written back so far, which names the next one's seed.
		int fights{0};

		bool operator==(const Run&) const = default;
	};

	// A pack a campaign was made with. A save loads only with every one of them loaded.
	struct PackRef {
		PackId		id;
		std::string version;

		bool operator==(const PackRef&) const = default;
	};

	struct Campaign {
		// In load order.
		std::vector<PackRef> packs;
		// Every draw the campaign makes forks from it, by a name and a saved counter, so nothing is saved mid-stream.
		uint32_t  seed{0};
		int		  day{1};
		Resources stores;
		int		  unrest{0};
		// Standing, in building order, each once.
		std::vector<Building> buildings;
		// Everyone the compound has had, in the order they joined, the dead and the missing included.
		std::vector<DriverRecord> drivers;
		int						  nextDriverNumber{1};
		CardCounts				  locker;
		// In roster order, the order they joined.
		std::vector<ConvoyEscort> convoy;
		int						  nextEscortNumber{1};
		std::optional<Run>		  run;
		int						  nextRunNumber{1};

		// The driver in the pool, or nullptr.
		[[nodiscard]] DriverRecord*		  findDriver(const CrewId& id);
		[[nodiscard]] const DriverRecord* findDriver(const CrewId& id) const;
		// Throws std::invalid_argument for a driver who isn't in the pool.
		[[nodiscard]] DriverRecord&		  driver(const CrewId& id);
		[[nodiscard]] const DriverRecord& driver(const CrewId& id) const;

		// The escort in the convoy, or nullptr.
		[[nodiscard]] ConvoyEscort*		  findEscort(const ConvoyId& id);
		[[nodiscard]] const ConvoyEscort* findEscort(const ConvoyId& id) const;

		// The driver's run deck while they're seated on the run out, or nullptr.
		[[nodiscard]] RunDeck*		 runDeckOf(const CrewId& id);
		[[nodiscard]] const RunDeck* runDeckOf(const CrewId& id) const;

		bool operator==(const Campaign&) const = default;
	};

} // namespace rules::campaign
