# GroupGuard 双任务只读诊断交接

更新时间：2026-07-31 14:31 +08:00  
状态：`awaiting_readonly_diagnosis_execution_v2`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

当前任务：

```text
GG-BATTLE-DELIVERY-001  战绩图片交付插件端只读链路诊断
GFM-DELETE-002          群文件假缺失原始列表只读诊断
```

## 1. 已确认边界

- 当前生产宿主是 SnowLuma，通信层是 OneBot；NapCat 只是历史宿主和兼容构建。
- LOLDataSystem P009 已经证明返回 `image/png` segment，图片字节为 373591，未发生接口端文字回退。
- 不得重复排查或修改 5001/6178，也不得先修改 6108 或生产配置。

## 2. 静态链路

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

`preferred` 依次取群设置、`queryCommandProfiles.lol_battle.outputFormat`、根配置，最终默认 `forward`。图片 Base64、MIME、真实字节数和 SHA-256 会在插件端严格校验，合法图片转换为 `base64://` OneBot 图片段。

最终判定代码：

```text
A 配置解析为 preferred=text
B delivery/Base64 解析失败
C 图片有效但未进入 send_group_msg
D SnowLuma/OneBot send_group_msg 失败
E 当前日志不足，需要最小临时诊断埋点
```

## 3. GFM-DELETE-002 当前待证原因

```text
1. list_structure_mismatch
2. id_format_mismatch
3. list_visibility_delay_or_inconsistency
4. insufficient_historical_state
```

当前代码会把单次列表精确 ID 未命中直接当作 absent，并把记录从 `pendingCleanup` 清除。只读探针需要读取三次群文件列表，比较结构、字段、ID、文件名、大小、列表指纹和时间变化。

## 4. 首次执行失败

首次运行 v1 包时间：

```text
2026-07-31 14:25:16 +08:00
```

错误：

```text
root@192.168.3.89: Permission denied (publickey,password).
```

原因：首版脚本强制使用 `BatchMode=yes`，禁止交互式密码认证；Windows PowerShell 5.1 又把 ssh stderr 提升为 `NativeCommandError`，使脚本提前中止。

用户上传的 `reports.zip` 只包含本地仓库状态和静态源码证据，没有生产前后快照、OneBot 探针或容器日志。因此：

```text
production_evidence_collected=false
production_modified=false
service_restarted=false
build_executed=false
deployment_executed=false
git_updated=false
```

首次本地报告还显示：

```text
branch=main
head=600bf3ca678b76061733485efe6bc2b06ba648dd
expected_branch=codex/gg-battle-delivery-diagnosis-20260731
working_tree_dirty=false
```

这不是 SSH 失败原因。当前工作分支相对 main 的差异主要是诊断文档，v2 包仍可在不切换分支、不更新 Git 的情况下进行生产只读采集。

详细记录：

```text
docs/READONLY_DIAGNOSIS_AUTH_FIX_20260731.md
```

## 5. v2 诊断包

文件：

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit-v2.zip
SHA-256：9309f2f4ce1a9c6a0ff3b5104b6d8963c8ce1ede85a2d4a9a96824fb81cf6840
```

v2 修复：

- 移除 `BatchMode=yes`；
- 支持 `publickey,keyboard-interactive,password`；
- 最多允许三次密码输入；
- 兼容 Windows PowerShell 5.1 原生 stderr 行为；
- 不保存、不输出 SSH 密码；
- 不修改服务器、配置、容器或 Git。

## 6. 下一步执行

先在 Windows 手动验证：

```powershell
ssh root@192.168.3.89
```

确认密码可以登录后输入：

```text
exit
```

然后解压 v2 包并运行：

```text
run-readonly-groupguard-diagnosis.cmd
```

运行期间可能多次提示：

```text
root@192.168.3.89's password:
```

输入密码时屏幕不显示字符是正常现象。按提示在 QQ 群执行一次真实“查战绩”，最后上传：

```text
reports\groupguard-readonly-diagnosis-<timestamp>.zip
```

收到新报告后必须：

1. 校验生产前后文件哈希和安全声明；
2. 读取 `readonly-onebot-probe.json`；
3. 对战绩给出 A/B/C/D/E 单一结论；
4. 对 GFM 给出列表结构、ID 格式、列表延迟或历史状态不足的单一结论；
5. 只有结论 E 时，才设计最小、可关闭、可回滚且不记录秘密或完整 Base64 的临时埋点；
6. 未经明确授权，不修改生产、不部署、不合并 main。
