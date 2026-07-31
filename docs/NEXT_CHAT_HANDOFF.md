# GG-BATTLE-DELIVERY-001 新聊天交接

更新时间：2026-07-31 13:59 +08:00  
状态：`paused_for_new_chat`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

## 1. 新聊天必须先做什么

先读取并以仓库内容为准：

```text
docs/CURRENT_TASK_STATE.json
docs/NEXT_CHAT_HANDOFF.md
docs/NEW_CHAT_PROMPT.txt
docs/PROJECT_IDENTITY.md
```

然后审查：

```text
onebot-plugin-groupguard
```

重点搜索这些链路：

```text
查战绩 / battle
LOLDataSystem / 5001
capabilities / preferred
response.ok
delivery.kind
delivery.segments
segment.type=image
base64 / base64:// / data:image
SnowLuma / OneBot
send_msg / send_group_msg / image segment
fallback / text fallback / 降级
```

## 2. 已确认事实

### 2.1 上游接口已部署成功

`lolapisevers` 的 P009 安全部署已经完成：

```text
生产提交：d2416c90c6a37cc27fed2ccde4c71aa40c81a53b
服务：LOLDataSystem
部署结果：completed
```

P009 经历 v1-v4 的兼容性与验收探针修复，最终 v5 成功。后续不要重复部署 P009。

### 2.2 接口端没有把战绩降级为文字

已执行接口端战绩交付诊断，结果为：

```text
HTTP：200
response.ok：true
请求 preferred：auto
请求 image capability：true
delivery.kind：segments
首个 segment.type：image
MIME：image/png
图片字节：373591
delivery_fallback：无
```

结论：`LOLDataSystem` 正常生成并返回图片。QQ群里最终出现文字的问题发生在 GroupGuard 插件收到响应之后。

### 2.3 当前生产身份

以 `docs/PROJECT_IDENTITY.md` 为准：

```text
仓库：xianyumht-cmd/groupguard-system
Windows 本地：D:\project2\napcatplugin\lengxi_repo
核心目录：onebot-plugin-groupguard
ARM：root@192.168.3.89
生产目录：/mnt/sda1/groupguard/app
生产容器：groupguard-snowluma
当前宿主：SnowLuma
通信层：OneBot
```

NapCat 是历史宿主和兼容构建，不应直接把当前故障归因到 NapCat 专属 API。诊断中可以记录“NapCat/OneBot 图片发送调用”这一业务说法，但代码判断必须以 SnowLuma 实际适配层为准。

## 3. 当前目标

做一次插件端只读链路诊断，完整记录：

1. 插件实际发送给 5001 的请求参数。
2. `capabilities.text/forward/image` 和 `preferred` 的实际值。
3. 接口响应的 `ok`、`delivery.kind` 和每个 segment 的类型。
4. image segment 的字段名、编码形式和长度。
5. Base64 解码是否成功、解码后字节数、MIME、文件头和 SHA-256。
6. 插件是否进入 SnowLuma/OneBot 图片发送路径。
7. 调用的动作名、消息 segment 结构和参数类型。
8. 发送结果中的 retcode/status/message/message_id。
9. 捕获到的异常类型、错误消息和调用栈。
10. 图片失败后是否主动回退成文字，以及具体触发条件。

最终必须给出单一结论：

```text
A. 调整 6108 WebUI 配置
B. 修复插件响应解析/Base64
C. 修复消息路由
D. 修复 SnowLuma/OneBot 图片发送适配
E. 现有日志不足，需先增加临时诊断埋点
```

## 4. 安全边界

第一阶段只读，禁止：

- 修改生产配置。
- 重启容器或服务。
- 构建或部署。
- 修改 ARM 上任何文件。
- 执行 `git pull`、`git reset`、`git clean`、`git checkout`。
- 在报告中保存 token、cookie、authorization、密码或完整 Base64。
- 未经用户明确授权合并 `main` 或部署修复。

日志与报告必须脱敏：

```text
TOKEN
SECRET
PASSWORD / PASSWD
COOKIE
AUTHORIZATION
API_KEY / APIKEY
ACCESS_KEY
```

Base64 只记录：

```text
是否存在
原字符串长度
解码成功/失败
解码字节数
MIME/魔数
SHA-256
```

不得把完整图片 Base64 写入提交或聊天。

## 5. 推荐执行顺序

### 阶段 A：仓库静态审查

1. 找到战绩命令入口。
2. 找到对 LOLDataSystem 的请求构造器。
3. 找到统一交付响应解析器。
4. 找到 image segment 到 OneBot segment 的转换代码。
5. 找到 SnowLuma 动作调用器。
6. 找到文字回退条件。
7. 找到 6108 WebUI 对应配置字段及默认值。
8. 检查现有日志是否已经覆盖关键字段。

静态审查后先形成调用链图和字段映射，不要直接猜修复。

### 阶段 B：生成只读诊断包

诊断包应至少包含：

```text
run-readonly-battle-delivery-diagnosis.cmd
diagnose-battle-delivery-chain-readonly.ps1
README-FIRST.txt
diagnosis-plan.json
```

脚本行为：

1. 检查 SSH、仓库路径、容器和服务状态。
2. 记录开始时间。
3. 提示用户在 QQ 群中执行一次真实“查战绩”。
4. 只读取该时间窗口内相关容器日志。
5. 提取请求、响应、Base64、发送动作、返回结果、异常和回退证据。
6. 对日志中的秘密字段进行脱敏。
7. 生成机器可读 JSON、文本摘要和原始脱敏日志。
8. 在 Windows 本地打包 ZIP。
9. 明确报告 `production_modified=false`、`service_restarted=false`。

### 阶段 C：证据判定

按以下规则判断：

| 证据 | 结论 |
|---|---|
| 请求 `image=false` 或 `preferred=text` | WebUI/插件配置 |
| 响应含 image segment，Base64 解码失败 | 响应解析/Base64 代码 |
| Base64 成功但没有进入发送方法 | 消息路由代码 |
| 进入发送方法但 OneBot 返回失败 | SnowLuma/OneBot 适配 |
| 图片失败后主动发送文字 | 追查原始错误并保留可用回退 |
| 日志没有关键字段 | 设计临时诊断埋点，等待授权部署 |

## 6. 目前没有完成的事情

- 尚未从 ARM 收集本次真实查询的运行日志。
- 尚未确认插件发出的 capabilities/preferred。
- 尚未确认插件收到的 image segment 字段结构。
- 尚未验证 Base64 解码。
- 尚未确认 SnowLuma/OneBot 图片发送动作及返回值。
- 尚未确认文字回退代码路径。
- 尚未确定改 WebUI 还是改代码。
- 尚未提交诊断脚本、修复代码、PR 或部署包。

## 7. 不要重复或误做

- 不要再次排查 5001 是否能生成图片，已有证据证明它可以。
- 不要先改 6178 配置。
- 不要先改 6108 配置再观察，这会污染证据。
- 不要把 SnowLuma 生产链路当成 NapCat 插件目录部署。
- 不要在缺少实际调用证据时直接修 Base64。
- 不要因群里收到文字就断言 API 返回文字。

## 8. 新聊天完成标准

至少完成以下一项才算推进：

1. 生成经过静态审查的一键只读诊断包，并由用户在 Windows 运行；或
2. 用户已经上传诊断 ZIP，完成证据分析并明确 A/B/C/D/E 单一结论；或
3. 证明现有日志不足，提交最小化、可关闭、可回滚、不会记录秘密或完整 Base64 的诊断埋点方案。

未经用户明确授权，不进入生产修改与部署阶段。
