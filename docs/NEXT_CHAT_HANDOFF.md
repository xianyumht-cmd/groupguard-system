# GroupGuard 双任务只读诊断交接

更新时间：2026-07-31 14:30 +08:00  
状态：`awaiting_readonly_diagnosis_execution`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

当前并行任务：

```text
GG-BATTLE-DELIVERY-001  战绩图片交付插件端只读链路诊断
GFM-DELETE-002          群文件假缺失原始列表只读诊断
```

## 1. 必须先读取

```text
docs/CURRENT_TASK_STATE.json
docs/NEXT_CHAT_HANDOFF.md
docs/PROJECT_IDENTITY.md
docs/GG_BATTLE_DELIVERY_001_STATIC_REVIEW.md
docs/GFM_DELETE_002.md
```

## 2. 当前生产身份

```text
仓库：xianyumht-cmd/groupguard-system
Windows：D:\project2\napcatplugin\lengxi_repo
核心目录：onebot-plugin-groupguard
ARM：root@192.168.3.89
生产目录：/mnt/sda1/groupguard/app
容器：groupguard-snowluma
宿主：SnowLuma
通信：OneBot
```

NapCat 仅为历史宿主和兼容构建。当前故障判断必须以 SnowLuma 实际链路为准。

## 3. 战绩接口端不得重复排查

LOLDataSystem P009 已部署成功：

```text
生产提交：d2416c90c6a37cc27fed2ccde4c71aa40c81a53b
HTTP：200
response.ok：true
接口独立诊断 preferred：auto
image capability：true
delivery.kind：segments
首个 segment.type：image
MIME：image/png
图片字节：373591
fallback：无
```

接口端能够正常生成并返回图片。禁止重新修改或部署 5001/6178。

## 4. GG-BATTLE-DELIVERY-001 静态审查结果

完整链路：

```text
executeBattleIntranetQuery
  -> requestIntranetDelivery
  -> requestGroupGuardQueryDelivery
  -> parseGroupGuardQueryDelivery
  -> toOneBotDeliveryPlan
  -> buildIntranetStructuredResult
  -> sendUnifiedCommandResponse
  -> response_capture_runtime.send
  -> pluginState.sendGroupMsg
  -> send_group_msg
  -> SnowLuma / OneBot
```

请求 capabilities 固定为：

```text
text=true
image=true
forward=true
```

实际 `preferred` 依次取：

1. 解析后的群设置 `lolQueryOutputFormat`；
2. `queryCommandProfiles.lol_battle.outputFormat`；
3. 根配置 `lolQueryOutputFormat`；
4. 最终默认 `forward`。

图片 segment 在插件端严格校验 Base64、MIME、字节数和 SHA-256，随后转换成：

```json
{"type":"image","data":{"file":"base64://<data>"}}
```

当前生产日志通常不记录成功请求、segment 摘要、Base64 摘要和成功 message_id，因此真实查询后仍可能只能得到：

```text
E = 现有日志不足，需要最小临时诊断埋点
```

判定代码：

```text
A 配置解析为 preferred=text
B delivery/Base64 解析失败
C 图片有效但未进入 send_group_msg
D SnowLuma/OneBot send_group_msg 失败
E 当前日志不足
```

## 5. GFM-DELETE-002 当前假设

现象：目标群仍存在多份历史文件，但 WebUI 显示 `pendingCleanup=0` 且无错误。

当前代码在删除前查询目标列表。若精确 `file_id` 未命中，会直接把旧文件标记为已删除并移出待清理队列。因此待确认：

```text
1. list_structure_mismatch
   SnowLuma 返回结构与插件解析假设不一致。

2. id_format_mismatch
   upload_group_file 返回 ID 与列表返回 ID 表示不同。

3. list_visibility_delay_or_inconsistency
   上传后第一次列表查询暂时看不到文件，后续才出现。
```

只读探针会对每条启用规则执行三次：

```text
0ms / 1500ms / 5000ms
get_group_root_files 或 get_group_files_by_folder
```

记录结构、字段、数量、列表指纹、ID 格式、精确/规范化/文件名大小匹配和耗时。

注意：旧记录一旦被错误移出 `pendingCleanup`，状态文件不再保留历史 `targetFileId`。若结果为 `insufficient_historical_state`，需旧日志或下一次受控上传窗口补证，不能伪造最终结论。

## 6. 已生成一键只读诊断包

文件：

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit.zip
SHA-256：e29daffdac2c16a707498a01256cc5cfc68dfec4f865965de2300f07bafa07da
```

入口：

```text
run-readonly-groupguard-diagnosis.cmd
```

执行过程：

1. 检查本地分支、HEAD 和工作区；
2. 记录生产容器状态和关键文件哈希；
3. 在容器内读取配置，但不输出 access token；
4. 只调用 `get_login_info`、`get_group_root_files`、`get_group_files_by_folder`；
5. 提示用户在 QQ 群执行一次真实“查战绩”；
6. 收集时间窗口内脱敏容器日志；
7. 再次记录生产文件哈希；
8. 输出 JSON、文本摘要、原始脱敏日志和 ZIP；
9. 明确报告 `production_modified=false`、`service_restarted=false`。

## 7. 下一步

用户运行诊断包后，上传：

```text
reports\groupguard-readonly-diagnosis-<timestamp>.zip
```

收到 ZIP 后：

1. 校验 manifest 和前后文件哈希；
2. 读取 `readonly-onebot-probe.json`；
3. 对 GFM 给出结构、ID 格式、列表延迟或历史状态不足的单一结论；
4. 读取战绩 resolved preferred 和真实查询日志；
5. 对战绩给出 A/B/C/D/E 单一结论；
6. 只有结论 E 时，设计最小化、可关闭、可回滚、绝不记录完整 Base64/秘密字段的临时埋点；
7. 未经明确授权，不修改生产、不部署、不合并 main。

## 8. 禁止事项

- 不要重新排查或部署接口端；
- 不要先修改 6178、6108 或生产配置；
- 不要重启容器；
- 不要执行 `git pull/reset/clean/checkout`；
- 不要输出 token、cookie、authorization、密码或完整 Base64；
- 不要在证据不足时直接修 Base64、发送格式或 GFM 删除逻辑。
