from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WS = ROOT / "onebot-plugin-groupguard/src/standalone/onebot_ws_client.ts"
CORE_VERIFY = ROOT / "onebot-plugin-groupguard/scripts/verify-core-stability.ts"
SERVICE = ROOT / "onebot-plugin-groupguard/src/services/group_file_mirror_service.ts"
MIRROR_VERIFY = ROOT / "onebot-plugin-groupguard/scripts/verify-group-file-mirror.ts"
DOC = ROOT / "onebot-plugin-groupguard/docs/GFM_DELETE_001.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


ws = WS.read_text(encoding="utf-8")
ws = replace_once(
    ws,
    """      } else {\n        call.reject(new Error(`onebot_action_failed:${call.action}:${retcode}:${payload.message || payload.msg || status}`));\n      }\n""",
    """      } else {\n        const rawDetail = payload.message ?? payload.msg ?? payload.wording ?? status ?? 'failed';\n        const failureDetail = redactSensitiveText(String(rawDetail || 'failed')).slice(0, 500);\n        call.reject(new Error(`onebot_action_failed:${call.action}:${retcode}:${failureDetail}`));\n      }\n""",
    "SnowLuma wording propagation",
)
WS.write_text(ws, encoding="utf-8")

core_verify = CORE_VERIFY.read_text(encoding="utf-8")
core_verify = replace_once(
    core_verify,
    """  respond(echo: string, data: any): void {\n    this.emit('message', {\n      data: JSON.stringify({ status: 'ok', retcode: 0, echo, data })\n    });\n  }\n\n  private emit(type: string, event: any): void {\n""",
    """  respond(echo: string, data: any): void {\n    this.emit('message', {\n      data: JSON.stringify({ status: 'ok', retcode: 0, echo, data })\n    });\n  }\n\n  fail(echo: string, wording: string, retcode = 100): void {\n    this.emit('message', {\n      data: JSON.stringify({ status: 'failed', retcode, echo, wording, data: null })\n    });\n  }\n\n  private emit(type: string, event: any): void {\n""",
    "fake websocket failed response",
)
core_verify = replace_once(
    core_verify,
    """    assert.equal(logs.join('\\n').includes('option-secret'), false);\n\n    sockets[0].emitError(new Error(`failed ${secretUrl} token=bare-secret`));\n""",
    """    assert.equal(logs.join('\\n').includes('option-secret'), false);\n\n    const failedAction = client.call('delete_group_file', { group_id: 10001, file_id: '/old-file' });\n    const failedPayload = JSON.parse(sockets[0].sent.at(-1) || '{}');\n    sockets[0].fail(failedPayload.echo, 'group file delete retCode=2 retMsg=no permission');\n    await assert.rejects(\n      failedAction,\n      /onebot_action_failed:delete_group_file:100:group file delete retCode=2 retMsg=no permission/,\n      'SnowLuma wording must survive the OneBot WebSocket boundary',\n    );\n\n    sockets[0].emitError(new Error(`failed ${secretUrl} token=bare-secret`));\n""",
    "core wording regression",
)
CORE_VERIFY.write_text(core_verify, encoding="utf-8")

service = SERVICE.read_text(encoding="utf-8")
service = replace_once(
    service,
    """interface GroupFileDescriptor {\n  id: string;\n  name: string;\n  size: number;\n  busid: number;\n}\n""",
    """interface GroupFileDescriptor {\n  id: string;\n  name: string;\n  size: number;\n  busid: number;\n}\n\nexport interface ListedGroupFileDescriptor {\n  id: string;\n  name: string;\n  size: number;\n}\n""",
    "listed group file descriptor",
)
service = replace_once(
    service,
    """  targetGroupId: string;\n  targetFileId: string;\n  targetMessageId: string;\n""",
    """  targetGroupId: string;\n  targetFileId: string;\n  targetFolderId?: string;\n  targetMessageId: string;\n""",
    "mirror target folder",
)
service = replace_once(
    service,
    """interface CleanupRecord {\n  targetGroupId: string;\n  targetFileId: string;\n  targetMessageId: string;\n""",
    """interface CleanupRecord {\n  targetGroupId: string;\n  targetFileId: string;\n  targetFolderId?: string;\n  targetMessageId: string;\n""",
    "cleanup target folder",
)
service = replace_once(
    service,
    """function unwrapActionData(value: any): any {\n  return value?.data ?? value?.result ?? value;\n}\n""",
    """function unwrapActionData(value: any): any {\n  return value?.data ?? value?.result ?? value;\n}\n\nexport function extractListedGroupFiles(value: unknown): ListedGroupFileDescriptor[] {\n  const data = unwrapActionData(value);\n  const rawFiles = Array.isArray(data?.files)\n    ? data.files\n    : Array.isArray((value as any)?.files)\n      ? (value as any).files\n      : [];\n\n  const files: ListedGroupFileDescriptor[] = [];\n  for (const rawValue of rawFiles) {\n    const raw = isRecord(rawValue) ? rawValue : {};\n    const id = normalizeId(raw.file_id ?? raw.fileId ?? raw.id);\n    if (!id) continue;\n    files.push({\n      id,\n      name: normalizeId(raw.file_name ?? raw.fileName ?? raw.name),\n      size: Math.max(0, Number(raw.file_size ?? raw.fileSize ?? raw.size ?? 0) || 0),\n    });\n  }\n  return files;\n}\n\nexport function listedGroupFileExists(value: unknown, fileId: string): boolean {\n  const normalized = normalizeId(fileId);\n  return Boolean(normalized) && extractListedGroupFiles(value).some(file => file.id === normalized);\n}\n""",
    "group file list helpers",
)
service = replace_once(
    service,
    """      targetGroupId: rule.targetGroupId,\n      targetFileId,\n      targetMessageId: targetMessage?.messageId || '',\n""",
    """      targetGroupId: rule.targetGroupId,\n      targetFileId,\n      targetFolderId: rule.targetFolderId,\n      targetMessageId: targetMessage?.messageId || '',\n""",
    "persist target folder",
)
service = replace_once(
    service,
    """      targetGroupId: record.targetGroupId,\n      targetFileId: record.targetFileId,\n      targetMessageId: record.targetMessageId,\n""",
    """      targetGroupId: record.targetGroupId,\n      targetFileId: record.targetFileId,\n      targetFolderId: record.targetFolderId || '',\n      targetMessageId: record.targetMessageId,\n""",
    "queue target folder",
)
service = replace_once(
    service,
    """  private async cleanupTarget(rule: GroupFileMirrorRule, item: CleanupRecord): Promise<void> {\n""",
    """  private async inspectTargetFilePresence(\n    rule: GroupFileMirrorRule,\n    item: CleanupRecord,\n  ): Promise<'present' | 'absent' | 'unknown'> {\n    const folderId = normalizeId(item.targetFolderId) || rule.targetFolderId || '/';\n    const action = folderId === '/' ? 'get_group_root_files' : 'get_group_files_by_folder';\n    const params: Record<string, unknown> = { group_id: groupParam(item.targetGroupId) };\n    if (folderId !== '/') {\n      params.folder_id = folderId;\n      params.folder = folderId;\n    }\n\n    try {\n      const result = await this.callWithRetry(rule, action, params);\n      return listedGroupFileExists(result, item.targetFileId) ? 'present' : 'absent';\n    } catch (error) {\n      this.log('debug', `规则 ${rule.id} 核验目标群文件状态失败 file=${item.targetFileId}: ${String(error)}`);\n      return 'unknown';\n    }\n  }\n\n  private async cleanupTarget(rule: GroupFileMirrorRule, item: CleanupRecord): Promise<void> {\n""",
    "target file presence inspector",
)
service = replace_once(
    service,
    """    if (rule.deletePreviousTargetFile && item.targetFileId && !item.fileDeleted) {\n      try {\n        await this.callWithRetry(rule, 'delete_group_file', {\n          group_id: groupParam(item.targetGroupId),\n          file_id: item.targetFileId,\n        });\n        item.fileDeleted = true;\n      } catch (error) {\n        if (isAlreadyGoneError(error)) item.fileDeleted = true;\n        else this.log('warn', `规则 ${rule.id} 删除旧群文件失败 file=${item.targetFileId}: ${String(error)}`);\n      }\n    }\n""",
    """    if (rule.deletePreviousTargetFile && item.targetFileId && !item.fileDeleted) {\n      const beforePresence = await this.inspectTargetFilePresence(rule, item);\n      if (beforePresence === 'absent') {\n        item.fileDeleted = true;\n        this.log('info', `规则 ${rule.id} 旧群文件已不在文件库，按已清理处理 file=${item.targetFileId}`);\n        return;\n      }\n\n      try {\n        await this.callWithRetry(rule, 'delete_group_file', {\n          group_id: groupParam(item.targetGroupId),\n          file_id: item.targetFileId,\n        });\n        item.fileDeleted = true;\n      } catch (error) {\n        if (isAlreadyGoneError(error)) {\n          item.fileDeleted = true;\n          return;\n        }\n\n        const afterPresence = await this.inspectTargetFilePresence(rule, item);\n        if (afterPresence === 'absent') {\n          item.fileDeleted = true;\n          this.log('info', `规则 ${rule.id} 删除动作返回失败，但文件库已无该文件，按幂等成功处理 file=${item.targetFileId}: ${String(error)}`);\n          return;\n        }\n\n        this.log('warn', `规则 ${rule.id} 删除旧群文件失败 file=${item.targetFileId} presence=${afterPresence}: ${String(error)}`);\n      }\n    }\n""",
    "idempotent file deletion diagnosis",
)
SERVICE.write_text(service, encoding="utf-8")

mirror_verify = MIRROR_VERIFY.read_text(encoding="utf-8")
mirror_verify = replace_once(
    mirror_verify,
    """  extractFileSegmentsFromMessage,\n  fileEventMatchesRule,\n""",
    """  extractFileSegmentsFromMessage,\n  extractListedGroupFiles,\n  fileEventMatchesRule,\n  listedGroupFileExists,\n""",
    "mirror verification imports",
)
mirror_verify = replace_once(
    mirror_verify,
    """  assert.equal(rule.retryCount, 3);\n\n  const canonical = extractFileSegmentsFromMessage({\n""",
    """  assert.equal(rule.retryCount, 3);\n\n  const listedResponse = {\n    data: {\n      files: [\n        { file_id: '/target-file-a', file_name: 'old.7z', file_size: 4096 },\n        { file_id: '/target-file-b', file_name: 'new.7z', file_size: 8192 },\n      ],\n    },\n  };\n  assert.deepEqual(extractListedGroupFiles(listedResponse), [\n    { id: '/target-file-a', name: 'old.7z', size: 4096 },\n    { id: '/target-file-b', name: 'new.7z', size: 8192 },\n  ], 'SnowLuma group file list is normalized');\n  assert.equal(listedGroupFileExists(listedResponse, '/target-file-a'), true);\n  assert.equal(listedGroupFileExists(listedResponse, '/missing-file'), false);\n\n  const canonical = extractFileSegmentsFromMessage({\n""",
    "listed group file regression",
)
mirror_verify = replace_once(
    mirror_verify,
    """  assert.match(serviceSource, /upload_group_file/);\n  assert.match(serviceSource, /delete_group_file/);\n""",
    """  assert.match(serviceSource, /upload_group_file/);\n  assert.match(serviceSource, /get_group_root_files/);\n  assert.match(serviceSource, /get_group_files_by_folder/);\n  assert.match(serviceSource, /presence=/);\n  assert.match(serviceSource, /delete_group_file/);\n""",
    "presence diagnostics contract",
)
MIRROR_VERIFY.write_text(mirror_verify, encoding="utf-8")

DOC.parent.mkdir(parents=True, exist_ok=True)
DOC.write_text("""# GFM-DELETE-001：`delete_group_file:100:failed` 排查记录

## 边界

本任务只处理 GroupFileMirror 的旧群文件清理，与查询迁移无关，不回滚当前版本。

## 已确认事实

生产链路运行 SnowLuma v1.12.4，而不是 NapCat 的文件动作实现。SnowLuma 在以下动作中使用同一种原始 `fileId`：

- `upload_group_file` 返回 `file_id`；
- `get_group_root_files` / `get_group_files_by_folder` 返回 `file_id`；
- `delete_group_file` 接收 `file_id`。

因此不能按 NapCat 的复合编码 ID 规则修改生产插件。

已确认的直接缺陷是错误信息丢失：SnowLuma 普通 Action 失败响应把真实异常放在 `wording` 字段，GroupGuard 的 OneBot WebSocket 客户端此前只读取 `message` / `msg`，最终只能记录：

```text
onebot_action_failed:delete_group_file:100:failed
```

这条字符串只说明 SnowLuma Action 执行失败，不能区分权限不足、QQ 服务端拒绝、文件已不存在或其他 OIDB 错误。

## 修复内容

1. OneBot WebSocket 客户端读取并保留 SnowLuma `wording`，同时继续做敏感信息脱敏。
2. 删除旧文件前查询目标群文件列表：
   - 文件已经不存在：按幂等成功处理，不再让待清理队列永久积压；
   - 文件仍存在：继续调用 `delete_group_file`。
3. 删除动作报错后再次查询：
   - 报错但文件已经消失：按成功处理；
   - 文件仍存在或查询失败：保留待清理状态，并在日志写出 `presence=present|unknown` 与真实 `wording`。
4. 状态中保存上传时的目标文件夹，避免规则后来改目录时查错位置。

## 回归验证

- SnowLuma `wording` 能穿过 WebSocket 边界出现在异常中；
- 群文件列表结构能正确解析；
- 精确文件 ID 的存在/缺失判断正确；
- 根目录与子目录都使用对应查询动作；
- 查询迁移代码不在改动范围内。

## 生产验收

部署后触发一次旧文件清理，检查日志：

- 若文件早已不存在，应出现“按已清理处理”或“按幂等成功处理”；
- 若文件仍存在但删除失败，日志应显示 SnowLuma/QQ 的真实错误，而不再只有 `100:failed`；
- `group-file-mirror-state.json` 中已经不存在的文件不应继续留在 `pendingCleanup`。
""", encoding="utf-8")

print("GFM-DELETE-001 SnowLuma diagnostics patch applied")
