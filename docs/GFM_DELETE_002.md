# GFM-DELETE-002：群文件“假缺失”生产只读诊断

更新时间：2026-07-31 14:30 +08:00  
状态：`awaiting_readonly_diagnosis_execution`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

## 问题现象

目标群文件列表中仍保留多份历史搬运文件，但 GroupGuard WebUI 显示：

- 等待清理数量为 `0`；
- 最近错误为“暂无”；
- 最近搬运成功时间持续更新。

来源群文件列表只保留最新文件，因此历史文件不是来源群残留，而是目标群旧文件清理链路没有真实收敛。

## 当前代码风险

`group_file_mirror_service.ts` 当前逻辑会在删除前调用：

- 根目录：`get_group_root_files`；
- 子目录：`get_group_files_by_folder`。

随后使用返回列表中的 `file_id` 与状态中的 `targetFileId` 做精确比较。只要比较结果为“不存在”，代码就立即把 `fileDeleted=true` 并从 `pendingCleanup` 清除，不再调用 `delete_group_file`。

因此以下三类情况均可能造成假成功：

1. SnowLuma 返回结构与插件解析假设不一致，导致解析出空列表；
2. 上传返回的 `file_id` 与列表返回的 `file_id` 表示形式不同；
3. 上传后列表存在短暂可见性延迟，首次查询暂时查不到。

此外，旧记录一旦因假缺失被移出 `pendingCleanup`，状态文件会丢失对应历史 `targetFileId`，后续只能通过旧日志或下一次受控搬运窗口恢复证据。

## 本阶段目标

只读确认主因属于哪一种：

- `list_structure_mismatch`：列表结构不匹配；
- `id_format_mismatch`：同一文件的 ID 表示不同；
- `list_visibility_delay_or_inconsistency`：重复查询结果发生变化；
- `insufficient_historical_state`：当前列表正常，但历史 ID 已被状态清除，需旧日志或下一次上传窗口继续确认。

## 只读诊断方法

对每条启用规则执行三次只读快照：

```text
0 ms
1500 ms
5000 ms
```

只调用：

```text
get_login_info
get_group_root_files
get_group_files_by_folder
```

每次记录：

- OneBot transport 状态、retcode、wording；
- 顶层字段、`data` 字段、文件数组所在路径；
- 文件对象字段名；
- 文件数量与列表指纹；
- `file_id` 长度、前后缀、是否以 `/` 开头、URL 编码特征和 SHA-256；
- 与 `current`、`pendingCleanup` 的精确匹配、规范化匹配、文件名和大小候选匹配；
- 查询耗时和三次结果是否一致。

## 安全边界

本任务不得：

- 修改生产配置或状态；
- 删除、上传或移动任何群文件；
- 重启容器或服务；
- 构建、部署或覆盖生产文件；
- 执行 `git pull/reset/clean/checkout`；
- 输出 OneBot access token。

## 下一步判定

1. 若结构不匹配：修正列表解析器，未知结构不得判定为 absent。
2. 若 ID 格式不匹配：建立明确、可测试的 ID 规范化规则，仍以精确 ID 为优先。
3. 若列表延迟：引入多次确认和最小稳定窗口，单次 absent 不得清理状态。
4. 若历史状态已丢失：从旧日志恢复历史 ID，或等待下一次真实上传执行受控观察。
5. 无论哪种原因，后续修复必须把“无法确认”视为 `unknown`，保留 `pendingCleanup`，不得继续假成功。

未经明确授权，不进入代码修复和生产部署阶段。
