add_library(ddb_ai STATIC
    AggressiveFlanker.cpp
    FirstPlayable.cpp
    OpponentPolicies.cpp
    Preferences.cpp
)
add_library(ddb::ai ALIAS ddb_ai)

target_compile_features(ddb_ai PUBLIC cxx_std_20)

# libs/ is the include root, as for the rules: <ai/AggressiveFlanker.h>.
target_include_directories(ddb_ai
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/..>
)

# The rules and nothing else; ddb_check_layering() in the root holds it.
target_link_libraries(ddb_ai PUBLIC ddb::rules)

set_target_properties(ddb_ai PROPERTIES FOLDER libs)

ddb_add_tests(ai)
if(TARGET ddb_ai_tests)
    target_compile_definitions(ddb_ai_tests PRIVATE DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
endif()
