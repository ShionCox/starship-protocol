from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from services.api.app.main import create_app
from services.api.app.release_security import (
    ReleaseSecuritySettings,
    issue_launch_ticket,
    load_release_snapshot,
    verify_launch_ticket,
)


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SECURITY_TOOL = PROJECT_ROOT / "tools" / "release-security" / "release-security.mjs"


class ReleaseSecurityApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(prefix="starship-api-")
        root = Path(self.temporary_directory.name)
        source = root / "source"
        release = root / "release"
        source.mkdir()
        release.mkdir()
        (source / "room-reactor.json").write_text(
            json.dumps({"schemaVersion": 1, "id": "room-reactor", "width": 2, "height": 2}),
            encoding="utf-8",
        )
        (release / "StarshipProtocol.exe").write_bytes(b"signed-game")
        self.content_key = bytes(range(32))
        self.private_key = root / "private.pem"
        self.public_key = root / "public.pem"
        subprocess.run(
            [
                "node",
                "-e",
                (
                    "const {generateKeyPairSync}=require('node:crypto');"
                    "const {writeFileSync}=require('node:fs');"
                    "const k=generateKeyPairSync('rsa',{modulusLength:2048,"
                    "publicKeyEncoding:{type:'spki',format:'pem'},"
                    "privateKeyEncoding:{type:'pkcs8',format:'pem'}});"
                    "writeFileSync(process.argv[1],k.privateKey);writeFileSync(process.argv[2],k.publicKey);"
                ),
                str(self.private_key),
                str(self.public_key),
            ],
            check=True,
        )
        self.config_file = release / "rules.spcfg"
        environment = os.environ.copy()
        environment["STARSHIP_CONFIG_AES_KEY_BASE64"] = base64.b64encode(self.content_key).decode("ascii")
        subprocess.run(
            [
                "node", str(SECURITY_TOOL), "pack-config",
                "--input", str(source), "--output", str(self.config_file),
                "--build-id", "windows-1", "--config-version", "config-1", "--key-id", "key-1",
            ],
            env=environment,
            check=True,
        )
        self.manifest_file = root / "release.spmanifest"
        environment["STARSHIP_MANIFEST_PRIVATE_KEY_FILE"] = str(self.private_key)
        subprocess.run(
            [
                "node", str(SECURITY_TOOL), "create-manifest",
                "--root", str(release), "--output", str(self.manifest_file),
                "--build-id", "windows-1", "--config-version", "config-1",
                "--minimum-launcher-version", "1.0.0",
                "--launch-ticket-url", "https://api.example.test/api/v1/client/launch-ticket",
                "--reinstall-url", "https://download.example.test/starship-installer.exe",
            ],
            env=environment,
            check=True,
        )
        self.settings = ReleaseSecuritySettings(
            signed_manifest_file=self.manifest_file,
            encrypted_config_file=self.config_file,
            encrypted_config_url="https://cdn.example.test/rules.spcfg",
            content_key=self.content_key,
            launch_ticket_secret=b"l" * 32,
            player_session_secret=b"p" * 32,
        )
        self.snapshot = load_release_snapshot(self.settings)
        self.client = TestClient(create_app(self.settings))

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_manifest_ticket_guest_and_bootstrap_flow(self) -> None:
        manifest_response = self.client.get("/api/v1/client/manifests/latest")
        self.assertEqual(manifest_response.status_code, 200)
        manifest_sha256 = manifest_response.headers["x-manifest-sha256"]

        ticket_response = self.client.post(
            "/api/v1/client/launch-ticket",
            json={"buildId": "windows-1", "manifestSha256": manifest_sha256, "installId": "install-test-001"},
        )
        self.assertEqual(ticket_response.status_code, 200)
        session_response = self.client.post(
            "/api/v1/auth/guest",
            json={"installId": "install-test-001"},
        )
        self.assertEqual(session_response.status_code, 200)

        bootstrap_response = self.client.get(
            "/api/v1/client/bootstrap",
            headers={
                "Authorization": f"Bearer {ticket_response.json()['ticket']}",
                "X-Player-Session": session_response.json()["sessionToken"],
            },
        )
        self.assertEqual(bootstrap_response.status_code, 200)
        self.assertEqual(bootstrap_response.json()["buildId"], "windows-1")
        self.assertEqual(
            base64.urlsafe_b64decode(bootstrap_response.json()["contentKey"] + "="),
            self.content_key,
        )

    def test_unknown_build_and_tampered_ticket_are_rejected(self) -> None:
        manifest_response = self.client.get("/api/v1/client/manifests/latest")
        rejected = self.client.post(
            "/api/v1/client/launch-ticket",
            json={
                "buildId": "windows-unknown",
                "manifestSha256": manifest_response.headers["x-manifest-sha256"],
                "installId": "install-test-001",
            },
        )
        self.assertEqual(rejected.status_code, 409)

        session = self.client.post("/api/v1/auth/guest", json={"installId": "install-test-001"}).json()
        bootstrap = self.client.get(
            "/api/v1/client/bootstrap",
            headers={"Authorization": "Bearer invalid.token", "X-Player-Session": session["sessionToken"]},
        )
        self.assertEqual(bootstrap.status_code, 401)

        malformed = self.client.get(
            "/api/v1/client/bootstrap",
            headers={"Authorization": "Bearer %%%.%%%", "X-Player-Session": session["sessionToken"]},
        )
        self.assertEqual(malformed.status_code, 401)

    def test_launch_ticket_is_rejected_at_exact_expiration_time(self) -> None:
        ticket, expires_at = issue_launch_ticket(
            self.settings,
            self.snapshot,
            build_id="windows-1",
            manifest_sha256=self.snapshot.manifest_sha256,
            install_id="install-test-001",
            now=100,
        )
        with self.assertRaisesRegex(ValueError, "Token 已过期"):
            verify_launch_ticket(self.settings, self.snapshot, ticket, now=expires_at)


if __name__ == "__main__":
    unittest.main()
