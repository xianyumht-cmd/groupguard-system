#!/usr/bin/env python3
"""Upload USER_MANUAL.html as a raw file to Feishu Drive.

This intentionally does not import/convert HTML into a Feishu docx document,
so CSS and JavaScript remain part of the original file preview.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import requests

BASE_URL = "https://open.feishu.cn/open-apis"
SOURCE = Path("USER_MANUAL.html")
TIMEOUT = 45


class FeishuError(RuntimeError):
    pass


def request_json(method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    response = requests.request(method, url, timeout=TIMEOUT, **kwargs)
    try:
        payload = response.json()
    except ValueError as exc:
        raise FeishuError(f"HTTP {response.status_code}: non-JSON response") from exc
    if response.status_code >= 400 or payload.get("code", 0) != 0:
        raise FeishuError(
            f"HTTP {response.status_code}; code={payload.get('code')}; "
            f"msg={payload.get('msg')}; body={json.dumps(payload, ensure_ascii=False)[:1000]}"
        )
    return payload


def get_token(app_id: str, app_secret: str) -> str:
    payload = request_json(
        "POST",
        f"{BASE_URL}/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
    )
    token = payload.get("tenant_access_token")
    if not token:
        raise FeishuError("tenant_access_token missing")
    return str(token)


def get_root_folder(headers: dict[str, str]) -> str:
    explicit = os.getenv("FEISHU_HTML_FOLDER_TOKEN", "").strip()
    if explicit:
        return explicit
    payload = request_json(
        "GET",
        f"{BASE_URL}/drive/explorer/v2/root_folder/meta",
        headers=headers,
    )
    token = (payload.get("data") or {}).get("token")
    if not token:
        raise FeishuError("root folder token missing; set FEISHU_HTML_FOLDER_TOKEN")
    return str(token)


def upload_file(headers: dict[str, str], folder_token: str) -> str:
    content = SOURCE.read_bytes()
    with SOURCE.open("rb") as file_obj:
        payload = request_json(
            "POST",
            f"{BASE_URL}/drive/v1/files/upload_all",
            headers=headers,
            data={
                "file_name": "USER_MANUAL.html",
                "parent_type": "explorer",
                "parent_node": folder_token,
                "size": str(len(content)),
            },
            files={"file": ("USER_MANUAL.html", file_obj, "text/html; charset=utf-8")},
        )
    file_token = (payload.get("data") or {}).get("file_token")
    if not file_token:
        raise FeishuError("file_token missing after upload")
    return str(file_token)


def make_public(headers: dict[str, str], file_token: str) -> dict[str, Any]:
    v2_body = {
        "external_access_entity": "open",
        "security_entity": "anyone_can_view",
        "share_entity": "anyone",
        "manage_collaborator_entity": "collaborator_can_view",
        "link_share_entity": "anyone_readable",
        "copy_entity": "anyone_can_view",
    }
    try:
        payload = request_json(
            "PATCH",
            f"{BASE_URL}/drive/v2/permissions/{file_token}/public?type=file",
            headers={**headers, "Content-Type": "application/json; charset=utf-8"},
            json=v2_body,
        )
        return {"api": "v2", "response": payload.get("data", {})}
    except FeishuError as first_error:
        # Compatibility fallback for tenants still accepting the v1 body.
        v1_body = {
            "external_access": True,
            "security_entity": "anyone_can_view",
            "comment_entity": "anyone_can_view",
            "share_entity": "anyone",
            "link_share_entity": "anyone_readable",
            "invite_external": True,
        }
        try:
            payload = request_json(
                "PATCH",
                f"{BASE_URL}/drive/v1/permissions/{file_token}/public?type=file",
                headers={**headers, "Content-Type": "application/json; charset=utf-8"},
                json=v1_body,
            )
            return {"api": "v1", "response": payload.get("data", {})}
        except FeishuError as second_error:
            return {
                "api": "failed",
                "error": f"v2: {first_error}; v1: {second_error}",
            }


def read_public_permission(headers: dict[str, str], file_token: str) -> dict[str, Any]:
    try:
        payload = request_json(
            "GET",
            f"{BASE_URL}/drive/v1/permissions/{file_token}/public?type=file",
            headers=headers,
        )
        return payload.get("data", {})
    except FeishuError as exc:
        return {"error": str(exc)}


def main() -> int:
    app_id = os.getenv("FEISHU_APP_ID", "").strip()
    app_secret = os.getenv("FEISHU_APP_SECRET", "").strip()
    tenant_domain = os.getenv("FEISHU_TENANT_DOMAIN", "tcnnh75d6cqg.feishu.cn").strip()
    if not app_id or not app_secret:
        raise FeishuError("FEISHU_APP_ID or FEISHU_APP_SECRET is missing")
    if not SOURCE.is_file():
        raise FeishuError(f"source file not found: {SOURCE}")

    access_token = get_token(app_id, app_secret)
    headers = {"Authorization": f"Bearer {access_token}"}
    folder_token = get_root_folder(headers)
    file_token = upload_file(headers, folder_token)
    public_update = make_public(headers, file_token)
    public_permission = read_public_permission(headers, file_token)
    file_url = f"https://{tenant_domain}/file/{file_token}"

    result = {
        "ok": True,
        "mode": "raw_html_file_upload",
        "source_file": str(SOURCE),
        "source_size": SOURCE.stat().st_size,
        "folder_token_suffix": folder_token[-6:],
        "file_token": file_token,
        "file_url": file_url,
        "public_update": public_update,
        "public_permission": public_permission,
        "note": "Raw HTML file uploaded without conversion.",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
