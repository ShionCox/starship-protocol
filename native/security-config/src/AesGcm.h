#pragma once

#include <string>

namespace starship::security {

/** 使用 Windows CNG 认证解密；认证失败时抛错且不返回部分明文。 */
std::string decryptAesGcm(
    const std::string& keyBase64Url,
    const std::string& nonceBase64Url,
    const std::string& authTagBase64Url,
    const std::string& ciphertextBase64Url,
    const std::string& aadUtf8);

} // namespace starship::security
