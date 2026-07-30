# GroupGuard 内网查询边界（强制规则）

> 状态：规范性文档（normative）  
> 生效范围：SnowLuma / OneBot GroupGuard 的内置查询功能，以及未来新增的外部数据查询功能  
> 对接服务：`xianyumht-cmd/lolapisevers`

## 1. 核心原则

GroupGuard 是群消息入口和 QQ 传输适配层，不是第三方数据抓取与业务处理服务。

所有需要访问公网、解析第三方数据、归一化业务字段、排序/评分、绘图、缓存、重试、故障降级或保存上游凭据的工作，必须由内网电脑上的服务完成。

标准链路：

```text
群成员指令
  -> GroupGuard：识别指令、鉴权、功能开关、限流、生成 request_id
  -> 内网 API：访问公网/本地快照、解析、业务处理、绘图、生成最终下发载荷
  -> GroupGuard：按内网 API 返回的最终下发载荷执行 OneBot 发送
```

这里的“下发由内网接口完成”指：内网服务决定最终发送类型、内容和降级结果；GroupGuard 只执行 QQ/OneBot 传输动作，不再自行解释业务数据或决定备用业务逻辑。

## 2. GroupGuard 允许承担的职责

GroupGuard 可以且仅应承担以下查询职责：

1. 识别群内命令和提取最小原始参数。
2. 执行授权、群功能开关、主人/管理员权限和查询限流。
3. 生成稳定 `request_id`、记录命令名、群号、用户号和耗时。
4. 调用配置好的内网服务地址。
5. 校验内网响应是否符合约定的交付协议。
6. 将服务返回的最终文本、图片地址或转发节点转换为 OneBot 动作并发送。
7. 在传输失败时记录日志；不得重新抓取公网数据作为业务备用方案。

## 3. GroupGuard 禁止承担的职责

内置查询功能中禁止：

- 直接访问 GitHub Raw、腾讯静态资源、OP.GG 或其他公网业务数据源。
- 下载并解析英雄列表、合集数据、网页 HTML 或第三方 JSON。
- 在插件内维护英雄别名、数据排序、胜率/选率计算、推荐评分等业务规则。
- 在插件内绘制最终查询图片。
- 在插件内保存第三方 Provider 的账号、令牌、Cookie 或公网接口凭据。
- 在插件内实现上游重试、熔断、持久化 last-known-good 或 stale-while-revalidate。
- 在内网服务失败时绕过服务，改为直连第三方公网接口。
- 让管理页面的“测试接口”与真实群命令使用不同业务实现。

## 4. 内网交付协议

长期目标是由 `lolapisevers` 返回统一的最终交付载荷。建议协议名：

```text
groupguard-query-delivery.v1
```

最小结构：

```json
{
  "contract": "groupguard-query-delivery.v1",
  "request_id": "stable-request-id",
  "ok": true,
  "command": "lol_shard",
  "delivery": {
    "kind": "image_url",
    "text": "",
    "url": "http://192.168.3.100:5001/...",
    "nodes": []
  },
  "meta": {
    "source": "live|cache|stale|snapshot",
    "updated_at": "2026-07-28T00:00:00+08:00",
    "stale": false,
    "cache_expires_in": 600,
    "warnings": []
  },
  "error": null
}
```

允许的 `delivery.kind` 初始集合：

- `text`
- `image_url`
- `forward`
- `none`

GroupGuard 不应根据 `meta.source` 重新计算内容；只需把服务已经生成的用户可见说明一并发送。

## 5. 网络边界

默认允许的网络连接：

- SnowLuma OneBot WebSocket。
- 明确配置的内网 API 地址（回环地址或 RFC1918 局域网地址）。
- 已有的内网蓝奏监控回调链路。
- OneBot 动作返回的群文件下载地址，用于已批准的群文件搬运功能。

任何需要从 GroupGuard 新增公网访问的功能，都必须先新增架构决策记录（ADR），说明为什么不能放入内网服务，并增加专门的超时、审计和回滚测试。没有 ADR 的公网业务请求不得合并。

## 6. 当前已确认的偏离

### P1：查合集仍由插件直接访问公网

`src/services/interaction_service.ts` 当前仍会：

- 读取 `shardDataUrl`；
- 读取 `shardHeroListUrl`；
- 在 SnowLuma 容器中调用 `fetch()`；
- 解析英雄与合集数据；
- 在插件内进行英雄匹配、排序和文本分页。

该实现已经在生产中出现 `合集数据加载失败：fetch failed`。应在服务端具备持久化快照和最终交付载荷后删除。

### P1：内置封号查询仍保留多公网 Provider 配置能力

生产当前已使用内网服务，但插件仍保留直接配置主/备用封号接口的旧能力。迁移完成后，内置 `查封号` 只能调用内网服务；公网 Provider 配置应从 GroupGuard 移除或标记为不再用于内置查询。

### P2：其他外部查询需要后续清点

以下能力可能仍直接访问外部地址，需要单独形成清单：

- 视频/“我要看”接口；
- 骗子第三方查询与举报；
- 动态命令 HTTP Provider；
- 其他未来扩展查询。

它们不必与本轮 LOL 查询同时迁移，但必须遵守同一原则：重要业务处理放在内网服务，插件只负责传输。

## 7. 发布门禁

涉及内置查询的 PR 必须满足：

1. 查询实现中没有新增公网业务域名常量。
2. 内置 LOL 查询不能读取 `shardDataUrl`、`shardHeroListUrl` 或第三方封号 Provider。
3. 管理测试器与真实群命令复用同一内网客户端。
4. 内网服务失败时，插件只显示服务提供的错误/降级结果，不直连公网兜底。
5. `npm test`、`npm run verify:query-contracts` 和 `npm run build:snowluma` 通过。
6. 跨仓契约测试覆盖成功、缓存、陈旧快照、不可用和错误协议。
7. 生产部署必须先升级 `lolapisevers`，验证兼容后再升级 GroupGuard。

## 8. 例外审批

例外必须同时具备：

- 独立 ADR；
- 明确所有者；
- 有限超时；
- 不包含生产秘密；
- 不影响内置查询主链；
- 自动测试和生产回滚方案。

没有满足以上条件的例外视为架构违规。
