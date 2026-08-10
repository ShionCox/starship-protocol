from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


STABLE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
INSTALL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$")


@dataclass(frozen=True)
class ReleaseSecuritySettings:
    """发布安全接口依赖的只读配置，生产环境必须由 Secret/KMS 注入密钥。"""

    signed_manifest_file: Path
    encrypted_config_file: Path
    encrypted_config_url: str
    content_key: bytes
    launch_ticket_secret: bytes
    player_session_secret: bytes
    launch_ticket_ttl_seconds: int = 90
    player_session_ttl_seconds: int = 3600

    def validate(self) -> None:
        if len(self.content_key) != 32:
            raise ValueError("配置内容密钥必须是 32 字节")
        if len(self.launch_ticket_secret) < 32 or len(self.player_session_secret) < 32:
            raise ValueError("Ticket 与 Session HMAC 密钥至少需要 32 字节")
        if not self.encrypted_config_url.startswith("https://"):
            raise ValueError("加密配置地址必须使用 HTTPS")
        if self.launch_ticket_ttl_seconds <= 0 or self.player_session_ttl_seconds <= 0:
            raise ValueError("Token 有效期必须是正整数")


@dataclass(frozen=True)
class ReleaseSnapshot:
    signed_manifest_bytes: bytes
    signed_manifest: dict[str, Any]
    manifest: dict[str, Any]
    manifest_sha256: str
    encrypted_config_sha256: str
    encrypted_config: dict[str, Any]

    @property
    def build_id(self) -> str:
        return str(self.manifest["buildId"])

    @property
    def config_version(self) -> str:
        return str(self.manifest["configVersion"])


def load_release_snapshot(settings: ReleaseSecuritySettings) -> ReleaseSnapshot:
    settings.validate()
    signed_manifest_bytes = settings.signed_manifest_file.read_bytes()
    signed_manifest = _read_json_object(signed_manifest_bytes, "签名清单")
    if signed_manifest.get("schemaVersion") != 1 or signed_manifest.get("algorithm") != "RSA-PSS-SHA256":
        raise ValueError("签名清单封装版本或算法无效")
    payload = _decode_base64(str(signed_manifest.get("payload", "")), "签名清单 payload")
    manifest = _read_json_object(payload, "清单 payload")
    _validate_manifest_identity(manifest)

    encrypted_config_bytes = settings.encrypted_config_file.read_bytes()
    encrypted_config = _read_json_object(encrypted_config_bytes, "加密配置包")
    if (
        encrypted_config.get("schemaVersion") != 1
        or encrypted_config.get("algorithm") != "AES-256-GCM"
        or encrypted_config.get("buildId") != manifest["buildId"]
        or encrypted_config.get("configVersion") != manifest["configVersion"]
    ):
        raise ValueError("加密配置包与发布清单版本不一致")

    return ReleaseSnapshot(
        signed_manifest_bytes=signed_manifest_bytes,
        signed_manifest=signed_manifest,
        manifest=manifest,
        manifest_sha256=hashlib.sha256(signed_manifest_bytes).hexdigest(),
        encrypted_config_sha256=hashlib.sha256(encrypted_config_bytes).hexdigest(),
        encrypted_config=encrypted_config,
    )


def issue_launch_ticket(
    settings: ReleaseSecuritySettings,
    snapshot: ReleaseSnapshot,
    *,
    build_id: str,
    manifest_sha256: str,
    install_id: str,
    now: int | None = None,
) -> tuple[str, int]:
    if build_id != snapshot.build_id or manifest_sha256 != snapshot.manifest_sha256:
        raise ValueError("客户端构建或清单摘要不是当前受支持版本")
    if not INSTALL_ID_PATTERN.fullmatch(install_id):
        raise ValueError("installId 格式无效")
    issued_at = int(time.time()) if now is None else now
    expires_at = issued_at + settings.launch_ticket_ttl_seconds
    claims = {
        "schemaVersion": 1,
        "type": "launch",
        "buildId": build_id,
        "manifestSha256": manifest_sha256,
        "installId": install_id,
        "issuedAt": issued_at,
        "expiresAt": expires_at,
        "nonce": secrets.token_urlsafe(18),
    }
    return _sign_token(claims, settings.launch_ticket_secret), expires_at


def issue_guest_session(
    settings: ReleaseSecuritySettings,
    *,
    install_id: str,
    now: int | None = None,
) -> tuple[str, int]:
    if not INSTALL_ID_PATTERN.fullmatch(install_id):
        raise ValueError("installId 格式无效")
    issued_at = int(time.time()) if now is None else now
    expires_at = issued_at + settings.player_session_ttl_seconds
    claims = {
        "schemaVersion": 1,
        "type": "player-session",
        "subject": f"guest:{install_id}",
        "issuedAt": issued_at,
        "expiresAt": expires_at,
        "nonce": secrets.token_urlsafe(18),
    }
    return _sign_token(claims, settings.player_session_secret), expires_at


def verify_launch_ticket(
    settings: ReleaseSecuritySettings,
    snapshot: ReleaseSnapshot,
    token: str,
    *,
    now: int | None = None,
) -> dict[str, Any]:
    claims = _verify_token(token, settings.launch_ticket_secret, "launch", now=now)
    if (
        claims.get("buildId") != snapshot.build_id
        or claims.get("manifestSha256") != snapshot.manifest_sha256
    ):
        raise ValueError("Launch Ticket 与当前发布版本不一致")
    return claims


def verify_player_session(
    settings: ReleaseSecuritySettings,
    token: str,
    *,
    now: int | None = None,
) -> dict[str, Any]:
    return _verify_token(token, settings.player_session_secret, "player-session", now=now)


def build_bootstrap_response(
    settings: ReleaseSecuritySettings,
    snapshot: ReleaseSnapshot,
) -> dict[str, Any]:
    config = snapshot.encrypted_config
    return {
        "buildId": snapshot.build_id,
        "configVersion": snapshot.config_version,
        "encryptedConfig": {
            "formatVersion": config["schemaVersion"],
            "algorithm": config["algorithm"],
            "keyId": config["keyId"],
            "assetUrl": settings.encrypted_config_url,
            "sha256": snapshot.encrypted_config_sha256,
            "iv": config["iv"],
        },
        # 密钥只经 HTTPS 返回并保存在进程内存；服务端权威规则不依赖客户端保密性。
        "contentKey": _encode_base64(settings.content_key),
    }


def _sign_token(claims: dict[str, Any], secret: bytes) -> str:
    payload = json.dumps(claims, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(secret, payload, hashlib.sha256).digest()
    return f"{_encode_base64(payload)}.{_encode_base64(signature)}"


def _verify_token(
    token: str,
    secret: bytes,
    expected_type: str,
    *,
    now: int | None,
) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 2:
        raise ValueError("Token 格式无效")
    payload = _decode_base64(parts[0], "Token payload")
    signature = _decode_base64(parts[1], "Token signature")
    expected_signature = hmac.new(secret, payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise ValueError("Token 签名无效")
    claims = _read_json_object(payload, "Token payload")
    current_time = int(time.time()) if now is None else now
    if claims.get("schemaVersion") != 1 or claims.get("type") != expected_type:
        raise ValueError("Token 类型或版本无效")
    if not isinstance(claims.get("expiresAt"), int) or claims["expiresAt"] <= current_time:
        raise ValueError("Token 已过期")
    return claims


def _read_json_object(value: bytes, label: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except (UnicodeDecodeError, json.JSONDecodeError) as cause:
        raise ValueError(f"{label} 不是有效 UTF-8 JSON") from cause
    if not isinstance(parsed, dict):
        raise ValueError(f"{label} 必须是 JSON 对象")
    return parsed


def _validate_manifest_identity(manifest: dict[str, Any]) -> None:
    if manifest.get("schemaVersion") != 1 or manifest.get("platform") != "windows":
        raise ValueError("发布清单版本或平台无效")
    for field in ("buildId", "configVersion"):
        value = manifest.get(field)
        if not isinstance(value, str) or not STABLE_TOKEN_PATTERN.fullmatch(value):
            raise ValueError(f"发布清单 {field} 无效")
    if not isinstance(manifest.get("files"), list) or not manifest["files"]:
        raise ValueError("发布清单缺少文件列表")


def _encode_base64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_base64(value: str, label: str) -> bytes:
    if not value:
        raise ValueError(f"{label} 不能为空")
    try:
        return base64.b64decode(
            value + "=" * (-len(value) % 4),
            altchars=b"-_",
            validate=True,
        )
    except (ValueError, base64.binascii.Error) as cause:
        raise ValueError(f"{label} 不是有效 Base64") from cause
