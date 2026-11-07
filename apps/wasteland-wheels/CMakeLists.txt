# Wasteland Wheels, the game (game-app.md): its scenes on salal's app and ui over the rules and the AI. The game's code
# is a library the executable and the tests share; ddb_check_layering() in the root holds what each links.
find_package(nlohmann_json CONFIG REQUIRED)

add_library(ddb_game STATIC
    atlas/ArtView.cpp
    atlas/AtlasButton.cpp
    atlas/AtlasTheme.cpp
    atlas/ContentsEntry.cpp
    atlas/Gauges.cpp
    atlas/Glyphs.cpp
    atlas/Highlighter.cpp
    atlas/Ink.cpp
    atlas/LegendBox.cpp
    atlas/Markers.cpp
    atlas/Paper.cpp
    atlas/ResourceStrip.cpp
    atlas/SectionTabs.cpp
    atlas/Sheet.cpp
    CampaignStore.cpp
    cards/Card.cpp
    cards/CardBack.cpp
    cards/CardDetail.cpp
    cards/CardInk.cpp
    cards/CardStyle.cpp
    cards/DeckStack.cpp
    cards/DriverCard.cpp
    cards/EscortCard.cpp
    DevRoutes.cpp
    Fonts.cpp
    GameRules.cpp
    road/VehicleToken.cpp
    Session.cpp
    Words.cpp
    scenes/SceneKit.cpp
    scenes/AtlasPage.cpp
    scenes/Scenes.cpp
    scenes/battle/BattleScene.cpp
    scenes/compound/CompoundPlate.cpp
    scenes/compound/CompoundScene.cpp
    scenes/credits/CreditsScene.cpp
    scenes/crew/CrewScene.cpp
    scenes/crew/CustomizeScene.cpp
    scenes/crew/DeckBuilder.cpp
    scenes/debrief/DebriefScene.cpp
    scenes/end/CampaignEndScene.cpp
    scenes/event/ChoiceCard.cpp
    scenes/event/EventPlate.cpp
    scenes/event/EventScene.cpp
    scenes/event/EventText.cpp
    scenes/gallery/ArtGalleryScene.cpp
    scenes/history/CampaignHistoryScene.cpp
    scenes/founding/FoundingScene.cpp
    scenes/loading/LoadingScene.cpp
    scenes/loadout/LoadOutScene.cpp
    scenes/map/AreaMapScene.cpp
    scenes/map/LandBake.cpp
    scenes/map/MapPage.cpp
    scenes/map/MapPicture.cpp
    scenes/map/MapView.cpp
    scenes/map/PlanRows.cpp
    scenes/map/Planning.cpp
    scenes/map/RunRouteScene.cpp
    scenes/menu/MainMenuScene.cpp
    scenes/menu/MenuCover.cpp
    scenes/run/RunScene.cpp
    scenes/settings/SettingsScene.cpp
    scenes/showcase/CardShowcaseScene.cpp
    scenes/splash/ClosedAtlas.cpp
    scenes/splash/SplashScene.cpp
)
add_library(ddb::game ALIAS ddb_game)

target_compile_features(ddb_game PUBLIC cxx_std_20)
target_include_directories(ddb_game PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(ddb_game PUBLIC ddb::rules ddb::ai salal::app salal::ui)
set_target_properties(ddb_game PROPERTIES FOLDER apps)

# The base shader with the game's fill hooks (procedural-paper.md), on the library, so the scenes and the tests draw
# with the hooks the game does.
salal_base_shader(ddb_game HOOKS ${CMAKE_CURRENT_SOURCE_DIR}/shaders)

# The atlas theme (UI Art Direction, Tokens) over ui's own, checked and compiled in.
salal_tokens(ddb_game ${CMAKE_CURRENT_SOURCE_DIR}/tokens NAMESPACE game::atlas HEADER atlas/Tokens.h)

# The game's icons (procedural-paper.md, Icons): every SVG in icons/ checked against salal's rules and built into one
# MSDF atlas, embedded. A scene adds it to its icon service (game::icons::iconAtlas()).
salal_icons(ddb_game ${CMAKE_CURRENT_SOURCE_DIR}/icons NAMESPACE game::icons HEADER atlas/Icons.h)

# The game's flat-fill vector art (procedural-paper.md, Everything else), checked against what loadSVG reads and embedded.
salal_art(ddb_game ${CMAKE_CURRENT_SOURCE_DIR}/art NAMESPACE game::art HEADER atlas/Art.h)

# The base pack is read from the source tree, as the balance sim reads it, until playtest builds ship their packs.
add_executable(wasteland-wheels Main.cpp)
target_link_libraries(wasteland-wheels PRIVATE ddb::game)
target_compile_definitions(wasteland-wheels PRIVATE DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
set_target_properties(wasteland-wheels PROPERTIES FOLDER apps)

# The game's faces (Fonts.h) and their licences, beside the exe on every build, where AppConfig::fontAtlases' paths resolve.
set(game_fonts
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/barlow-condensed-bold.png
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/barlow-condensed-bold.json
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/barlow-condensed-semibold.png
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/barlow-condensed-semibold.json
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/barlow-condensed-OFL.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/open-sans-regular.png
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/open-sans-regular.json
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/open-sans-OFL.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/jetbrains-mono-regular.png
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/jetbrains-mono-regular.json
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/jetbrains-mono-OFL.txt
)
add_custom_target(wasteland-wheels-fonts
    COMMAND ${CMAKE_COMMAND} -E make_directory $<TARGET_FILE_DIR:wasteland-wheels>/fonts
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${game_fonts} $<TARGET_FILE_DIR:wasteland-wheels>/fonts
    COMMENT "Staging the game's fonts"
    VERBATIM
)
set_target_properties(wasteland-wheels-fonts PROPERTIES FOLDER apps)
add_dependencies(wasteland-wheels wasteland-wheels-fonts)

ddb_add_tests(game DEFINITIONS DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
# The fast lane loads the faces from beside its exe, which is the game's folder, as the game does.
if(TARGET ddb_game_tests)
    add_dependencies(ddb_game_tests wasteland-wheels-fonts)
endif()
