// Continue (campaign-save-and-load.md), in the atlas: the save read strictly and its map made again on a worker, as
// founding makes one, with its progress shown, then the compound, or the run where it was on the road. A save that won't
// load, its fingerprint another map's or anything else the rules refuse, says why and offers a new campaign in its
// place; there are no migrations.

#include "MapJob.h"
#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "scenes/AtlasPage.h"
#include "scenes/GameScene.h"
#include "scenes/founding/FoundingScene.h"

#include <rules/core/ContentError.h>
#include <rules/map/MapPipeline.h>

#include <nlohmann/json.hpp>

#include <exception>
#include <memory>
#include <utility>

namespace game {

	namespace {

		using rules::campaign::MapMaking;

		constexpr float kButtonWidth = 180.0F;

		class LoadingScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kLoading; }

			std::string exportState() const override {
				return nlohmann::json{{"progress", shown}, {"failure", failure}, {"loading", job != nullptr}}.dump();
			}

			void update(const app::FrameContext& /*frame*/) override {
				if (!job) {
					return;
				}
				if (const std::optional<MapProgress> reached = job->progress()) {
					if (std::string text = progressText(*reached); text != shown) {
						shown = std::move(text);
						showProgress(progress, *reached);
					}
				}
				if (!job->done()) {
					return;
				}
				std::unique_ptr<MapJob<Session>> finished = std::move(job);
				try {
					Session	   loaded = finished->take();
					const bool ended = loaded.campaign.end.has_value();
					const bool onTheRoad = loaded.campaign.run.has_value() && loaded.campaign.run->route.has_value();
					game().session = std::move(loaded);
					app().scenes().switchTo(ended ? scenes::kCampaignEnd : onTheRoad ? scenes::kRun : scenes::kCompound);
				} catch (const rules::map::MapPipelineCancelled&) {
					app().scenes().switchTo(scenes::kMainMenu);
				} catch (const rules::ContentError& error) {
					showFailure(error.what());
				} catch (const std::exception& error) {
					LOG_ERROR(Game, "LoadingScene: the load threw: %s", error.what());
					showFailure(error.what());
				}
			}

		  protected:
			const ui::Theme& sceneTheme() const override { return atlas::theme(); }

			void enter() override {
				std::optional<nlohmann::json> save = game().store.saveJson();
				if (!save) {
					LOG_ERROR(Game, "LoadingScene: there's no save to continue; back to the main menu");
					app().scenes().switchTo(scenes::kMainMenu);
					return;
				}
				game().session.reset();
				summary = game().store.status().line;
				const AtlasPage opened = openAtlasPage(*this, sheetPage, {.identity = scenes::kLoading, .title = "Continue"});
				shown = "Making the area map";
				progress = mapProgressBox(opened.body, summary);
				progress.foot.addChild<atlas::AtlasButton>({
					.id = "back",
					.size = {kButtonWidth, ui::kAuto},
					.label = "Back",
					.onPress = [this] {
						if (job) {
							job->cancel();
						} else {
							app().scenes().switchTo(scenes::kMainMenu);
						}
					},
				});
				job = std::make_unique<MapJob<Session>>([load = game().maps.load, json = std::move(*save)](const MapMaking& making) {
					return load(json, making);
				});
			}

		  private:
			void showFailure(const std::string& reason) {
				failure = reason;
				const AtlasPage		   opened = openAtlasPage(*this, sheetPage, {.identity = scenes::kLoading, .title = "Continue"});
				ui::Ref<ui::Component> foot = failureBox(opened.body, "This campaign can't be continued", summary, failure);
				foot.addChild<atlas::AtlasButton>({
					.id = "back",
					.size = {kButtonWidth, ui::kAuto},
					.label = "Back",
					.onPress = [this] { app().scenes().switchTo(scenes::kMainMenu); },
				});
				foot.addChild<atlas::AtlasButton>({
					.id = "start_fresh",
					.label = "Start a new campaign",
					.road = atlas::Road::Highway,
					.shield = true,
					.onPress = [this] { app().scenes().reset<FoundingScene>(); },
				});
			}

			std::unique_ptr<MapJob<Session>> job;
			AtlasPage						 sheetPage;
			MapProgressBox					 progress;
			std::string						 summary;
			std::string						 shown;
			std::string						 failure;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeLoadingScene() {
		return std::make_unique<LoadingScene>();
	}

} // namespace game
