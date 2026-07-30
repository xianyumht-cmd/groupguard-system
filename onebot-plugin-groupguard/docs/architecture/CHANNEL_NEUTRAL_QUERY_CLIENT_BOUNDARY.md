# 查询客户端跨渠道边界（强制规则）

> 状态：规范性文档（normative）  
> 计划：`GGK-ALL-QUERY-HUB-20260729`  
> 当前适配层：SnowLuma / GroupGuard  
> 后续适配层：官方机器人

## 1. GroupGuard 的定位

GroupGuard 是 QQ/SnowLuma 平台适配层，不是查询业务服务。它只负责：

- 命令匹配；
- 最小原始参数提取；
- 群开关、许可、权限和限流；
- 生成 request_id；
- 调用 Windows 内网接口；
- 严格校验最终交付协议；
- 把通用文本、图片或转发节点转换为 OneBot 动作；
- 记录平台传输结果。

## 2. 禁止事项

所有内置业务查询中禁止：

- 插件端访问公网业务 Provider；
- 插件配置保存 Provider URL、Token、Cookie 或 Key；
- 插件解析业务 JSON/HTML；
- 插件维护英雄别名、封号状态判断、战绩分页、视频直链解析、风险合并等业务规则；
- 插件决定图片失败后的文本或转发降级；
- 插件在内网接口失败时直连公网；
- 插件本地数据库继续作为跨客户端共享业务的唯一事实源。

## 3. 正式 feature

```text
shard
aram
lolban
battle
hidden
video
scammer
peer
scammer_report
peer_report
```

当前：

- `shard` 已部署并真人验收；
- `aram`、`lolban` 正在迁移到相同最终交付协议；
- 其他 feature 按 `docs/plans/ALL_QUERY_INTRANET_CLIENT_20260729.md` 推进。

## 4. 官方机器人复用要求

未来官方机器人必须和 GroupGuard 使用相同的：

- feature 名；
- parameters 结构；
- capabilities；
- request_id；
- 最终交付响应 fixture；
- 错误语义。

官方机器人只增加官方平台的鉴权、限流和发送适配，不能复制查询业务、Provider 调用、文案或绘图。

## 5. 配置迁移

最终 GroupGuard 查询配置只保留：

- `lolApiBaseUrl` 或后续统一 `queryApiBaseUrl`；
- 请求超时；
- 平台支持的文本、图片、转发能力；
- 群功能开关和限流。

以下配置必须迁移到 Windows 服务并从插件业务路径移除：

- LOL Token/Key 与自定义战绩 Provider；
- 封号主/备用 Provider；
- 视频 Provider 模板；
- 骗子查询/举报 Provider；
- 其他动态外部业务查询 Provider。

## 6. 迁移期规则

旧实现可以短期保留为不可达代码，方便审查与回滚比较，但：

- 不得出现在正式命令注册列表；
- 不得作为内网失败后的备用链路；
- 不得由管理测试器调用；
- 每个 feature 真人验收后应安排删除。

## 7. 发布门禁

每个迁移 PR 必须证明：

1. 正式命令优先级高于旧互动插件；
2. 旧互动触发器已移除；
3. 一次命令只有一次内网请求；
4. 网络/协议失败没有第二次或公网请求；
5. 运行路径无公网业务域名和 Provider 凭据；
6. `npm test` 与 `npm run build:snowluma` 通过；
7. 接口端先部署并验收；
8. SnowLuma 部署后进行真人群命令验收。
