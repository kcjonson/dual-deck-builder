#pragma once

// The rows the area map and the run route pick from (area-map-atlas-panels.md). A destination is a contents row: the
// POI's circled letter (a stronghold's red diamond), its name in display bold, dotted leaders, its tier in mono. A route
// card is three lines, its name, its facts in mono, and its note. Each is pressed to pick it; the picked one carries
// the highlighter wash, and a dim one says it can't go in faded print but can still be picked and read.

#include <ui/components/Control.h>
#include <ui/shapes/Text.h>

#include <functional>
#include <string>

namespace game {

	class DestinationRow : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string			  label;
			std::string			  value;
			std::string			  glyph; // the circled letter; none for a stronghold, which leads with its diamond
			bool				  stronghold = false;
			bool				  dim = false;
			bool				  chosen = false;
			std::function<void()> onPress;
		};

		explicit DestinationRow(const Args& args);

		void					  setChosen(bool value) { setActive(value); }
		[[nodiscard]] const char* typeName() const override { return "DestinationRow"; }

	  protected:
		void onMount() override;
		void render() override;
		void activate() override;

	  private:
		std::string			  label;
		std::string			  value;
		std::string			  glyph;
		bool				  stronghold;
		bool				  dim;
		bool				  startChosen;
		std::function<void()> onPress;
		ui::Ref<ui::Text>	  labelText;
		ui::Ref<ui::Text>	  valueText;
	};

	class RouteCard : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::string			  name;
			std::string			  facts;
			std::string			  note; // none when empty
			bool				  warn = false;
			bool				  dim = false;
			bool				  chosen = false;
			std::function<void()> onPress;
		};

		explicit RouteCard(const Args& args);

		void					  setChosen(bool value) { setActive(value); }
		[[nodiscard]] const char* typeName() const override { return "RouteCard"; }

	  protected:
		void onMount() override;
		void render() override;
		void activate() override;

	  private:
		std::string			  name;
		std::string			  facts;
		std::string			  note;
		bool				  warn;
		bool				  dim;
		bool				  startChosen;
		std::function<void()> onPress;
	};

} // namespace game
