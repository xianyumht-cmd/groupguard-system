from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "onebot-plugin-groupguard/src/services/group_file_mirror_service.ts"
VERIFY = ROOT / "onebot-plugin-groupguard/scripts/verify-group-file-mirror.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


service = SERVICE.read_text(encoding="utf-8")

service = replace_once(
    service,
    """interface GroupFileDescriptor {\n  id: string;\n  name: string;\n  size: number;\n  busid: number;\n}\n""",
    """interface GroupFileDescriptor {\n  id: string;\n  name: string;\n  size: number;\n  busid: number;\n}\n\nexport interface ListedGroupFileDescriptor {\n  id: string;\n  name: string;\n  size: number;\n  busid: number;\n  uploadTime: number;\n}\n""",
    "listed group file interface",
)

service = replace_once(
    service,
    """  targetGroupId: string;\n  targetFileId: string;\n  targetMessageId: string;\n  mirroredAt: number;\n""",
    """  targetGroupId: string;\n  targetFileId: string;\n  targetDeleteFileId?: string;\n  targetBusid?: number;\n  targetMessageId: string;\n  mirroredAt: number;\n""",
    "mirror record deletion identity",
)

service = replace_once(
    service,
    """interface CleanupRecord {\n  targetGroupId: string;\n  targetFileId: string;\n  targetMessageId: string;\n  sourceFileName: string;\n  messageRecalled: boolean;\n  fileDeleted: boolean;\n  queuedAt: number;\n}\n""",
    """interface CleanupRecord {\n  targetGroupId: string;\n  targetFileId: string;\n  targetDeleteFileId?: string;\n  targetBusid?: number;\n  targetMessageId: string;\n  sourceFileName: string;\n  sourceFileSize?: number;\n  mirroredAt?: number;\n  messageRecalled: boolean;\n  fileDeleted: boolean;\n  queuedAt: number;\n}\n""",
    "cleanup record deletion identity",
)

service = replace_once(
    service,
    """function unwrapActionData(value: any): any {\n  return value?.data ?? value?.result ?? value;\n}\n""",
    """function unwrapActionData(value: any): any {\n  return value?.data ?? value?.result ?? value;\n}\n\nfunction normalizeUploadTime(value: unknown): number {\n  const number = Number(value);\n  if (!Number.isFinite(number) || number <= 0) return 0;\n  return number >= 1_000_000_000_000 ? number : number * 1000;\n}\n\nexport function extractListedGroupFiles(value: unknown): ListedGroupFileDescriptor[] {\n  const data = unwrapActionData(value);\n  const rawFiles = Array.isArray(data?.files)\n    ? data.files\n    : Array.isArray((value as any)?.files)\n      ? (value as any).files\n      : [];\n\n  const files: ListedGroupFileDescriptor[] = [];\n  for (const rawValue of rawFiles) {\n    const raw = isRecord(rawValue) ? rawValue : {};\n    const id = normalizeId(raw.file_id ?? raw.fileId ?? raw.id);\n    const name = normalizeId(raw.file_name ?? raw.fileName ?? raw.name);\n    if (!id || !name) continue;\n    files.push({\n      id,\n      name,\n      size: Math.max(0, Number(raw.file_size ?? raw.fileSize ?? raw.size ?? 0) || 0),\n      busid: Math.max(0, Number(raw.busid ?? raw.bus_id ?? 0) || 0),\n      uploadTime: normalizeUploadTime(raw.upload_time ?? raw.uploadTime ?? raw.modify_time ?? raw.modifyTime),\n    });\n  }\n  return files;\n}\n\nexport function selectListedGroupFileForUpload(\n  files: ListedGroupFileDescriptor[],\n  fileName: string,\n  fileSize: number,\n  uploadStartedAt: number,\n): ListedGroupFileDescriptor | null {\n  const matches = files.filter(file => file.name === fileName\n    && (fileSize <= 0 || file.size <= 0 || file.size === fileSize));\n  if (!matches.length) return null;\n\n  const timed = matches.filter(file => file.uploadTime > 0);\n  if (uploadStartedAt > 0 && timed.length) {\n    const withinWindow = timed.filter(file => Math.abs(file.uploadTime - uploadStartedAt) <= 5 * 60 * 1000);\n    const candidates = withinWindow.length ? withinWindow : timed;\n    return candidates.reduce((best, candidate) => (\n      Math.abs(candidate.uploadTime - uploadStartedAt) < Math.abs(best.uploadTime - uploadStartedAt)\n        ? candidate\n        : best\n    ));\n  }\n\n  if (matches.length === 1) return matches[0];\n  return timed.sort((left, right) => right.uploadTime - left.uploadTime)[0] || null;\n}\n""",
    "group file list helpers",
)

service = replace_once(
    service,
    """  private async mirrorUpload(rule: GroupFileMirrorRule, uploaderId: string, file: GroupFileDescriptor): Promise<void> {\n""",
    """  private async resolveTargetDeleteFile(\n    rule: GroupFileMirrorRule,\n    fileName: string,\n    fileSize: number,\n    uploadStartedAt: number,\n    requireUniqueWithoutTimestamp = false,\n  ): Promise<ListedGroupFileDescriptor | null> {\n    const attempts = Math.max(1, Math.min(rule.messageLookupAttempts || 1, 10));\n    const folderId = String(rule.targetFolderId || '/').trim() || '/';\n    const action = folderId === '/' ? 'get_group_root_files' : 'get_group_files_by_folder';\n    const params: Record<string, unknown> = {\n      group_id: groupParam(rule.targetGroupId),\n      file_count: 100,\n    };\n    if (folderId !== '/') {\n      params.folder_id = folderId;\n      params.folder = folderId;\n    }\n\n    for (let attempt = 0; attempt < attempts; attempt += 1) {\n      await sleep(rule.messageLookupDelayMs);\n      try {\n        const result = await this.callWithRetry(rule, action, params);\n        const files = extractListedGroupFiles(result);\n        const matches = files.filter(item => item.name === fileName\n          && (fileSize <= 0 || item.size <= 0 || item.size === fileSize));\n        if (requireUniqueWithoutTimestamp && uploadStartedAt <= 0 && matches.length !== 1) {\n          this.log('warn', `规则 ${rule.id} 无法安全解析旧群文件：同名候选数量=${matches.length} file=${fileName}`);\n          return null;\n        }\n        const selected = selectListedGroupFileForUpload(matches, fileName, fileSize, uploadStartedAt);\n        if (selected) return selected;\n      } catch (error) {\n        this.log('debug', `规则 ${rule.id} 第 ${attempt + 1} 次解析目标群文件删除 ID 失败: ${String(error)}`);\n      }\n    }\n    return null;\n  }\n\n  private async mirrorUpload(rule: GroupFileMirrorRule, uploaderId: string, file: GroupFileDescriptor): Promise<void> {\n""",
    "target delete resolver",
)

service = replace_once(
    service,
    """    const uploadResult = await this.callWithRetry(rule, 'upload_group_file', {\n      group_id: groupParam(rule.targetGroupId),\n      file: sourceUrl,\n      name: file.name,\n      folder: rule.targetFolderId,\n      upload_file: true,\n    });\n    const uploadData = unwrapActionData(uploadResult);\n    const targetFileId = normalizeId(uploadData?.file_id ?? uploadData?.fileId ?? uploadResult?.file_id ?? uploadResult?.fileId);\n    if (!targetFileId) throw new Error(`目标群上传成功但未返回 file_id: ${file.name}`);\n\n    const sourceMessage = this.findRecentMessage(rule.sourceGroupId, file.id, file.name, file.size);\n    let targetMessage = this.findRecentMessage(rule.targetGroupId, targetFileId, file.name, file.size);\n    if (!targetMessage && rule.messageLookupAttempts > 0) {\n      const targetMessageId = await this.findMessageIdInHistory(rule, targetFileId, file.name, file.size);\n""",
    """    const uploadStartedAt = Date.now();\n    const uploadResult = await this.callWithRetry(rule, 'upload_group_file', {\n      group_id: groupParam(rule.targetGroupId),\n      file: sourceUrl,\n      name: file.name,\n      folder: rule.targetFolderId,\n      upload_file: true,\n    });\n    const uploadData = unwrapActionData(uploadResult);\n    const targetUploadFileId = normalizeId(uploadData?.file_id ?? uploadData?.fileId ?? uploadResult?.file_id ?? uploadResult?.fileId);\n    if (!targetUploadFileId) throw new Error(`目标群上传成功但未返回 file_id: ${file.name}`);\n\n    const targetDeleteFile = await this.resolveTargetDeleteFile(rule, file.name, file.size, uploadStartedAt);\n    if (!targetDeleteFile) {\n      this.log('warn', `规则 ${rule.id} 上传成功，但暂未解析到可用于 delete_group_file 的目标文件 ID: ${file.name}`);\n    }\n\n    const sourceMessage = this.findRecentMessage(rule.sourceGroupId, file.id, file.name, file.size);\n    let targetMessage = this.findRecentMessage(rule.targetGroupId, targetUploadFileId, file.name, file.size);\n    if (!targetMessage && rule.messageLookupAttempts > 0) {\n      const targetMessageId = await this.findMessageIdInHistory(rule, targetUploadFileId, file.name, file.size);\n""",
    "upload raw versus deletable ID split",
)

service = replace_once(
    service,
    """          fileId: targetFileId,\n""",
    """          fileId: targetUploadFileId,\n""",
    "history target message raw ID",
)

service = replace_once(
    service,
    """      targetGroupId: rule.targetGroupId,\n      targetFileId,\n      targetMessageId: targetMessage?.messageId || '',\n      mirroredAt: Date.now(),\n""",
    """      targetGroupId: rule.targetGroupId,\n      targetFileId: targetUploadFileId,\n      targetDeleteFileId: targetDeleteFile?.id || '',\n      targetBusid: targetDeleteFile?.busid || 0,\n      targetMessageId: targetMessage?.messageId || '',\n      mirroredAt: Date.now(),\n""",
    "persist deletion identity",
)

service = replace_once(
    service,
    """    if (rule.keepLatestOnly && previous?.targetFileId && previous.targetFileId !== targetFileId) {\n""",
    """    if (rule.keepLatestOnly && previous?.targetFileId && previous.targetFileId !== targetUploadFileId) {\n""",
    "queue previous target comparison",
)

service = replace_once(
    service,
    """  private queueCleanup(state: MirrorRuleState, record: MirrorRecord): void {\n    if (state.pendingCleanup.some(item => item.targetGroupId === record.targetGroupId && item.targetFileId === record.targetFileId)) return;\n    state.pendingCleanup.push({\n      targetGroupId: record.targetGroupId,\n      targetFileId: record.targetFileId,\n      targetMessageId: record.targetMessageId,\n      sourceFileName: record.sourceFileName,\n      messageRecalled: !record.targetMessageId,\n      fileDeleted: !record.targetFileId,\n      queuedAt: Date.now(),\n    });\n  }\n""",
    """  private queueCleanup(state: MirrorRuleState, record: MirrorRecord): void {\n    const cleanupFileId = record.targetDeleteFileId || record.targetFileId;\n    if (state.pendingCleanup.some(item => item.targetGroupId === record.targetGroupId\n      && (item.targetDeleteFileId || item.targetFileId) === cleanupFileId)) return;\n    state.pendingCleanup.push({\n      targetGroupId: record.targetGroupId,\n      targetFileId: record.targetFileId,\n      targetDeleteFileId: record.targetDeleteFileId || '',\n      targetBusid: record.targetBusid || 0,\n      targetMessageId: record.targetMessageId,\n      sourceFileName: record.sourceFileName,\n      sourceFileSize: record.sourceFileSize,\n      mirroredAt: record.mirroredAt,\n      messageRecalled: !record.targetMessageId,\n      fileDeleted: !cleanupFileId,\n      queuedAt: Date.now(),\n    });\n  }\n""",
    "queue cleanup deletion identity",
)

service = replace_once(
    service,
    """    if (rule.deletePreviousTargetFile && item.targetFileId && !item.fileDeleted) {\n      try {\n        await this.callWithRetry(rule, 'delete_group_file', {\n          group_id: groupParam(item.targetGroupId),\n          file_id: item.targetFileId,\n        });\n        item.fileDeleted = true;\n      } catch (error) {\n        if (isAlreadyGoneError(error)) item.fileDeleted = true;\n        else this.log('warn', `规则 ${rule.id} 删除旧群文件失败 file=${item.targetFileId}: ${String(error)}`);\n      }\n    }\n""",
    """    if (rule.deletePreviousTargetFile && !item.fileDeleted) {\n      let deleteFileId = normalizeId(item.targetDeleteFileId);\n      let deleteBusid = Math.max(0, Number(item.targetBusid || 0) || 0);\n      if (!deleteFileId) {\n        const resolved = await this.resolveTargetDeleteFile(\n          rule,\n          item.sourceFileName,\n          Math.max(0, Number(item.sourceFileSize || 0) || 0),\n          Math.max(0, Number(item.mirroredAt || 0) || 0),\n          true,\n        );\n        if (resolved) {\n          deleteFileId = resolved.id;\n          deleteBusid = resolved.busid;\n          item.targetDeleteFileId = resolved.id;\n          item.targetBusid = resolved.busid;\n        }\n      }\n\n      if (!deleteFileId) {\n        this.log('warn', `规则 ${rule.id} 暂缓删除旧群文件：无法安全解析 delete_group_file 文件 ID file=${item.sourceFileName}`);\n        return;\n      }\n\n      const params: Record<string, unknown> = {\n        group_id: groupParam(item.targetGroupId),\n        file_id: deleteFileId,\n      };\n      if (deleteBusid > 0) params.busid = deleteBusid;\n\n      try {\n        await this.callWithRetry(rule, 'delete_group_file', params);\n        item.fileDeleted = true;\n      } catch (error) {\n        if (isAlreadyGoneError(error)) item.fileDeleted = true;\n        else this.log('warn', `规则 ${rule.id} 删除旧群文件失败 file=${deleteFileId} busid=${deleteBusid}: ${String(error)}`);\n      }\n    }\n""",
    "safe delete action",
)

SERVICE.write_text(service, encoding="utf-8")

verify = VERIFY.read_text(encoding="utf-8")
verify = replace_once(
    verify,
    """  extractFileSegmentsFromMessage,\n  fileEventMatchesRule,\n  normalizeGroupFileMirrorConfig,\n""",
    """  extractFileSegmentsFromMessage,\n  extractListedGroupFiles,\n  fileEventMatchesRule,\n  normalizeGroupFileMirrorConfig,\n  selectListedGroupFileForUpload,\n""",
    "verification imports",
)

verify = replace_once(
    verify,
    """  assert.equal(rule.retryCount, 3);\n\n  const canonical = extractFileSegmentsFromMessage({\n""",
    """  assert.equal(rule.retryCount, 3);\n\n  const listedFiles = extractListedGroupFiles({\n    data: {\n      files: [\n        {\n          file_id: 'encoded-old-file-id',\n          file_name: 'same-package.7z',\n          file_size: 4096,\n          busid: 102,\n          upload_time: 1785400000,\n        },\n        {\n          file_id: 'encoded-new-file-id',\n          file_name: 'same-package.7z',\n          file_size: 4096,\n          busid: 102,\n          upload_time: 1785400060,\n        },\n      ],\n    },\n  });\n  assert.equal(listedFiles.length, 2, 'group file list response is normalized');\n  const selectedDeleteFile = selectListedGroupFileForUpload(\n    listedFiles,\n    'same-package.7z',\n    4096,\n    1785400060 * 1000,\n  );\n  assert.equal(selectedDeleteFile?.id, 'encoded-new-file-id', 'deletable encoded file ID is selected by upload time');\n  assert.equal(selectedDeleteFile?.busid, 102, 'delete_group_file busid is preserved');\n\n  const canonical = extractFileSegmentsFromMessage({\n""",
    "listed file verification",
)

verify = replace_once(
    verify,
    """  assert.match(serviceSource, /get_group_file_url/);\n  assert.match(serviceSource, /upload_group_file/);\n  assert.match(serviceSource, /delete_group_file/);\n""",
    """  assert.match(serviceSource, /get_group_file_url/);\n  assert.match(serviceSource, /upload_group_file/);\n  assert.match(serviceSource, /get_group_root_files/);\n  assert.match(serviceSource, /get_group_files_by_folder/);\n  assert.match(serviceSource, /targetDeleteFileId/);\n  assert.match(serviceSource, /delete_group_file/);\n""",
    "service contract verification",
)

VERIFY.write_text(verify, encoding="utf-8")
print("GFM-DELETE-001 patch applied")
