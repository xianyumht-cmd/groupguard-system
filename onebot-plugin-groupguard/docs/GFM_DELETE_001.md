# GFM-DELETE-001：`delete_group_file:100:failed` 排查记录

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
