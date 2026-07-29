# GroupGuard 查询下发协议消费门禁

## 目标

GroupGuard 只负责：

1. 接收群命令并做权限、开关和限流判断；
2. 向内网 `lolapisevers` 发送一个请求；
3. 严格校验 `groupguard-query-delivery.v1`；
4. 把接口端决定好的文字、图片或合并转发内容发送到群里。

插件不得解析合集、海符榜或封号业务字段，也不得在内网接口失败时绕过服务访问公网。

## 消费端

实现文件：

```text
src/services/groupguard_query_delivery_client.ts
```

它提供：

- `resolveGroupGuardQueryEndpoint()`：校验内网地址并固定到 `/api/v1/groupguard/query`；
- `requestGroupGuardQueryDelivery()`：仅发送一次 POST 请求，无备用 URL；
- `parseGroupGuardQueryDelivery()`：严格协议和字段校验；
- `toOneBotDeliveryPlan()`：转换为 OneBot 文字、Base64 图片或转发节点计划。

## 允许的接口地址

允许：

- `localhost` 和 loopback；
- RFC1918 IPv4；
- IPv4 链路本地地址；
- 私有或链路本地 IPv6；
- `.local` 主机名；
- Docker 或局域网使用的单标签主机名。

拒绝：

- 公网域名和公网 IP；
- URL 用户名或密码；
- 自带查询参数、fragment 或额外路径的 Base URL；
- 非 HTTP/HTTPS 协议。

生产示例：

```text
http://192.168.3.89:5001
```

最终请求固定为：

```text
POST http://192.168.3.89:5001/api/v1/groupguard/query
```

## 图片校验

图片段不会直接信任接口声明。插件会：

1. 严格检查 Base64 字符和补位；
2. 解码图片；
3. 检查实际字节数；
4. 重新计算 SHA-256；
5. 校验通过后转换为 `base64://...` OneBot 图片。

单张图片最大允许 8 MiB，整个 JSON 响应最大允许 16 MiB。

## 固定夹具

目录：

```text
contracts/fixtures/groupguard-query-contracts/
```

该目录必须与 `lolapisevers` 的同名目录保持一致。清单固定服务实现提交：

```text
7764dbec4854a7d39a194f6ec1802f0e8902ea9e
```

任何夹具字段、错误语义、图片内容或观测结构变化都会改变 canonical JSON SHA-256，并使 CI 失败。

## CI 门禁

命令：

```text
npm run verify:groupguard-delivery-contract
```

该命令已加入 `npm test`，验证：

- 文本、图片、转发和错误夹具；
- 未知协议和未知字段拒绝；
- 图片篡改拒绝；
- 公网接口地址拒绝；
- 503 和网络异常只请求一次内网地址；
- 新消费端不包含公网数据源字面量；
- 观测夹具不泄露 URL、Token、QQ 或英雄标识。

## 当前边界

本步骤只建立严格消费端和跨仓门禁，尚未把真实命令接入该客户端。以下旧代码仍存在：

- `查合集`插件端下载合集和英雄 JSON；
- 插件端英雄匹配、排序和文本分页；
- 海符榜和查封号的旧业务字段解析与下发逻辑；
- 未配置内网 API 时的封号公网迁移回退。

这些必须在后续 `GG-CLIENT-001`、`GG-SHARD-001`、`GG-LOL-UNIFY-001` 和 `GG-GATE-001` 中依次删除或收口。服务端必须先部署并完成旧插件兼容验收。
