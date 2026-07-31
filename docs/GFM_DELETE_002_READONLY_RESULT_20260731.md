# GFM-DELETE-002 生产只读诊断结果

时间：2026-07-31 14:57-14:59 +08:00  
状态：`root_cause_narrowed`

## 1. 报告与安全校验

用户上传：

```text
reports(2).zip
SHA-256: 96132c25d3ef5a444458062437f7fee262eb98a4a77ac0436feadac8a4678b57
```

`manifest.json` 中 10 个文件的字节数和 SHA-256 均校验通过。

生产前后以下文件哈希完全一致：

```text
/app/dist/snowluma-service.mjs
/app/dist/build-info.json
/app/config/config.json
/app/config/group-file-mirror.json
/app/data/group-file-mirror-state.json
```

容器始终：

```text
status=running
restart_count=0
```

因此：

```text
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

## 2. OneBot 列表实测

规则：

```text
rule_id=mp1
source_group_id=125253150
target_group_id=960957757
folder_id=/
action=get_group_root_files
```

三次读取均成功：

```text
files_path=files
top_level_keys=files,folders
retcode=0
files_count=6
snapshot_counts=6,6,6
```

三次列表指纹完全相同：

```text
6673ce5c932063eabb8a7d8926f18b7532dd7859419b608842f5de9dec6756f7
```

当前文件：

```text
name=3Aln5swi.7z
file_id=/fdbca459-7d44-48f8-8250-03fe40cb65d7
size=17098443
upload_time=2026-07-31 14:54:18 +08:00
mirrored_at=2026-07-31 14:54:21.285 +08:00
```

当前状态中的 `targetFileId` 与三次列表返回的 `file_id` 全部精确相等，文件名和大小也一致：

```text
current_present_sequence=true,true,true
exact_match=true
normalized_match=true
```

## 3. 已排除项

当前生产环境可以排除：

```text
list_structure_mismatch
persistent_id_format_mismatch
steady_state_list_inconsistency
```

原因：

1. SnowLuma 返回顶层 `files` 和 `folders`，与插件解析器兼容；
2. 当前上传返回并保存的 slash-prefixed UUID 与列表返回值精确一致；
3. 三次列表数量、顺序和指纹全部稳定。

## 4. 为什么报告仍是 insufficient_historical_state

当前状态：

```text
pendingCleanup=[]
state_last_error=""
```

目标群实际仍有 6 个文件，其中 5 个是历史文件。但旧清理记录已经从 `pendingCleanup` 删除，状态文件不再保存这些历史记录当时的：

```text
targetFileId
清理前列表结果
delete_group_file 请求与响应
fileDeleted 被置 true 的具体分支
```

因此无法仅凭现在的状态，反推每一个旧文件当时究竟是：

1. 被单次列表误判为 absent；
2. `delete_group_file` 返回成功但文件实际仍存在；
3. 规则的 `keepLatestOnly/deletePreviousTargetFile` 当时未启用；
4. 其他清理窗口瞬态行为。

## 5. 代码层重要发现

现有清理代码存在两个可靠性缺口：

1. 删除前只做一次存在性查询，单次未命中即按已清理处理；
2. `delete_group_file` 返回成功后立即设置 `fileDeleted=true`，没有再次读取列表确认文件确实消失。

因此即使 SnowLuma/QQ 返回假成功或列表短暂不一致，状态也可能变成：

```text
pendingCleanup=0
lastError=""
实际文件仍存在
```

该状态与本次生产现象完全一致，但由于历史动作响应已经丢失，目前只能定为“高风险匹配”，不能伪造为已完全证明的唯一根因。

## 6. 下一步决策

不再重复运行 v3 普通快照。下一步只需补两类证据：

1. 只读读取规则的 `keepLatestOnly` 与 `deletePreviousTargetFile` 实际值；
2. 在下一次自然搬运窗口记录旧文件 ID、清理动作前后列表和状态变化。

判定规则：

```text
flags=false -> WebUI/配置原因
flags=true 且动作成功后旧文件仍在 -> 插件需增加删除后确认并保留 pending
flags=true 且动作失败/异常 -> SnowLuma/OneBot 删除动作链路问题
flags=true 且清理前单次列表未命中、后续出现 -> 列表瞬态不一致
```

未经用户明确授权，不执行手动删除、不修改生产配置、不部署代码。
