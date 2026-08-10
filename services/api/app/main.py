from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field

from .release_security import (
    ReleaseSecuritySettings,
    ReleaseSnapshot,
    build_bootstrap_response,
    issue_guest_session,
    issue_launch_ticket,
    load_release_snapshot,
    verify_launch_ticket,
    verify_player_session,
)


class LaunchTicketRequest(BaseModel):
    buildId: str = Field(min_length=1, max_length=128)
    manifestSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    installId: str = Field(min_length=8, max_length=128)


class GuestSessionRequest(BaseModel):
    installId: str = Field(min_length=8, max_length=128)


def create_app(settings: ReleaseSecuritySettings | None = None) -> FastAPI:
    configured_settings = settings or settings_from_environment()
    snapshot = load_release_snapshot(configured_settings)
    app = FastAPI(title="Starship Protocol API", version="0.1.0")

    @app.get("/api/v1/client/manifests/latest")
    async def latest_manifest() -> Response:
        return Response(
            content=snapshot.signed_manifest_bytes,
            media_type="application/json",
            headers={"X-Manifest-SHA256": snapshot.manifest_sha256, "Cache-Control": "no-store"},
        )

    @app.post("/api/v1/client/launch-ticket")
    async def create_launch_ticket(request: LaunchTicketRequest) -> dict[str, object]:
        try:
            ticket, expires_at = issue_launch_ticket(
                configured_settings,
                snapshot,
                build_id=request.buildId,
                manifest_sha256=request.manifestSha256,
                install_id=request.installId,
            )
        except ValueError as cause:
            raise HTTPException(status_code=409, detail=str(cause)) from cause
        return {"ticket": ticket, "expiresAt": expires_at}

    @app.post("/api/v1/auth/guest")
    async def create_guest_session(request: GuestSessionRequest) -> dict[str, object]:
        try:
            token, expires_at = issue_guest_session(
                configured_settings,
                install_id=request.installId,
            )
        except ValueError as cause:
            raise HTTPException(status_code=422, detail=str(cause)) from cause
        return {"sessionToken": token, "expiresAt": expires_at}

    @app.get("/api/v1/client/bootstrap")
    async def bootstrap(
        authorization: Annotated[str | None, Header()] = None,
        x_player_session: Annotated[str | None, Header()] = None,
    ) -> dict[str, object]:
        launch_ticket = _bearer_token(authorization)
        if launch_ticket is None or x_player_session is None:
            raise HTTPException(status_code=401, detail="缺少 Launch Ticket 或玩家会话")
        try:
            verify_launch_ticket(configured_settings, snapshot, launch_ticket)
            verify_player_session(configured_settings, x_player_session)
        except ValueError as cause:
            raise HTTPException(status_code=401, detail=str(cause)) from cause
        return build_bootstrap_response(configured_settings, snapshot)

    app.state.release_settings = configured_settings
    app.state.release_snapshot = snapshot
    return app


def settings_from_environment() -> ReleaseSecuritySettings:
    return ReleaseSecuritySettings(
        signed_manifest_file=Path(_require_environment("STARSHIP_SIGNED_MANIFEST_FILE")),
        encrypted_config_file=Path(_require_environment("STARSHIP_ENCRYPTED_CONFIG_FILE")),
        encrypted_config_url=_require_environment("STARSHIP_ENCRYPTED_CONFIG_URL"),
        content_key=base64.b64decode(_require_environment("STARSHIP_CONFIG_AES_KEY_BASE64"), validate=True),
        launch_ticket_secret=base64.b64decode(_require_environment("STARSHIP_LAUNCH_TICKET_SECRET_BASE64"), validate=True),
        player_session_secret=base64.b64decode(_require_environment("STARSHIP_PLAYER_SESSION_SECRET_BASE64"), validate=True),
    )


def _require_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"缺少环境变量 {name}")
    return value


def _bearer_token(value: str | None) -> str | None:
    if value is None or not value.startswith("Bearer "):
        return None
    token = value.removeprefix("Bearer ").strip()
    return token or None


# 生产部署通过环境变量加载密钥；测试调用 create_app 注入临时配置。
if os.environ.get("STARSHIP_SIGNED_MANIFEST_FILE"):
    app = create_app()
