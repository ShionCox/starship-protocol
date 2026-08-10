set(_STARSHIP_SECURITY_SOURCE_DIR ${CMAKE_CURRENT_LIST_DIR})

add_library(starship_security_crypto STATIC
    ${_STARSHIP_SECURITY_SOURCE_DIR}/AesGcm.cpp
    ${_STARSHIP_SECURITY_SOURCE_DIR}/Sha256.cpp
)
target_compile_features(starship_security_crypto PRIVATE cxx_std_17)
target_compile_definitions(starship_security_crypto PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(starship_security_crypto PRIVATE /W4 /permissive- /utf-8 /EHsc)
target_link_libraries(starship_security_crypto PRIVATE bcrypt crypt32)

add_library(starship_security STATIC
    ${_STARSHIP_SECURITY_SOURCE_DIR}/StarshipSecurity.cpp
)

target_compile_features(starship_security PRIVATE cxx_std_17)
target_compile_definitions(starship_security PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(starship_security PRIVATE /W4 /permissive- /utf-8 /EHsc)
target_link_libraries(starship_security PRIVATE ${ENGINE_NAME} starship_security_crypto)
