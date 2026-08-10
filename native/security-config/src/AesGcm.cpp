#include "AesGcm.h"

#include <windows.h>
#include <bcrypt.h>
#include <wincrypt.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace starship::security {
namespace {

void requireNt(NTSTATUS status, const char* operation) {
    if (status < 0) {
        throw std::runtime_error(std::string(operation) + " failed");
    }
}

std::vector<std::uint8_t> decodeBase64Url(const std::string& input) {
    if (input.empty()) {
        throw std::invalid_argument("base64url value is empty");
    }
    std::string normalized = input;
    for (char& character : normalized) {
        if (character == '-') character = '+';
        else if (character == '_') character = '/';
    }
    while (normalized.size() % 4 != 0) normalized.push_back('=');

    DWORD outputLength = 0;
    if (!CryptStringToBinaryA(normalized.data(), static_cast<DWORD>(normalized.size()),
        CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, nullptr, &outputLength, nullptr, nullptr)) {
        throw std::invalid_argument("base64url value is invalid");
    }
    std::vector<std::uint8_t> output(outputLength);
    if (!CryptStringToBinaryA(normalized.data(), static_cast<DWORD>(normalized.size()),
        CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, output.data(), &outputLength, nullptr, nullptr)) {
        throw std::invalid_argument("base64url value is invalid");
    }
    output.resize(outputLength);
    return output;
}

} // namespace

std::string decryptAesGcm(
    const std::string& keyBase64Url,
    const std::string& nonceBase64Url,
    const std::string& authTagBase64Url,
    const std::string& ciphertextBase64Url,
    const std::string& aadUtf8) {
    const auto key = decodeBase64Url(keyBase64Url);
    const auto nonce = decodeBase64Url(nonceBase64Url);
    auto authTag = decodeBase64Url(authTagBase64Url);
    auto ciphertext = decodeBase64Url(ciphertextBase64Url);
    if (key.size() != 32 || nonce.size() != 12 || authTag.size() != 16) {
        throw std::invalid_argument("AES-256-GCM key, nonce or tag length is invalid");
    }

    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_KEY_HANDLE symmetricKey = nullptr;
    DWORD keyObjectLength = 0;
    DWORD copied = 0;
    requireNt(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_AES_ALGORITHM, nullptr, 0),
        "BCryptOpenAlgorithmProvider");
    try {
        requireNt(BCryptSetProperty(algorithm, BCRYPT_CHAINING_MODE,
            reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_GCM)),
            sizeof(BCRYPT_CHAIN_MODE_GCM), 0), "BCryptSetProperty");
        requireNt(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
            reinterpret_cast<PUCHAR>(&keyObjectLength), sizeof(keyObjectLength), &copied, 0),
            "BCryptGetProperty");
        std::vector<std::uint8_t> keyObject(keyObjectLength);
        requireNt(BCryptGenerateSymmetricKey(algorithm, &symmetricKey, keyObject.data(),
            keyObjectLength, const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0),
            "BCryptGenerateSymmetricKey");

        BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO authentication{};
        BCRYPT_INIT_AUTH_MODE_INFO(authentication);
        authentication.pbNonce = const_cast<PUCHAR>(nonce.data());
        authentication.cbNonce = static_cast<ULONG>(nonce.size());
        authentication.pbTag = authTag.data();
        authentication.cbTag = static_cast<ULONG>(authTag.size());
        authentication.pbAuthData = reinterpret_cast<PUCHAR>(const_cast<char*>(aadUtf8.data()));
        authentication.cbAuthData = static_cast<ULONG>(aadUtf8.size());

        std::vector<std::uint8_t> plaintext(ciphertext.size());
        ULONG plaintextLength = 0;
        requireNt(BCryptDecrypt(symmetricKey, ciphertext.data(), static_cast<ULONG>(ciphertext.size()),
            &authentication, nullptr, 0, plaintext.data(), static_cast<ULONG>(plaintext.size()),
            &plaintextLength, 0), "BCryptDecrypt");
        plaintext.resize(plaintextLength);

        BCryptDestroyKey(symmetricKey);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return {reinterpret_cast<const char*>(plaintext.data()), plaintext.size()};
    } catch (...) {
        if (symmetricKey != nullptr) BCryptDestroyKey(symmetricKey);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        throw;
    }
}

} // namespace starship::security
