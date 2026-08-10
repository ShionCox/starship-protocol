cmake_minimum_required(VERSION 3.20)

project(StarshipProtocolLauncher LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(STARSHIP_MANIFEST_PUBLIC_KEY_DER "" CACHE FILEPATH "RSA public key in DER/SPKI form")
set(STARSHIP_MANIFEST_URL "https://updates.example.invalid/starship-protocol/windows/stable/latest.spmanifest" CACHE STRING "Latest signed manifest URL")
set(STARSHIP_GAME_EXECUTABLE "StarshipProtocol.exe" CACHE STRING "Game executable relative to launcher")
set(STARSHIP_LAUNCHER_VERSION "1.0.0" CACHE STRING "Launcher semantic version")
set(COCOS_ENGINE_ROOT "" CACHE PATH "Cocos Creator engine root containing native/external/sources/rapidjson")
option(STARSHIP_REQUIRE_AUTHENTICODE "Reject an unsigned launcher executable" ON)
option(STARSHIP_ENABLE_TEST_COMMANDS "Enable non-production manifest verification command" OFF)

if(NOT EXISTS "${STARSHIP_MANIFEST_PUBLIC_KEY_DER}")
    message(FATAL_ERROR "STARSHIP_MANIFEST_PUBLIC_KEY_DER must point to the release RSA public key in DER/SPKI format")
endif()

if(NOT COCOS_ENGINE_ROOT AND DEFINED ENV{COCOS_ENGINE_ROOT})
    file(TO_CMAKE_PATH "$ENV{COCOS_ENGINE_ROOT}" COCOS_ENGINE_ROOT)
endif()

set(RAPIDJSON_INCLUDE_DIR "${COCOS_ENGINE_ROOT}/native/external/sources")
if(NOT EXISTS "${RAPIDJSON_INCLUDE_DIR}/rapidjson/document.h")
    message(FATAL_ERROR "Set COCOS_ENGINE_ROOT to the Cocos 3.8.8 engine directory")
endif()

file(READ "${STARSHIP_MANIFEST_PUBLIC_KEY_DER}" STARSHIP_PUBLIC_KEY_HEX HEX)
string(LENGTH "${STARSHIP_PUBLIC_KEY_HEX}" STARSHIP_PUBLIC_KEY_HEX_CHAR_COUNT)
math(EXPR STARSHIP_PUBLIC_KEY_HEX_LENGTH "${STARSHIP_PUBLIC_KEY_HEX_CHAR_COUNT} / 2")
string(REGEX REPLACE "([0-9A-Fa-f][0-9A-Fa-f])" "0x\\1," STARSHIP_PUBLIC_KEY_BYTES "${STARSHIP_PUBLIC_KEY_HEX}")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/generated")
configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/src/manifest_public_key.h.in"
    "${CMAKE_CURRENT_BINARY_DIR}/generated/manifest_public_key.h"
    @ONLY
)

add_executable(StarshipProtocolLauncher WIN32 src/main.cpp)
target_include_directories(StarshipProtocolLauncher PRIVATE
    "${CMAKE_CURRENT_BINARY_DIR}/generated"
)
target_include_directories(StarshipProtocolLauncher SYSTEM PRIVATE "${RAPIDJSON_INCLUDE_DIR}")
target_compile_definitions(StarshipProtocolLauncher PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    STARSHIP_MANIFEST_URL=L"${STARSHIP_MANIFEST_URL}"
    STARSHIP_GAME_EXECUTABLE=L"${STARSHIP_GAME_EXECUTABLE}"
    STARSHIP_LAUNCHER_VERSION="${STARSHIP_LAUNCHER_VERSION}"
    STARSHIP_REQUIRE_AUTHENTICODE=$<BOOL:${STARSHIP_REQUIRE_AUTHENTICODE}>
    STARSHIP_ENABLE_TEST_COMMANDS=$<BOOL:${STARSHIP_ENABLE_TEST_COMMANDS}>
)
target_compile_options(StarshipProtocolLauncher PRIVATE /W4 /permissive- /utf-8 /EHsc)
target_link_libraries(StarshipProtocolLauncher PRIVATE
    bcrypt
    crypt32
    ole32
    shell32
    winhttp
    wintrust
)

install(TARGETS StarshipProtocolLauncher RUNTIME DESTINATION .)
