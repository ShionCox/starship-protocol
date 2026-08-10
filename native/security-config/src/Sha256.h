#pragma once

#include <string>

namespace starship::security {

/** 对 UTF-8 字节执行 Windows CNG SHA-256，返回小写十六进制摘要。 */
std::string sha256HexUtf8(const std::string& value);

} // namespace starship::security
