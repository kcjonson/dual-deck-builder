# ddb_add_tests(<lib>): builds every *.test.cpp under the calling directory into
# ddb_<lib>_tests, linked against ddb::<lib> and gtest, and registers it with CTest.
function(ddb_add_tests lib)
    if(NOT BUILD_TESTING)
        return()
    endif()

    file(GLOB_RECURSE test_sources CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.test.cpp")
    if(test_sources)
        find_package(GTest CONFIG REQUIRED)
        add_executable(ddb_${lib}_tests ${test_sources})
        target_link_libraries(ddb_${lib}_tests
            PRIVATE
                ddb::${lib}
                GTest::gtest
                GTest::gtest_main
        )
        set_target_properties(ddb_${lib}_tests PROPERTIES FOLDER tests)
        add_test(NAME ddb_${lib}_tests COMMAND ddb_${lib}_tests)
    endif()
endfunction()
