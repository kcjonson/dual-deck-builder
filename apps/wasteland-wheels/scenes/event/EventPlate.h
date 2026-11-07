#pragma once

// The event scene's page (event-screen.md, The screen). The plate is a stand-in until event art is painted: drawn top-down
// in the atlas's own hand, a road on its casing across contour lines, and the stop's scene on it in ink, a wreck across
// the lanes, or a vehicle on its side off the road with its people and the signal's rings in Stronghold. Everything is
// placed from the plate's size, so it fits any crop; grease pencil stays the player's. The journal is a ruled page: W1
// paper in an ink border, a printed margin rule in Stronghold, and River rules at the text's own pitch, so the setup and
// the situation read as written on it.

#include "atlas/Paper.h"

#include <rules/map/StopData.h>

#include <ui/Component.h>

#include <string>

namespace game::event {

	class EventPlate : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			rules::map::StopType stopType = rules::map::StopType::Wreck;
		};

		explicit EventPlate(const Args& args)
			: stopType(args.stopType) {}

		[[nodiscard]] const char* typeName() const override { return "EventPlate"; }
		// The frame's outer rule, 4 px outside the box.
		[[nodiscard]] float inkExtent() const override { return 5.0F; }
		void				describe(nlohmann::json& node) const override;

	  protected:
		void							render() override;
		[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::None; }

	  private:
		rules::map::StopType stopType;
	};

	class JournalPage : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			float		pitch = 21.0F; // the text's line height in px, so each line sits on a rule
			std::string identity;	   // what seeds its wear
		};

		explicit JournalPage(const Args& args)
			: pitch(args.pitch),
			  look({.seed = atlas::paperSeed(args.identity), .grab = atlas::Corner::BottomLeft}) {}

		[[nodiscard]] const char* typeName() const override { return "JournalPage"; }

	  protected:
		void onMount() override;
		void render() override;

	  private:
		float			 pitch;
		atlas::PaperLook look;
	};

} // namespace game::event
