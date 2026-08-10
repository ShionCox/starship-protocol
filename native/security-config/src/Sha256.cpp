#include "Sha256.h"

#include <windows.h>
#include <bcrypt.h>

#include <array>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace starship::security {
namespace {

void requireNt(NTSTATUS status, const char* operation) {
    if (status < 0) {
        throw std::runtime_error(std::string(operation) + " failed");
    }
}

} // namespace

std::string sha256HexUtf8(const std::string& value) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectLength = 0;
    DWORD copied = 0;
    requireNt(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0),
        "BCryptOpenAlgorithmProvider");
    try {
        requireNt(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
            reinterpret_cast<PUCHAR>(&objectLength), sizeof(objectLength), &copied, 0),
            "BCryptGetProperty");
        std::vector<std::uint8_t> object(objectLength);
        requireNt(BCryptCreateHash(algorithm, &hash, object.data(), objectLength, nullptr, 0, 0),
            "BCryptCreateHash");
        if (!value.empty()) {
            requireNt(BCryptHashData(hash,
                reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
                static_cast<ULONG>(value.size()), 0), "BCryptHashData");
        }
        std::array<std::uint8_t, 32> digest{};
        requireNt(BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0),
            "BCryptFinishHash");
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);

        std::ostringstream output;
        output << std::hex << std::setfill('0');
        for (const auto byte : digest) {
            output << std::setw(2) << static_cast<unsigned int>(byte);
        }
        return output.str();
    } catch (...) {
        if (hash != nullptr) BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        throw;
    }
}

} // namespace starship::security
