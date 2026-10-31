# The balance sim (docs/specs/Balance Simulation.md). Its core is a library the command line tool and the tests share,
# over the rules and the AI and nothing else; ddb_check_layering() in the root holds it.
add_library(ddb_balance_sim STATIC
    ConfigFields.cpp
    Fights.cpp
    FightsConfig.cpp
    Measures.cpp
    Report.cpp
    ReportText.cpp
)
add_library(ddb::balance_sim ALIAS ddb_balance_sim)

target_compile_features(ddb_balance_sim PUBLIC cxx_std_20)
target_link_libraries(ddb_balance_sim PUBLIC ddb::rules ddb::ai)
set_target_properties(ddb_balance_sim PROPERTIES FOLDER apps)

# The base pack is read from the source tree, so a pack edit needs no rebuild; packs over it come in with --pack.
add_executable(balance-sim main.cpp)
target_link_libraries(balance-sim PRIVATE ddb::balance_sim)
target_compile_definitions(balance-sim PRIVATE DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
set_target_properties(balance-sim PROPERTIES FOLDER apps)

ddb_add_tests(balance_sim DEFINITIONS DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
