#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


class SyncError(RuntimeError):
    pass


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SyncError(f"缺少必需的 GitHub Secret：{name}")
    return value


def document_id(value: str) -> str:
    match = re.search(r"/docx/([A-Za-z0-9_-]+)", value)
    if match:
        return match.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", value):
        return value
    raise SyncError("FEISHU_DOCUMENT_ID 不是有效的文档 ID 或飞书文档链接")


class Client:
    def __init__(self, app_id: str, app_secret: str, base_url: str) -> None:
        self.app_id = app_id
        self.app_secret = app_secret
        self.base_url = base_url.rstrip("/")
        self.token = ""

    def request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        auth: bool = True,
    ) -> dict[str, Any]:
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Content-Type": "application/json; charset=utf-8"}
        if auth:
            if not self.token:
                raise SyncError("尚未获取 tenant_access_token")
            headers["Authorization"] = f"Bearer {self.token}"
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")

        for attempt in range(3):
            request = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    raw = response.read().decode("utf-8")
                    data = json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise SyncError(f"飞书接口 HTTP {exc.code}：{raw[:600]}") from exc
            except urllib.error.URLError as exc:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise SyncError(f"无法连接飞书开放平台：{exc.reason}") from exc

            if data.get("code", 0) != 0:
                raise SyncError(f"飞书接口失败：code={data.get('code')}, msg={data.get('msg')}")
            return data
        raise SyncError("飞书接口重试后仍然失败")

    def login(self) -> None:
        data = self.request(
            "POST",
            "/open-apis/auth/v3/tenant_access_token/internal",
            payload={"app_id": self.app_id, "app_secret": self.app_secret},
            auth=False,
        )
        self.token = data.get("tenant_access_token", "")
        if not self.token:
            raise SyncError("未获得 tenant_access_token，请检查应用凭证和发布状态")

    def get_document(self, doc_id: str) -> dict[str, Any]:
        data = self.request("GET", f"/open-apis/docx/v1/documents/{doc_id}")
        return data.get("data", {}).get("document", {})

    def root_children(self, doc_id: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page_token = ""
        while True:
            query: dict[str, Any] = {"page_size": 500}
            if page_token:
                query["page_token"] = page_token
            data = self.request(
                "GET",
                f"/open-apis/docx/v1/documents/{doc_id}/blocks/{doc_id}/children",
                query=query,
            ).get("data", {})
            items.extend(data.get("items", []))
            if not data.get("has_more"):
                return items
            page_token = data.get("page_token", "")
            if not page_token:
                raise SyncError("飞书分页响应缺少 page_token")

    def append(self, doc_id: str, blocks: list[dict[str, Any]]) -> None:
        for start in range(0, len(blocks), 40):
            self.request(
                "POST",
                f"/open-apis/docx/v1/documents/{doc_id}/blocks/{doc_id}/children",
                query={"document_revision_id": -1},
                payload={"children": blocks[start:start + 40], "index": -1},
            )
            time.sleep(0.25)

    def delete_first(self, doc_id: str, count: int) -> None:
        while count > 0:
            size = min(count, 50)
            self.request(
                "DELETE",
                f"/open-apis/docx/v1/documents/{doc_id}/blocks/{doc_id}/children/batch_delete",
                query={"document_revision_id": -1},
                payload={"start_index": 0, "end_index": size},
            )
            count -= size
            time.sleep(0.25)


def elements(text: str) -> list[dict[str, Any]]:
    return [{"text_run": {"content": text}}]


def block(kind: str, text: str) -> dict[str, Any]:
    mapping = {
        "text": (2, "text"),
        "heading1": (3, "heading1"),
        "heading2": (4, "heading2"),
        "heading3": (5, "heading3"),
        "heading4": (6, "heading4"),
        "bullet": (12, "bullet"),
        "ordered": (13, "ordered"),
        "code": (14, "code"),
        "quote": (15, "quote"),
    }
    block_type, key = mapping[kind]
    return {"block_type": block_type, key: {"elements": elements(text)}}


def clean(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r"\1（图片：\2）", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1（\2）", text)
    text = text.replace("**", "").replace("__", "").replace("~~", "")
    return re.sub(r"`([^`]+)`", r"\1", text).strip()


def split_text(text: str, limit: int = 1400) -> list[str]:
    return [text[index:index + limit] for index in range(0, len(text), limit)] or [""]


def table_blocks(lines: list[str]) -> list[dict[str, Any]]:
    rows = [[clean(cell.strip()) for cell in line.strip().strip("|").split("|")] for line in lines]
    if len(rows) > 1 and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in rows[1]):
        rows.pop(1)
    if not rows:
        return []
    headers = rows[0]
    result = [block("text", "｜".join(headers))]
    for row in rows[1:]:
        fields = []
        for index, value in enumerate(row):
            name = headers[index] if index < len(headers) else f"字段{index + 1}"
            fields.append(f"{name}：{value}")
        result.append(block("bullet", "　".join(fields)))
    return result


def parse_markdown(markdown: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    paragraph: list[str] = []
    code_lines: list[str] = []
    table_lines: list[str] = []
    in_code = False

    def flush_paragraph() -> None:
        text = clean(" ".join(item.strip() for item in paragraph if item.strip()))
        if text:
            for part in split_text(text):
                result.append(block("text", part))
        paragraph.clear()

    def flush_table() -> None:
        if table_lines:
            result.extend(table_blocks(table_lines))
            table_lines.clear()

    def flush_code() -> None:
        text = "\n".join(code_lines).rstrip()
        if text:
            for part in split_text(text):
                result.append(block("code", part))
        code_lines.clear()

    for raw in markdown.replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        if line.startswith("```"):
            flush_paragraph()
            flush_table()
            if in_code:
                flush_code()
                in_code = False
            else:
                in_code = True
            continue
        if in_code:
            code_lines.append(raw)
            continue
        if line.startswith("|") and line.endswith("|"):
            flush_paragraph()
            table_lines.append(line)
            continue
        flush_table()
        if not line:
            flush_paragraph()
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            result.append(block(f"heading{len(heading.group(1))}", clean(heading.group(2))))
            continue
        if line in ("---", "***", "___"):
            flush_paragraph()
            result.append({"block_type": 22, "divider": {}})
            continue
        quote = re.match(r"^>\s?(.*)$", line)
        if quote:
            flush_paragraph()
            if clean(quote.group(1)):
                result.append(block("quote", clean(quote.group(1))))
            continue
        bullet = re.match(r"^[-*+]\s+(.+)$", line)
        if bullet:
            flush_paragraph()
            result.append(block("bullet", clean(bullet.group(1))))
            continue
        ordered = re.match(r"^\d+[.)]\s+(.+)$", line)
        if ordered:
            flush_paragraph()
            result.append(block("ordered", clean(ordered.group(1))))
            continue
        paragraph.append(line)

    if in_code:
        raise SyncError("USER_MANUAL.md 存在未闭合代码块")
    flush_paragraph()
    flush_table()
    flush_code()
    if len(result) < 20:
        raise SyncError(f"只解析出 {len(result)} 个块，为防止误覆盖已停止")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("verify", "sync"), default="verify")
    parser.add_argument("--manual", default="USER_MANUAL.md")
    args = parser.parse_args()
    try:
        manual = Path(args.manual)
        if not manual.is_file() or manual.stat().st_size < 1000:
            raise SyncError("USER_MANUAL.md 不存在或内容异常短")
        blocks = parse_markdown(manual.read_text(encoding="utf-8"))
        doc_id = document_id(env("FEISHU_DOCUMENT_ID"))
        client = Client(
            env("FEISHU_APP_ID"),
            env("FEISHU_APP_SECRET"),
            os.getenv("FEISHU_BASE_URL", "https://open.feishu.cn"),
        )
        client.login()
        document = client.get_document(doc_id)
        old = client.root_children(doc_id)
        output: dict[str, Any] = {
            "ok": True,
            "mode": args.mode,
            "document_id_suffix": doc_id[-6:],
            "document_title": document.get("title", ""),
            "existing_root_blocks": len(old),
            "prepared_blocks": len(blocks),
        }
        if args.mode == "sync":
            # 先追加完整新内容，全部成功后再删除旧内容，避免先清空后写入造成数据丢失。
            client.append(doc_id, blocks)
            client.delete_first(doc_id, len(old))
            final = client.root_children(doc_id)
            output["final_root_blocks"] = len(final)
            if len(final) != len(blocks):
                raise SyncError(f"同步后块数量异常：预计 {len(blocks)}，实际 {len(final)}")
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except SyncError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
