#!/usr/bin/env python3
"""Upload USER_MANUAL.html and import it as a Feishu online document."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

BASE_URL = "https://open.feishu.cn/open-apis"
HTML_PATH = Path("USER_MANUAL.html")
TITLE = "GroupGuard 群管理网页手册"


def api_json(response: requests.Response, action: str) -> dict:
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(
            f"{action}返回非 JSON：HTTP {response.status_code} {response.text[:500]}"
        ) from exc
    if response.status_code >= 400 or payload.get("code") != 0:
        raise RuntimeError(
            f"{action}失败：HTTP {response.status_code} "
            f"code={payload.get('code')} msg={payload.get('msg')}"
        )
    return payload


def main() -> int:
    app_id = os.getenv("FEISHU_APP_ID", "").strip()
    app_secret = os.getenv("FEISHU_APP_SECRET", "").strip()
    if not app_id or not app_secret:
        raise RuntimeError("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET")
    if not HTML_PATH.is_file():
        raise RuntimeError("未找到 USER_MANUAL.html")

    size = HTML_PATH.stat().st_size
    if size <= 0 or size > 20 * 1024 * 1024:
        raise RuntimeError(f"HTML 文件大小不符合飞书导入限制：{size} 字节")

    token_payload = api_json(
        requests.post(
            BASE_URL + "/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=30,
        ),
        "获取 tenant_access_token",
    )
    access_token = token_payload.get("tenant_access_token")
    if not access_token:
        raise RuntimeError("飞书没有返回 tenant_access_token")
    auth = {"Authorization": f"Bearer {access_token}"}

    extra = json.dumps(
        {"obj_type": "docx", "file_extension": "html"},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    with HTML_PATH.open("rb") as stream:
        upload_payload = api_json(
            requests.post(
                BASE_URL + "/drive/v1/medias/upload_all",
                headers=auth,
                data={
                    "file_name": HTML_PATH.name,
                    "parent_type": "ccm_import_open",
                    "parent_node": "",
                    "size": str(size),
                    "extra": extra,
                },
                files={"file": (HTML_PATH.name, stream, "text/html")},
                timeout=120,
            ),
            "上传 HTML",
        )
    source_token = (upload_payload.get("data") or {}).get("file_token")
    if not source_token:
        raise RuntimeError("上传 HTML 成功，但没有返回 file_token")

    task_payload = api_json(
        requests.post(
            BASE_URL + "/drive/v1/import_tasks",
            headers={**auth, "Content-Type": "application/json; charset=utf-8"},
            json={
                "file_extension": "html",
                "file_token": source_token,
                "type": "docx",
                "file_name": TITLE,
                "point": {"mount_type": 1, "mount_key": ""},
            },
            timeout=30,
        ),
        "创建 HTML 导入任务",
    )
    ticket = (task_payload.get("data") or {}).get("ticket")
    if not ticket:
        raise RuntimeError("创建导入任务成功，但没有返回 ticket")

    deadline = time.monotonic() + 150
    result = {}
    while time.monotonic() < deadline:
        query_payload = api_json(
            requests.get(
                BASE_URL + f"/drive/v1/import_tasks/{ticket}",
                headers=auth,
                timeout=30,
            ),
            "查询 HTML 导入任务",
        )
        result = (query_payload.get("data") or {}).get("result") or {}
        status = result.get("job_status")
        if status == 0 and result.get("url") and result.get("token"):
            output = {
                "ok": True,
                "mode": "html_import",
                "source_file": str(HTML_PATH),
                "source_size": size,
                "ticket": ticket,
                "job_status": status,
                "job_error_msg": result.get("job_error_msg"),
                "document_token": result.get("token"),
                "document_url": result.get("url"),
                "document_title": TITLE,
                "extra": result.get("extra", []),
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 0
        if status not in (None, 0) and result.get("job_error_msg"):
            raise RuntimeError(
                f"HTML 导入失败：job_status={status}，"
                f"job_error_msg={result.get('job_error_msg')}"
            )
        time.sleep(3)

    raise RuntimeError(
        "等待 HTML 导入超时：" + json.dumps(result, ensure_ascii=False)
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(
            json.dumps(
                {"ok": False, "mode": "html_import", "error": str(exc)},
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
