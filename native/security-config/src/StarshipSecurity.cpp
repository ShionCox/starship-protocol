#include <windows.h>
#include <shellapi.h>

#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

#include "AesGcm.h"
#include "Sha256.h"
#include "bindings/sebind/sebind.h"
#include "plugins/bus/EventBus.h"
#include "plugins/Plugins.h"

namespace starship::security {
namespace {

std::string wideToUtf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (length <= 0) throw std::runtime_error("invalid UTF-16 launch argument");
    std::string result(static_cast<std::size_t>(length), '\0');
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), result.data(), length, nullptr, nullptr) <= 0) {
        throw std::runtime_error("cannot convert launch argument");
    }
    return result;
}

std::optional<std::wstring> findArgument(std::wstring_view name) {
    int count = 0;
    LPWSTR* values = CommandLineToArgvW(GetCommandLineW(), &count);
    if (values == nullptr) throw std::runtime_error("cannot parse process command line");
    std::optional<std::wstring> result;
    for (int index = 1; index < count; ++index) {
        if (std::wstring_view(values[index]) != name) continue;
        const bool nextIsFlag = index + 1 < count && std::wstring_view(values[index + 1]).substr(0, 2) == L"--";
        if (result.has_value() || index + 1 >= count || nextIsFlag) {
            LocalFree(values);
            throw std::runtime_error("launch argument is missing or duplicated");
        }
        result = values[index + 1];
        index += 1;
    }
    LocalFree(values);
    return result;
}

bool hasArgument(std::wstring_view name) {
    int count = 0;
    LPWSTR* values = CommandLineToArgvW(GetCommandLineW(), &count);
    if (values == nullptr) return false;
    bool found = false;
    for (int index = 1; index < count; ++index) {
        if (std::wstring_view(values[index]) == name) {
            found = true;
            break;
        }
    }
    LocalFree(values);
    return found;
}

std::string requireArgument(std::wstring_view name) {
    const auto value = findArgument(name);
    if (!value.has_value() || value->empty()) throw std::runtime_error("required launch argument is missing");
    return wideToUtf8(*value);
}

std::string escapeJson(std::string_view value) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string result;
    result.reserve(value.size() + 8);
    for (const unsigned char character : value) {
        if (character == '"' || character == '\\') {
            result.push_back('\\');
            result.push_back(static_cast<char>(character));
        } else if (character < 0x20) {
            result += "\\u00";
            result.push_back(kHex[character >> 4]);
            result.push_back(kHex[character & 0x0f]);
        } else {
            result.push_back(static_cast<char>(character));
        }
    }
    return result;
}

std::string readLaunchContextJson() {
    if (hasArgument(L"--offline")) {
        throw std::runtime_error("offline secure configuration cache is not available");
    }
    const auto buildId = requireArgument(L"--build-id");
    const auto configVersion = requireArgument(L"--config-version");
    const auto installId = requireArgument(L"--install-id");
    const auto ticket = requireArgument(L"--launch-ticket");
    const auto ticketUrl = requireArgument(L"--launch-ticket-url");
    return "{\"buildId\":\"" + escapeJson(buildId) +
        "\",\"configVersion\":\"" + escapeJson(configVersion) +
        "\",\"installId\":\"" + escapeJson(installId) +
        "\",\"launchTicket\":\"" + escapeJson(ticket) +
        "\",\"launchTicketUrl\":\"" + escapeJson(ticketUrl) + "\"}";
}

} // namespace

/**
 * Windows 正式包只在原生层执行 AES-GCM。
 *
 * 对称密钥来自服务端短时 Bootstrap，不写入插件或脚本；认证标签失败必须抛错，
 * 不能返回未经认证的部分明文。
 */
class SecurityBridge final {
public:
    std::string decryptAesGcm(
        const std::string& keyBase64Url,
        const std::string& nonceBase64Url,
        const std::string& authTagBase64Url,
        const std::string& ciphertextBase64Url,
        const std::string& aadUtf8) const {
        try {
            return starship::security::decryptAesGcm(
                keyBase64Url, nonceBase64Url, authTagBase64Url, ciphertextBase64Url, aadUtf8);
        } catch (...) {
            // C++ 异常不得穿过 JSB 边界；空串由 TypeScript 适配器统一转为可观察失败。
            return {};
        }
    }

    std::string getLaunchContext() const {
        try {
            return readLaunchContextJson();
        } catch (...) {
            return {};
        }
    }

    std::string sha256Utf8(const std::string& value) const {
        try {
            return starship::security::sha256HexUtf8(value);
        } catch (...) {
            return {};
        }
    }
};

bool registerSecurityBridge(se::Object* nameSpace) {
    sebind::class_<SecurityBridge> bridge("StarshipSecurity");
    bridge.constructor<>()
        .function("decryptAesGcm", &SecurityBridge::decryptAesGcm)
        .function("getLaunchContext", &SecurityBridge::getLaunchContext)
        .function("sha256Utf8", &SecurityBridge::sha256Utf8);
    bridge.install(nameSpace);
    return true;
}

void installSecurityBridge() {
    using namespace cc::plugin;
    static Listener listener(BusType::SCRIPT_ENGINE);
    listener.receive([](ScriptEngineEvent event) {
        if (event == ScriptEngineEvent::POST_INIT) {
            se::ScriptEngine::getInstance()->addRegisterCallback(registerSecurityBridge);
        }
    });
}

} // namespace starship::security

CC_PLUGIN_ENTRY(starship_security, starship::security::installSecurityBridge);
