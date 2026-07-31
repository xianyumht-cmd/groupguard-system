# GG-BATTLE-DELIVERY-001：插件端图片交付静态审查

更新时间：2026-07-31 14:30 +08:00  
状态：`readonly_package_ready`  
工作分支：`codex/gg-battle-delivery-diagnosis-20260731`

## 已确认调用链

```text
查战绩命令
  -> intranet_battle_runtime_plugin.executeBattleIntranetQuery
  -> intranet_query_service.requestIntranetDelivery
  -> groupguard_query_delivery_client.requestGroupGuardQueryDelivery
  -> parseGroupGuardQueryDelivery
  -> toOneBotDeliveryPlan
  -> intranet_query_runtime_plugin.buildIntranetStructuredResult
  -> command_response_formatter.sendUnifiedCommandResponse
  -> response_capture_runtime.send
  -> communicationStateService.sendGroupMsg
  -> pluginState.sendGroupMsg
  -> send_group_msg
  -> SnowLuma / OneBot
```

## 请求参数静态结论

战绩请求固定包含：

```json
{
  "feature": "battle",
  "capabilities": {
    "text": true,
    "image": true,
    "forward": true
  }
}
```

`preferred` 的实际来源按以下顺序解析：

1. 解析后的群设置 `lolQueryOutputFormat`；
2. `queryCommandProfiles.lol_battle.outputFormat`；
3. 根配置 `lolQueryOutputFormat`；
4. 上述均无值时默认 `forward`。

因此必须读取生产配置才能确认实际请求是 `text`、`image`、`forward` 还是 `auto`，不能只依据接口端独立诊断的 `preferred=auto` 推断插件真实请求。

## delivery 与 Base64 静态结论

`groupguard_query_delivery_client.ts` 对图片 segment 执行严格校验：

- segment 字段必须完全匹配协议；
- `encoding` 必须为 `base64`；
- MIME 只允许 PNG/JPEG/WebP；
- Base64 字符和长度必须合法；
- 解码后大小必须在限制内；
- 声明字节数必须等于真实字节数；
- 声明 SHA-256 必须等于解码后的真实 SHA-256。

通过校验后转换为：

```json
{
  "type": "image",
  "data": {
    "file": "base64://<image-data>"
  }
}
```

随后作为 structured delivery 进入 `sendGroupMsg`，最终调用 OneBot `send_group_msg`。

## 文字回退链路

存在两类文字结果：

1. 请求或解析过程抛出异常：`executeBattleIntranetQuery` 捕获后返回“内网查询服务暂时不可用，请稍后再试。”；
2. 上游 envelope 本身为 `ok=false`：`toOneBotDeliveryPlan` 把 `error.user_message` 转为 text segment。

正常的图片发送失败发生在 `send_group_msg` 阶段时，会向上抛出并由命令引擎记录执行异常；当前代码没有为该阶段显式再发送一条战绩文字结果。

## 当前可观测性缺口

现有生产日志通常不完整记录：

- 最终 resolved `preferred`；
- 请求 capabilities；
- delivery.kind 和 segment 类型摘要；
- Base64 长度、解码字节数、MIME、魔数和 SHA-256；
- 成功进入 `send_group_msg` 时的 segment 摘要；
- OneBot 成功响应的 message_id。

因此只读诊断包先读取生产配置、静态源码、容器日志和发送失败证据。若实际查询窗口没有出现足够字段，应得出结论 `E`：现有日志不足，下一步设计最小化、可关闭、可回滚的临时诊断埋点；不得直接猜测并修改 6108、6178 或生产配置。

## 一键只读诊断包

聊天交付包：

```text
GroupGuard-GFM-DELETE-002-GG-BATTLE-DELIVERY-001-readonly-diagnosis-kit.zip
```

主要入口：

```text
run-readonly-groupguard-diagnosis.cmd
```

包内只调用只读 OneBot 动作并采集脱敏日志，不修改生产、不重启、不构建、不部署。
