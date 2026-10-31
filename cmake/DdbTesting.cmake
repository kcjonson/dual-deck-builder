# ddb_add_tests(<lib> [DEFINITIONS <definition>...]): builds every *.test.cpp under the calling directory into
# ddb_<lib>_tests and every *.slow.test.cpp into ddb_<lib>_slow_tests, each linked against ddb::<lib> and gtest
# with the definitions given, and registers them with CTest, the slow one labelled `slow`. The slow lane is
# what regrows whole maps or otherwise takes half a second or more: `ctest --preset windows` leaves it out,
# `ctest --preset windows-slow` runs only it, and a bare `ctest` runs both.
function(ddb_add_tests lib)
    cmake_parse_arguments(PARSE_ARGV 1 arg "" "" "DEFINITIONS")
    if(NOT BUILD_TESTING)
        return()
    endif()

    file(GLOB_RECURSE fast_sources CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.test.cpp")
    set(slow_sources ${fast_sources})
    list(FILTER fast_sources EXCLUDE REGEX "\\.slow\\.test\\.cpp$")
    list(FILTER slow_sources INCLUDE REGEX "\\.slow\\.test\\.cpp$")
    foreach(lane IN ITEMS fast slow)
        if(NOT ${lane}_sources)
            continue()
        endif()
        if(lane STREQUAL "fast")
            set(target ddb_${lib}_tests)
        else()
            set(target ddb_${lib}_slow_tests)
        endif()
        find_package(GTest CONFIG REQUIRED)
        add_executable(${target} ${${lane}_sources})
        target_link_libraries(${target}
            PRIVATE
                ddb::${lib}
                GTest::gtest
                GTest::gtest_main
        )
        target_compile_definitions(${target} PRIVATE ${arg_DEFINITIONS})
        set_target_properties(${target} PROPERTIES FOLDER tests)
        add_test(NAME ${target} COMMAND ${target})
        if(lane STREQUAL "slow")
            set_tests_properties(${target} PROPERTIES LABELS slow)
        endif()
    endforeach()
endfunction()
