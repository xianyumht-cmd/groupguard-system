# GroupGuard 内网查询迁移执行计划（2026-07-28）

> 计划 ID：`GGK-INTRANET-QUERY-20260728`  
> 生产基线：`codex/production-integration-audit-20260726`  
> 目标：GroupGuard 仅负责命令入口、内网请求和 OneBot 传输；业务处理与最终交付载荷由 `lolapisevers` 完成。

## 1. 审查结论

当前生产分支并非完全违反目标架构：

- `查战绩` 已调用内网 `cross_query`；
- `海符榜` 已调用内网 `aram_augments`；
- 生产 `查封号` 已配置为调用内网服务；
- 但插件仍解析这些接口的业务数据并决定文本/图片降级；
- `查合集` 仍在 SnowLuma 容器内直接下载两个公网 JSON、匹配英雄、排序并生成分页；
- 插件仍保留内置封号查询直连公网 Provider 的旧配置能力。

本轮故障的直接原因是 `查合集` 插件端公网请求在 SnowLuma 容器中超时。Windows 内网接口同一时刻可用，因此必须消除插件端公网依赖。

## 2. 执行顺序

服务端必须先完成并部署兼容能力，再迁移插件。禁止先删除插件旧逻辑后等待服务端补齐。

### GG-DOC-001：建立强制架构规则

状态：`completed`

交付：

- `docs/architecture/INTRANET_QUERY_BOUNDARY.md`
- 本执行计划
- 同名机器可读 JSON 状态文件

完成标准：

- 明确允许/禁止职责；
- 明确服务端生成最终交付载荷、插件只执行 OneBot 发送；
- 明确发布顺序与回滚边界。

### GG-CLIENT-001：建立统一内网查询客户端

状态：`planned`

依赖：服务端 `LAPI-DELIVERY-001`

改动建议：

- 新建独立 `intranet_query_client.ts`；
- 所有内置 LOL 查询通过一个客户端调用；
- 请求带稳定 `request_id`、命令、参数和期望交付类型；
- 严格校验 `groupguard-query-delivery.v1`；
- 统一超时、错误类别和日志脱敏；
- 管理测试器复用同一客户端。

完成标准：

- 正式命令与管理测试器使用同一代码；
- 协议错误不会被显示为成功；
- 插件不解析业务字段。

### GG-SHARD-001：迁移“查合集”

状态：`blocked`

依赖：

- `LAPI-SNAPSHOT-001`
- `LAPI-SHARD-001`
- `LAPI-DELIVERY-001`

改动建议：

- 删除 `resolveShardDataUrls()`、`loadShardData()`、英雄匹配、排序和分页业务；
- `查合集` 只传入用户原始英雄名；
- 服务返回最终图片或最终文本；
- 插件按 `delivery.kind` 发送。

兼容要求：

- 保留原指令格式；
- 保留原功能开关和限流；
- 旧配置不立即删除，先只读迁移并给出废弃提示；
- 服务不可用时不得直连 GitHub Raw 兜底。

### GG-LOL-UNIFY-001：统一战绩、海符榜和封号

状态：`planned`

依赖：服务端交付协议完整覆盖四类查询。

改动建议：

- `查战绩`、`海符榜`、`查封号` 改为只消费最终交付载荷；
- 删除插件端业务分页、状态解释和公网备用 Provider；
- 保留插件端权限、限流和发送队列；
- 明确 `source=stale/snapshot` 的用户提示由服务生成。

### GG-CONFIG-001：收敛配置和 WebUI

状态：`planned`

改动建议：

- 内置 LOL 查询只保留一个内网 API Base；
- 删除或只读废弃 `shardDataUrl`、`shardHeroListUrl`、内置封号公网 Provider；
- 管理页面显示当前契约版本、服务 build commit、就绪状态和最近错误；
- 旧配置迁移必须可回滚，不得静默覆盖。

### GG-GATE-001：增加架构门禁

状态：`planned`

建议增加：

- `verify:intranet-query-boundary`；
- 扫描内置查询模块中的公网域名和直接第三方数据源调用；
- 检查管理测试器与正式适配器复用；
- 契约 fixture 覆盖 `live/cache/stale/snapshot/unavailable`；
- 将门禁加入 `npm test` 和 SnowLuma build。

### GG-DEPLOY-001：生产部署与验收

状态：`blocked`

部署顺序：

1. 备份 SnowLuma 配置、数据和当前 dist；
2. 先验证已部署的新 `lolapisevers` 兼容旧插件；
3. 构建 GroupGuard；
4. 使用现有可回滚部署脚本发布；
5. 验证 OneBot 连接和 `/api/readyz`；
6. 由真人群成员执行四类查询；
7. 模拟服务上游断网，确认仍可收到受控陈旧结果；
8. 确认 SnowLuma 容器不再访问 GitHub Raw、腾讯英雄列表或 OP.GG。

## 3. 跨仓总顺序

```text
文档与规则
  -> lolapisevers 持久化快照基础设施
  -> lolapisevers 合集/英雄数据降级
  -> lolapisevers ARAM/封号持久化 LKG
  -> lolapisevers 最终交付协议
  -> GroupGuard 统一内网客户端
  -> 迁移查合集
  -> 统一其余 LOL 查询
  -> 双仓契约测试
  -> 先部署服务端
  -> 再部署插件端
  -> 真人群验收
```

## 4. 验收用例

至少覆盖：

1. `查合集 滑板鞋` 冷缓存成功。
2. 上游 GitHub Raw 不可达时，服务返回磁盘快照。
3. SnowLuma 容器无公网时，四类 LOL 查询仍可通过内网服务工作。
4. 服务完全不可用时，插件快速返回明确错误，不等待多个公网超时。
5. 服务返回未知协议时，插件拒绝发送错误内容。
6. 相同请求并发时服务合并上游刷新，插件每个群请求只产生一个最终回复。
7. 重启服务后，合集、英雄表和允许的 LKG 仍存在。
8. 图片失败时，文本降级由服务决定并已格式化。

## 5. 回滚边界

- 服务端新增能力必须向后兼容旧插件。
- 插件迁移后的首个版本应保留可切换回旧内网端点契约的开关，但不得恢复公网直连。
- 回滚只能恢复已校验的一整套 dist + config，不得跨版本只恢复单个文件。
- 不合并或部署任何包含运行时秘密、状态文件或本机备份的提交。

## 6. 下一步

下一步不是修改插件，而是先在 `lolapisevers` 完成：

```text
LAPI-SNAPSHOT-001：持久化快照基础设施
```

该步骤完成并通过单元测试后，才能执行 `LAPI-SHARD-001`，随后再返回本仓实施 `GG-CLIENT-001` 与 `GG-SHARD-001`。
