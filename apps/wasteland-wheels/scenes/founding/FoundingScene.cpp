#include "scenes/founding/FoundingScene.h"

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Tokens.h"

#include <rules/campaign/Founding.h>
#include <rules/map/MapPipeline.h>

#include <nlohmann/json.hpp>

#include <exception>
#include <utility>

namespace game {

	using rules::campaign::MapMaking;

	namespace {

		constexpr float kButtonWidth = 180.0F;

	} // namespace

	FoundingScene::FoundingScene(FoundingArgs args)
		: asked(args.seed) {}

	const ui::Theme& FoundingScene::sceneTheme() const {
		return atlas::theme();
	}

	void FoundingScene::enter() {
		start(asked.value_or(game().newSeed()));
	}

	void FoundingScene::start(uint32_t onSeed) {
		seed = onSeed;
		cancelling = false;
		failure.clear();
		shown = "Making the area map";
		const AtlasPage opened = openAtlasPage(*this, sheetPage, {.identity = scenes::kFounding, .title = "New campaign"});
		progress = mapProgressBox(opened.body, "SEED " + std::to_string(seed));
		cancelLine = progress.foot.addChild<ui::Text>({
			.id = "cancelling",
			.visible = false,
			.layout = {.flexGrow = 1.0F},
			.style = atlas::styles::print::note,
			.text = "Cancelling at the next stage",
		});
		cancelButton = progress.foot.addChild<atlas::AtlasButton>({
			.id = "cancel",
			.size = {kButtonWidth, ui::kAuto},
			.label = "Cancel",
			.onPress = [this] { cancel(); },
		});
		job = std::make_unique<MapJob<FoundingMap>>([found = game().maps.found, seed = onSeed](const MapMaking& making) {
			return found(seed, making);
		});
	}

	void FoundingScene::cancel() {
		if (!job || cancelling) {
			return;
		}
		job->cancel();
		cancelling = true;
		if (atlas::AtlasButton* button = cancelButton.get()) {
			button->setEnabled(false);
		}
		if (ui::Text* line = cancelLine.get()) {
			line->setVisible(true);
		}
	}

	void FoundingScene::update(const app::FrameContext& /*frame*/) {
		if (!job) {
			return;
		}
		showProgress();
		if (!job->done()) {
			return;
		}
		std::unique_ptr<MapJob<FoundingMap>> finished = std::move(job);
		try {
			FoundingMap made = finished->take();
			if (cancelling) {
				// It finished before the stop reached it; a cancelled founding keeps nothing all the same.
				app().scenes().switchTo(scenes::kMainMenu);
				return;
			}
			const GameRules&		  loaded = game().rules;
			rules::campaign::Campaign campaign = rules::campaign::foundCampaign(
				loaded.content, loaded.campaign, rules::campaign::Founding{.map = made.origin, .unlocked = loaded.unlocked}
			);
			if (!game().store.replace(campaign)) {
				showFailure("The new campaign couldn't be saved.");
				return;
			}
			game().session = Session{.campaign = std::move(campaign), .map = std::move(made.map)};
			app().scenes().switchTo(scenes::kCompound);
		} catch (const rules::map::MapPipelineCancelled&) {
			app().scenes().switchTo(scenes::kMainMenu);
		} catch (const rules::map::MapPipelineError& error) {
			showFailure(std::string("No map could be made on this seed: ") + error.what());
		} catch (const std::exception& error) {
			LOG_ERROR(Game, "FoundingScene: founding on seed %u threw: %s", seed, error.what());
			showFailure(std::string("The founding failed: ") + error.what());
		}
	}

	void FoundingScene::showProgress() {
		const std::optional<MapProgress> reached = job->progress();
		if (!reached) {
			return;
		}
		std::string text = progressText(*reached);
		if (text != shown) {
			shown = std::move(text);
			game::showProgress(progress, *reached);
		}
	}

	void FoundingScene::showFailure(const std::string& reason) {
		failure = reason;
		const AtlasPage		   opened = openAtlasPage(*this, sheetPage, {.identity = scenes::kFounding, .title = "New campaign"});
		ui::Ref<ui::Component> foot = failureBox(opened.body, "No map on this seed", "SEED " + std::to_string(seed), failure);
		foot.addChild<atlas::AtlasButton>({
			.id = "back",
			.size = {kButtonWidth, ui::kAuto},
			.label = "Back",
			.onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); },
		});
		foot.addChild<atlas::AtlasButton>({
			.id = "another_seed",
			.label = "Try another seed",
			.road = atlas::Road::Highway,
			.shield = true,
			.onPress = [this] { start(game().newSeed()); },
		});
	}

	std::string FoundingScene::exportState() const {
		return nlohmann::json{
			{"seed", seed}, {"progress", shown}, {"cancelling", cancelling}, {"failure", failure}, {"making", job != nullptr}
		}.dump();
	}

} // namespace game
