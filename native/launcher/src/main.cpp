#include <windows.h>
#include <bcrypt.h>
#include <cryptuiapi.h>
#include <shlobj.h>
#include <shellapi.h>
#include <softpub.h>
#include <wincrypt.h>
#include <winhttp.h>
#include <wintrust.h>

#include <rapidjson/document.h>
#include <rapidjson/stringbuffer.h>
#include <rapidjson/writer.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "manifest_public_key.h"

namespace fs = std::filesystem;

namespace starship::launcher {

namespace {

constexpr std::size_t kMaximumHttpBodyBytes = 16U * 1024U * 1024U;
constexpr wchar_t kProductName[] = L"星舰协议";

struct HttpHandle {
    HINTERNET value = nullptr;
    HttpHandle() = default;
    explicit HttpHandle(HINTERNET handle) : value(handle) {}
    HttpHandle(const HttpHandle&) = delete;
    HttpHandle& operator=(const HttpHandle&) = delete;
    HttpHandle(HttpHandle&& other) noexcept : value(other.value) { other.value = nullptr; }
    ~HttpHandle() { if (value != nullptr) WinHttpCloseHandle(value); }
    operator HINTERNET() const { return value; }
};

struct HttpResponse {
    DWORD status = 0;
    std::vector<std::uint8_t> body;
};

struct FileEntry {
    std::string path;
    std::uint64_t size = 0;
    std::string sha256;
    bool core = false;
};

struct Manifest {
    std::string buildId;
    std::string configVersion;
    std::string minimumLauncherVersion;
    std::string launchTicketUrl;
    std::string reinstallUrl;
    std::vector<FileEntry> files;
};

struct CacheRecord {
    std::uint64_t size = 0;
    std::int64_t modified = 0;
    std::string sha256;
};

struct VerificationCache {
    std::string buildId;
    std::map<std::string, CacheRecord> files;
};

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error(message);
}

void requireWin32(BOOL result, const char* operation) {
    if (result == FALSE) {
        throw std::runtime_error(std::string(operation) + " failed, Win32=" + std::to_string(GetLastError()));
    }
}

void requireNt(NTSTATUS status, const char* operation) {
    if (status < 0) {
        std::ostringstream stream;
        stream << operation << " failed, NTSTATUS=0x" << std::hex << static_cast<unsigned long>(status);
        throw std::runtime_error(stream.str());
    }
}

std::wstring utf8ToWide(std::string_view value) {
    if (value.empty()) return {};
    const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), nullptr, 0);
    if (length <= 0) fail("invalid UTF-8 string");
    std::wstring result(static_cast<std::size_t>(length), L'\0');
    requireWin32(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), result.data(), length), "MultiByteToWideChar");
    return result;
}

std::string wideToUtf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (length <= 0) fail("invalid UTF-16 string");
    std::string result(static_cast<std::size_t>(length), '\0');
    requireWin32(WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
        static_cast<int>(value.size()), result.data(), length, nullptr, nullptr), "WideCharToMultiByte");
    return result;
}

fs::path executablePath() {
    std::wstring buffer(32768, L'\0');
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0 || length >= buffer.size()) fail("cannot resolve launcher path");
    buffer.resize(length);
    return fs::canonical(buffer);
}

fs::path userDataDirectory() {
    PWSTR raw = nullptr;
    const HRESULT result = SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &raw);
    if (FAILED(result) || raw == nullptr) fail("cannot resolve LocalAppData");
    const fs::path directory = fs::path(raw) / L"StarshipProtocol";
    CoTaskMemFree(raw);
    fs::create_directories(directory);
    return directory;
}

std::vector<std::uint8_t> readBytes(const fs::path& path, std::size_t maximum = kMaximumHttpBodyBytes) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) fail("cannot open file: " + wideToUtf8(path.wstring()));
    const auto end = input.tellg();
    if (end < 0 || static_cast<std::uint64_t>(end) > maximum) fail("file is too large: " + wideToUtf8(path.wstring()));
    std::vector<std::uint8_t> result(static_cast<std::size_t>(end));
    input.seekg(0);
    if (!result.empty() && !input.read(reinterpret_cast<char*>(result.data()), static_cast<std::streamsize>(result.size()))) {
        fail("cannot read file: " + wideToUtf8(path.wstring()));
    }
    return result;
}

void writeBytesAtomic(const fs::path& target, const std::vector<std::uint8_t>& bytes) {
    fs::create_directories(target.parent_path());
    const fs::path temporary = target.wstring() + L".tmp";
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) fail("cannot create cache file");
        output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        output.flush();
        if (!output) fail("cannot write cache file");
    }
    if (!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(temporary.c_str());
        fail("cannot publish cache file");
    }
}

std::vector<std::uint8_t> base64Decode(const rapidjson::Value& value, const char* field) {
    if (!value.IsString() || value.GetStringLength() == 0) fail(std::string("invalid base64 field: ") + field);
    DWORD length = 0;
    requireWin32(CryptStringToBinaryA(value.GetString(), value.GetStringLength(), CRYPT_STRING_BASE64,
        nullptr, &length, nullptr, nullptr), "CryptStringToBinaryA(size)");
    std::vector<std::uint8_t> result(length);
    requireWin32(CryptStringToBinaryA(value.GetString(), value.GetStringLength(), CRYPT_STRING_BASE64,
        result.data(), &length, nullptr, nullptr), "CryptStringToBinaryA(data)");
    result.resize(length);
    return result;
}

std::array<std::uint8_t, 32> sha256(const std::uint8_t* data, std::size_t size) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectLength = 0;
    DWORD copied = 0;
    requireNt(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0), "BCryptOpenAlgorithmProvider");
    try {
        requireNt(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
            sizeof(objectLength), &copied, 0), "BCryptGetProperty");
        std::vector<std::uint8_t> object(objectLength);
        requireNt(BCryptCreateHash(algorithm, &hash, object.data(), objectLength, nullptr, 0, 0), "BCryptCreateHash");
        if (size > 0) {
            requireNt(BCryptHashData(hash, const_cast<PUCHAR>(data), static_cast<ULONG>(size), 0), "BCryptHashData");
        }
        std::array<std::uint8_t, 32> result{};
        requireNt(BCryptFinishHash(hash, result.data(), static_cast<ULONG>(result.size()), 0), "BCryptFinishHash");
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return result;
    } catch (...) {
        if (hash != nullptr) BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        throw;
    }
}

std::array<std::uint8_t, 32> sha256(const std::vector<std::uint8_t>& bytes) {
    return sha256(bytes.data(), bytes.size());
}

std::string hexLower(const std::array<std::uint8_t, 32>& bytes) {
    std::ostringstream stream;
    stream << std::hex << std::setfill('0');
    for (const auto byte : bytes) stream << std::setw(2) << static_cast<unsigned int>(byte);
    return stream.str();
}

std::string hashFile(const fs::path& path) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectLength = 0;
    DWORD copied = 0;
    requireNt(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0), "BCryptOpenAlgorithmProvider");
    try {
        requireNt(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
            sizeof(objectLength), &copied, 0), "BCryptGetProperty");
        std::vector<std::uint8_t> object(objectLength);
        requireNt(BCryptCreateHash(algorithm, &hash, object.data(), objectLength, nullptr, 0, 0), "BCryptCreateHash");
        std::ifstream input(path, std::ios::binary);
        if (!input) fail("cannot open release file: " + wideToUtf8(path.wstring()));
        std::array<char, 1024 * 1024> buffer{};
        while (input) {
            input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
            const auto count = input.gcount();
            if (count > 0) requireNt(BCryptHashData(hash, reinterpret_cast<PUCHAR>(buffer.data()),
                static_cast<ULONG>(count), 0), "BCryptHashData(file)");
        }
        if (!input.eof()) fail("cannot read release file: " + wideToUtf8(path.wstring()));
        std::array<std::uint8_t, 32> result{};
        requireNt(BCryptFinishHash(hash, result.data(), static_cast<ULONG>(result.size()), 0), "BCryptFinishHash");
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return hexLower(result);
    } catch (...) {
        if (hash != nullptr) BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        throw;
    }
}

void verifyManifestSignature(const std::vector<std::uint8_t>& payload, const std::vector<std::uint8_t>& signature) {
    CERT_PUBLIC_KEY_INFO* info = nullptr;
    DWORD infoLength = 0;
    if (!CryptDecodeObjectEx(X509_ASN_ENCODING, X509_PUBLIC_KEY_INFO, kManifestPublicKeyDer.data(),
        static_cast<DWORD>(kManifestPublicKeyDer.size()), CRYPT_DECODE_ALLOC_FLAG, nullptr, &info, &infoLength)) {
        fail("cannot decode embedded manifest public key");
    }
    BCRYPT_KEY_HANDLE publicKey = nullptr;
    const BOOL imported = CryptImportPublicKeyInfoEx2(X509_ASN_ENCODING, info, 0, nullptr, &publicKey);
    LocalFree(info);
    if (!imported || publicKey == nullptr) fail("cannot import embedded manifest public key");
    const auto digest = sha256(payload);
    BCRYPT_PSS_PADDING_INFO padding{BCRYPT_SHA256_ALGORITHM, 32};
    const NTSTATUS status = BCryptVerifySignature(publicKey, &padding,
        const_cast<PUCHAR>(digest.data()), static_cast<ULONG>(digest.size()),
        const_cast<PUCHAR>(signature.data()), static_cast<ULONG>(signature.size()), BCRYPT_PAD_PSS);
    BCryptDestroyKey(publicKey);
    if (status < 0) fail("signed release manifest verification failed");
}

const rapidjson::Value& requireMember(const rapidjson::Value& object, const char* name) {
    if (!object.IsObject() || !object.HasMember(name)) fail(std::string("manifest missing field: ") + name);
    return object[name];
}

std::string requireString(const rapidjson::Value& object, const char* name) {
    const auto& value = requireMember(object, name);
    if (!value.IsString() || value.GetStringLength() == 0) fail(std::string("manifest field is not a string: ") + name);
    return {value.GetString(), value.GetStringLength()};
}

bool stableToken(std::string_view value) {
    if (value.empty() || value.size() > 128 || !std::isalnum(static_cast<unsigned char>(value.front()))) return false;
    return std::all_of(value.begin() + 1, value.end(), [](char character) {
        const auto c = static_cast<unsigned char>(character);
        return std::isalnum(c) || c == '.' || c == '_' || c == '-';
    });
}

bool safeRelativePath(std::string_view value) {
    if (value.empty() || value.find('\\') != std::string_view::npos || value.find(':') != std::string_view::npos || value.front() == '/') return false;
    std::size_t begin = 0;
    while (begin <= value.size()) {
        const auto end = value.find('/', begin);
        const auto segment = value.substr(begin, end == std::string_view::npos ? value.size() - begin : end - begin);
        if (segment.empty() || segment == "." || segment == "..") return false;
        if (end == std::string_view::npos) break;
        begin = end + 1;
    }
    return true;
}

std::array<int, 3> parseVersion(std::string_view value) {
    std::array<int, 3> result{};
    std::size_t begin = 0;
    for (int index = 0; index < 3; ++index) {
        const auto end = value.find('.', begin);
        const auto part = value.substr(begin, end == std::string_view::npos ? value.size() - begin : end - begin);
        if (part.empty() || !std::all_of(part.begin(), part.end(), [](char c) { return c >= '0' && c <= '9'; })) fail("invalid semantic version");
        result[index] = std::stoi(std::string(part));
        if (index < 2 && end == std::string_view::npos) fail("invalid semantic version");
        begin = end == std::string_view::npos ? value.size() : end + 1;
    }
    if (begin < value.size()) fail("invalid semantic version");
    return result;
}

Manifest parseSignedManifest(const std::vector<std::uint8_t>& envelopeBytes) {
    rapidjson::Document envelope;
    envelope.Parse(reinterpret_cast<const char*>(envelopeBytes.data()), envelopeBytes.size());
    if (envelope.HasParseError() || !envelope.IsObject()) fail("signed manifest envelope is invalid JSON");
    if (!requireMember(envelope, "schemaVersion").IsInt() || envelope["schemaVersion"].GetInt() != 1 ||
        requireString(envelope, "algorithm") != "RSA-PSS-SHA256" ||
        !requireMember(envelope, "saltLength").IsInt() || envelope["saltLength"].GetInt() != 32) {
        fail("signed manifest envelope uses an unsupported format");
    }
    const auto payload = base64Decode(requireMember(envelope, "payload"), "payload");
    const auto signature = base64Decode(requireMember(envelope, "signature"), "signature");
    verifyManifestSignature(payload, signature);

    rapidjson::Document document;
    document.Parse(reinterpret_cast<const char*>(payload.data()), payload.size());
    if (document.HasParseError() || !document.IsObject()) fail("signed manifest payload is invalid JSON");
    if (!requireMember(document, "schemaVersion").IsInt() || document["schemaVersion"].GetInt() != 1 ||
        requireString(document, "platform") != "windows") fail("unsupported release manifest");

    Manifest manifest;
    manifest.buildId = requireString(document, "buildId");
    manifest.configVersion = requireString(document, "configVersion");
    manifest.minimumLauncherVersion = requireString(document, "minimumLauncherVersion");
    manifest.launchTicketUrl = requireString(document, "launchTicketUrl");
    manifest.reinstallUrl = requireString(document, "reinstallUrl");
    if (!stableToken(manifest.buildId) || !stableToken(manifest.configVersion) ||
        parseVersion(STARSHIP_LAUNCHER_VERSION) < parseVersion(manifest.minimumLauncherVersion)) {
        fail("launcher version is lower than the signed manifest requirement");
    }
    if (!manifest.launchTicketUrl.starts_with("https://") || !manifest.reinstallUrl.starts_with("https://")) {
        fail("signed manifest contains a non-HTTPS URL");
    }
    const auto& files = requireMember(document, "files");
    if (!files.IsArray() || files.Empty()) fail("release manifest has no files");
    std::map<std::string, bool> uniquePaths;
    for (const auto& item : files.GetArray()) {
        FileEntry entry;
        entry.path = requireString(item, "path");
        entry.sha256 = requireString(item, "sha256");
        const auto verification = requireString(item, "verification");
        const auto& size = requireMember(item, "size");
        if (!safeRelativePath(entry.path) || uniquePaths.contains(entry.path) ||
            entry.sha256.size() != 64 || !std::all_of(entry.sha256.begin(), entry.sha256.end(), [](char c) {
                return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            }) || !size.IsUint64() || (verification != "CORE" && verification != "BULK")) {
            fail("release manifest contains an invalid file entry");
        }
        uniquePaths.emplace(entry.path, true);
        entry.size = size.GetUint64();
        entry.core = verification == "CORE";
        manifest.files.push_back(std::move(entry));
    }
    return manifest;
}

HttpResponse httpRequest(std::string_view urlUtf8, std::wstring_view method,
    const std::vector<std::uint8_t>& body = {}, std::wstring_view contentType = L"") {
    const std::wstring url = utf8ToWide(urlUtf8);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.dwSchemeLength = static_cast<DWORD>(-1);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    requireWin32(WinHttpCrackUrl(url.c_str(), 0, 0, &parts), "WinHttpCrackUrl");
    if (parts.nScheme != INTERNET_SCHEME_HTTPS) fail("launcher permits HTTPS endpoints only");
    const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.dwExtraInfoLength > 0) path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);

    HttpHandle session(WinHttpOpen(L"StarshipProtocolLauncher/" L"1.0.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session.value) fail("WinHttpOpen failed");
    WinHttpSetTimeouts(session, 10000, 10000, 15000, 30000);
    HttpHandle connection(WinHttpConnect(session, host.c_str(), parts.nPort, 0));
    if (!connection.value) fail("WinHttpConnect failed");
    HttpHandle request(WinHttpOpenRequest(connection, std::wstring(method).c_str(), path.c_str(), nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!request.value) fail("WinHttpOpenRequest failed");
    std::wstring headers = L"Accept: application/json\r\n";
    if (!contentType.empty()) headers += L"Content-Type: " + std::wstring(contentType) + L"\r\n";
    requireWin32(WinHttpSendRequest(request, headers.c_str(), static_cast<DWORD>(headers.size()),
        body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<std::uint8_t*>(body.data()),
        static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size()), 0), "WinHttpSendRequest");
    requireWin32(WinHttpReceiveResponse(request, nullptr), "WinHttpReceiveResponse");

    HttpResponse response;
    DWORD statusLength = sizeof(response.status);
    requireWin32(WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &response.status, &statusLength, WINHTTP_NO_HEADER_INDEX), "WinHttpQueryHeaders");
    while (true) {
        DWORD available = 0;
        requireWin32(WinHttpQueryDataAvailable(request, &available), "WinHttpQueryDataAvailable");
        if (available == 0) break;
        if (response.body.size() + available > kMaximumHttpBodyBytes) fail("HTTP response exceeds safety limit");
        const auto offset = response.body.size();
        response.body.resize(offset + available);
        DWORD read = 0;
        requireWin32(WinHttpReadData(request, response.body.data() + offset, available, &read), "WinHttpReadData");
        response.body.resize(offset + read);
    }
    return response;
}

std::int64_t modifiedStamp(const fs::path& path) {
    return static_cast<std::int64_t>(fs::last_write_time(path).time_since_epoch().count());
}

VerificationCache loadVerificationCache(const fs::path& path) {
    VerificationCache cache;
    if (!fs::exists(path)) return cache;
    try {
        const auto bytes = readBytes(path);
        rapidjson::Document document;
        document.Parse(reinterpret_cast<const char*>(bytes.data()), bytes.size());
        if (document.HasParseError() || !document.IsObject() || !document.HasMember("buildId") ||
            !document["buildId"].IsString() || !document.HasMember("files") || !document["files"].IsObject()) return {};
        cache.buildId = document["buildId"].GetString();
        for (auto member = document["files"].MemberBegin(); member != document["files"].MemberEnd(); ++member) {
            const auto& value = member->value;
            if (!value.IsObject() || !value.HasMember("size") || !value["size"].IsUint64() ||
                !value.HasMember("modified") || !value["modified"].IsInt64() ||
                !value.HasMember("sha256") || !value["sha256"].IsString()) continue;
            cache.files.emplace(member->name.GetString(), CacheRecord{
                value["size"].GetUint64(), value["modified"].GetInt64(), value["sha256"].GetString()});
        }
    } catch (...) {
        return {};
    }
    return cache;
}

void saveVerificationCache(const fs::path& path, const VerificationCache& cache) {
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    writer.StartObject();
    writer.Key("buildId"); writer.String(cache.buildId.c_str());
    writer.Key("files"); writer.StartObject();
    for (const auto& [name, record] : cache.files) {
        writer.Key(name.c_str()); writer.StartObject();
        writer.Key("size"); writer.Uint64(record.size);
        writer.Key("modified"); writer.Int64(record.modified);
        writer.Key("sha256"); writer.String(record.sha256.c_str());
        writer.EndObject();
    }
    writer.EndObject(); writer.EndObject();
    const auto* begin = reinterpret_cast<const std::uint8_t*>(buffer.GetString());
    writeBytesAtomic(path, {begin, begin + buffer.GetSize()});
}

fs::path resolveReleaseFile(const fs::path& root, const std::string& relativePath) {
    fs::path candidate = root;
    std::size_t begin = 0;
    while (begin <= relativePath.size()) {
        const auto end = relativePath.find('/', begin);
        candidate /= utf8ToWide(relativePath.substr(begin, end == std::string::npos ? relativePath.size() - begin : end - begin));
        if (end == std::string::npos) break;
        begin = end + 1;
    }
    if (!fs::exists(candidate) || !fs::is_regular_file(candidate)) fail("required release file is missing: " + relativePath);
    const fs::path canonicalRoot = fs::canonical(root);
    const fs::path canonicalFile = fs::canonical(candidate);
    auto rootText = canonicalRoot.wstring();
    auto fileText = canonicalFile.wstring();
    std::transform(rootText.begin(), rootText.end(), rootText.begin(), ::towlower);
    std::transform(fileText.begin(), fileText.end(), fileText.begin(), ::towlower);
    if (!rootText.ends_with(L"\\")) rootText += L"\\";
    if (!fileText.starts_with(rootText)) fail("release file resolves outside install root: " + relativePath);
    return canonicalFile;
}

void verifyReleaseFiles(const Manifest& manifest, const fs::path& installRoot, const fs::path& cachePath) {
    auto previous = loadVerificationCache(cachePath);
    VerificationCache next;
    next.buildId = manifest.buildId;
    for (const auto& entry : manifest.files) {
        const fs::path path = resolveReleaseFile(installRoot, entry.path);
        const auto actualSize = fs::file_size(path);
        if (actualSize != entry.size) fail("release file size mismatch: " + entry.path);
        const auto modified = modifiedStamp(path);
        const auto previousRecord = previous.files.find(entry.path);
        const bool cachedBulkMatch = !entry.core && previous.buildId == manifest.buildId &&
            previousRecord != previous.files.end() && previousRecord->second.size == entry.size &&
            previousRecord->second.modified == modified && previousRecord->second.sha256 == entry.sha256;
        if (!cachedBulkMatch && hashFile(path) != entry.sha256) fail("release file hash mismatch: " + entry.path);
        next.files.emplace(entry.path, CacheRecord{entry.size, modified, entry.sha256});
    }
    saveVerificationCache(cachePath, next);
}

std::string readOrCreateInstallId(const fs::path& path) {
    if (fs::exists(path)) {
        const auto bytes = readBytes(path, 256);
        const std::string value(bytes.begin(), bytes.end());
        if (stableToken(value) && value.size() >= 8) return value;
    }
    GUID guid{};
    if (FAILED(CoCreateGuid(&guid))) fail("cannot create install identifier");
    wchar_t raw[40]{};
    if (StringFromGUID2(guid, raw, static_cast<int>(std::size(raw))) <= 0) fail("cannot format install identifier");
    std::wstring value(raw);
    value.erase(std::remove_if(value.begin(), value.end(), [](wchar_t c) { return c == L'{' || c == L'}'; }), value.end());
    const auto utf8 = wideToUtf8(value);
    writeBytesAtomic(path, {utf8.begin(), utf8.end()});
    return utf8;
}

std::vector<std::uint8_t> createTicketRequest(const Manifest& manifest, const std::string& manifestHash,
    const std::string& installId) {
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    writer.StartObject();
    writer.Key("buildId"); writer.String(manifest.buildId.c_str());
    writer.Key("manifestSha256"); writer.String(manifestHash.c_str());
    writer.Key("installId"); writer.String(installId.c_str());
    writer.EndObject();
    const auto* begin = reinterpret_cast<const std::uint8_t*>(buffer.GetString());
    return {begin, begin + buffer.GetSize()};
}

std::string parseTicket(const std::vector<std::uint8_t>& body) {
    rapidjson::Document document;
    document.Parse(reinterpret_cast<const char*>(body.data()), body.size());
    if (document.HasParseError() || !document.IsObject() || !document.HasMember("ticket") ||
        !document["ticket"].IsString() || document["ticket"].GetStringLength() == 0) fail("launch ticket response is invalid");
    return document["ticket"].GetString();
}

void verifyAuthenticode(const fs::path& path) {
#if STARSHIP_REQUIRE_AUTHENTICODE
    WINTRUST_FILE_INFO fileInfo{};
    fileInfo.cbStruct = sizeof(fileInfo);
    fileInfo.pcwszFilePath = path.c_str();
    WINTRUST_DATA trust{};
    trust.cbStruct = sizeof(trust);
    trust.dwUIChoice = WTD_UI_NONE;
    trust.fdwRevocationChecks = WTD_REVOKE_WHOLECHAIN;
    trust.dwUnionChoice = WTD_CHOICE_FILE;
    trust.pFile = &fileInfo;
    trust.dwStateAction = WTD_STATEACTION_VERIFY;
    trust.dwProvFlags = WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT;
    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const LONG result = WinVerifyTrust(nullptr, &policy, &trust);
    trust.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(nullptr, &policy, &trust);
    if (result != ERROR_SUCCESS) fail("launcher Authenticode verification failed");
#else
    (void)path;
#endif
}

void startGame(const fs::path& gamePath, const Manifest& manifest, const std::string& installId,
    const std::optional<std::string>& ticket) {
    std::wstring command = L"\"" + gamePath.wstring() +
        L"\" --build-id \"" + utf8ToWide(manifest.buildId) +
        L"\" --config-version \"" + utf8ToWide(manifest.configVersion) +
        L"\" --install-id \"" + utf8ToWide(installId) +
        L"\" --launch-ticket-url \"" + utf8ToWide(manifest.launchTicketUrl) + L"\"";
    if (ticket.has_value()) command += L" --launch-ticket \"" + utf8ToWide(*ticket) + L"\"";
    else command += L" --offline";
    std::vector<wchar_t> writable(command.begin(), command.end());
    writable.push_back(L'\0');
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(gamePath.c_str(), writable.data(), nullptr, nullptr, FALSE, 0, nullptr,
        gamePath.parent_path().c_str(), &startup, &process)) fail("verified game process could not be started");
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
}

void showFailureAndReinstall(const std::wstring& message, const std::string& reinstallUrl) {
    const int choice = MessageBoxW(nullptr, (message + L"\n\n为保护账号和存档，游戏不会继续启动。请重新安装正版客户端。").c_str(),
        kProductName, MB_ICONERROR | MB_OKCANCEL | MB_DEFBUTTON1);
    if (choice == IDOK && reinstallUrl.starts_with("https://")) {
        ShellExecuteW(nullptr, L"open", utf8ToWide(reinstallUrl).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    }
}

} // namespace

int run() {
    const fs::path self = executablePath();
    verifyAuthenticode(self);
    const fs::path installRoot = self.parent_path();
    const fs::path userDirectory = userDataDirectory();
    const fs::path manifestCache = userDirectory / L"last-manifest.spmanifest";
    const fs::path verificationCache = userDirectory / L"verification-cache.json";

    std::vector<std::uint8_t> signedManifest;
    bool online = false;
    try {
        const auto response = httpRequest(wideToUtf8(STARSHIP_MANIFEST_URL), L"GET");
        if (response.status == 200 && !response.body.empty()) {
            signedManifest = response.body;
            online = true;
        } else {
            throw std::runtime_error("latest manifest endpoint unavailable");
        }
    } catch (...) {
        if (!fs::exists(manifestCache)) {
            MessageBoxW(nullptr, L"无法连接版本验证服务器，且本机没有可验证的离线版本。请联网后重试。",
                kProductName, MB_ICONWARNING | MB_OK);
            return 2;
        }
        signedManifest = readBytes(manifestCache);
    }

    Manifest manifest;
    try {
        manifest = parseSignedManifest(signedManifest);
        verifyReleaseFiles(manifest, installRoot, verificationCache);
        if (online) writeBytesAtomic(manifestCache, signedManifest);
    } catch (const std::exception& error) {
        showFailureAndReinstall(L"客户端文件验证失败：" + utf8ToWide(error.what()), manifest.reinstallUrl);
        return 3;
    }

    const fs::path gamePath = resolveReleaseFile(installRoot, wideToUtf8(STARSHIP_GAME_EXECUTABLE));
    const std::string installId = readOrCreateInstallId(userDirectory / L"install-id.txt");
    std::optional<std::string> ticket;
    if (online) {
        std::optional<HttpResponse> ticketResponse;
        const auto request = createTicketRequest(manifest, hexLower(sha256(signedManifest)), installId);
        try {
            ticketResponse = httpRequest(manifest.launchTicketUrl, L"POST", request, L"application/json");
        } catch (...) {
            // 服务器不可达时只允许进入离线冷启动；服务端明确拒绝则必须停止。
            ticketResponse.reset();
        }
        if (ticketResponse.has_value()) {
            if (ticketResponse->status != 200) {
                MessageBoxW(nullptr, L"版本验证服务器拒绝了当前客户端。请安装最新正版客户端。",
                    kProductName, MB_ICONERROR | MB_OK);
                return 4;
            }
            try {
                ticket = parseTicket(ticketResponse->body);
            } catch (const std::exception&) {
                MessageBoxW(nullptr, L"版本验证服务器返回了无效凭证，游戏不会继续启动。",
                    kProductName, MB_ICONERROR | MB_OK);
                return 4;
            }
        }
    }
    startGame(gamePath, manifest, installId, ticket);
    return 0;
}

#if STARSHIP_ENABLE_TEST_COMMANDS
int verifyManifestFileForTest(const fs::path& path) {
    (void)parseSignedManifest(readBytes(path));
    return 0;
}
#endif

} // namespace starship::launcher

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    try {
#if STARSHIP_ENABLE_TEST_COMMANDS
        int argumentCount = 0;
        LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
        if (arguments != nullptr && argumentCount == 3 && std::wstring_view(arguments[1]) == L"--verify-manifest") {
            const fs::path manifestPath(arguments[2]);
            LocalFree(arguments);
            return starship::launcher::verifyManifestFileForTest(manifestPath);
        }
        if (arguments != nullptr) LocalFree(arguments);
#endif
        return starship::launcher::run();
    } catch (const std::exception& error) {
        MessageBoxW(nullptr, starship::launcher::utf8ToWide(error.what()).c_str(), L"星舰协议启动失败", MB_ICONERROR | MB_OK);
        return 1;
    }
}
