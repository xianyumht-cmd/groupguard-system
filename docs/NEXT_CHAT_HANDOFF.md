# GroupGuard 当前任务交接

更新时间：2026-07-31 15:08 +08:00  
状态：`root_cause_narrowed_awaiting_cleanup_action_verification`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

当前仅剩任务：

```text
GFM-DELETE-002  群文件历史文件未清理诊断
```

## 1. 战绩任务已经关闭

`GG-BATTLE-DELIVERY-001` 已解决：群 `805402626` 的输出配置原来是 `text`。用户调整配置后问题消失。

后续不再排查战绩接口、图片 Base64、SnowLuma 图片发送或 5001/6178/6108。

## 2. v3 GFM 只读报告已经成功

用户上传：

```text
reports(2).zip
SHA-256: 96132c25d3ef5a444458062437f7fee262eb98a4a77ac0436feadac8a4678b57
```

`manifest.json` 的 10 个文件全部通过字节数和 SHA-256 校验。

安全结果：

```text
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

生产前后关键文件哈希一致，容器一直 running，`restart_count=0`。

## 3. GFM 实测结果

规则：

```text
rule=mp1
source=125253150
target=960957757
folder=/
action=get_group_root_files
```

三次列表读取：

```text
retcode=0
files_path=files
top_level_keys=files,folders
counts=6,6,6
fingerprints=完全一致
```

当前文件：

```text
name=3Aln5swi.7z
file_id=/fdbca459-7d44-48f8-8250-03fe40cb65d7
size=17098443
upload_time=2026-07-31 14:54:18 +08:00
```

状态中的当前 `targetFileId` 与三次 OneBot 列表返回值均精确相等，文件名和大小也一致：

```text
current_present_sequence=true,true,true
exact_match=true
normalized_match=true
```

目标群实际有 6 个文件，但：

```text
pendingCleanup=[]
lastError=""
```

## 4. 已排除与尚未证明

当前环境已经排除：

```text
list_structure_mismatch
persistent_id_format_mismatch
steady_state_list_inconsistency
ARM 性能不足
```

普通快照的正式结论仍是：

```text
insufficient_historical_state
```

原因：旧 `pendingCleanup` 已被清除，状态文件不再保存旧文件当时的目标 ID、列表结果、`delete_group_file` 请求响应和 `fileDeleted=true` 的具体分支。

因此目前还需在以下分支中选择唯一根因：

```text
1. keepLatestOnly/deletePreviousTargetFile 实际为 false -> WebUI/配置原因
2. delete_group_file 返回成功但文件仍在 -> 插件缺少删除后确认
3. delete_group_file 返回失败或异常 -> SnowLuma/OneBot 删除链路
4. 清理窗口列表短暂漏报 -> 单次 absent 判断错误清除 pending
```

## 5. 已确认的插件可靠性缺口

当前代码：

1. 删除前只做一次列表查询，单次未命中就按 absent 成功处理；
2. `delete_group_file` 返回成功后立即设置 `fileDeleted=true`，没有再次读取列表确认文件确实消失。

因此确实可能形成：

```text
pendingCleanup=0
lastError=""
实际历史文件仍存在
```

但不能把该匹配直接冒充为已经证明的唯一历史根因。

详细报告：

```text
docs/GFM_DELETE_002_READONLY_RESULT_20260731.md
```

## 6. 下一步

不要重复运行 v3 普通快照。

下一步应制作并运行一次 GFM 专用“清理动作只读观察”包：

1. 读取并仅输出 `keepLatestOnly`、`deletePreviousTargetFile` 等非秘密规则开关；
2. 记录基线 current/列表；
3. 等待下一次正常、自然发生的文件搬运；
4. 捕获旧 current ID、新 current ID、pendingCleanup 变化；
5. 读取删除前后列表和相关容器日志；
6. 不主动上传、不手动删除、不修改配置、不重启服务。

根据结果再决定：

```text
WebUI/配置修正
或
插件增加多次 absent 确认、删除后确认和 pending 保留
或
转向 SnowLuma delete_group_file 链路
```

## 7. 固定安全边界

- 不主动制造上传或删除；
- 不修改 5001、6178、6108 或生产配置；
- 不重启、不构建、不部署；
- 不执行 git pull/reset/clean/checkout；
- 不输出 token、cookie、authorization、密码；
- 未经明确授权不合并 main、不部署修复。
