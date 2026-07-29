# GroupGuard 内网查询迁移执行计划（2026-07-28）

> 计划 ID：`GGK-INTRANET-QUERY-20260728`  
> 生产基线：`codex/production-integration-audit-20260726`  
> 目标：GroupGuard 仅负责命令入口、内网请求和 OneBot 传输；业务处理与最终交付载荷由 `lolapisevers` 完成。

## 0. 2026-07-29 实施状态

当前已在分支 `feat/groupguard-shard-intranet-migration-20260729` 完成“查合集”运行代码迁移，等待 GroupGuard CI、SnowLuma 构建和接口端生产版本确认。

已实现：

- 新增原生查询插件 `builtin.query.shard.intranet`，优先级高于旧互动模块；
- 用户输入的原始英雄名直接提交给内网 `POST /api/v1/groupguard/query`；
- 严格消费 `groupguard-query-delivery.v1`，发送服务端生成的文字、Base64 图片或合并转发节点；
- 一次命令只执行一次内网请求；网络失败、503 或协议错误均不尝试公网备用地址；
- 旧互动模块不再注册“查合集”触发器，因此旧公网 JSON 下载、本地英雄匹配、排序和分页代码不能再被真实命令执行；
- WebUI 查询测试器复用同一条内网请求实现，不再直接测试合集 JSON 或腾讯英雄表；
- 新增 `verify:intranet-shard-command` 并接入 `npm test` 与 SnowLuma 构建门禁。

当前硬阻塞：

- `lolapisevers` PR #17 仍记录生产版本为 `bd2d92996f8c7af4e6fd51f021f1546bda250a8a`；
- 兼容交付协议和“滑板鞋”别名的目标版本为 `8de85a855b8338c3a9a69cbb2a937cd0a6ef8b82`；
- 在生产 `/build-info` 和 `/api/v1/groupguard/query` 确认目标版本前，禁止部署本 GroupGuard 分支。

旧 `interaction_service.ts` 中仍保留不可达的合集旧代码，作为迁移观察期的代码残留。它不得重新注册为故障兜底；新路径通过 CI 和真人验收后再删除。

## 1. 审查结论

当前生产分支并非完全违反目标架构：

- `查战绩` 已调用内网 `cross_query`；
- `海符榜` 已调用内网 `aram_augments`；
- 生产 `查封号` 已配置为调用内网服务；
- 但插件仍解析这些接口的业务数据并决定文本/图片降级；
- 迁移前的 `查合集` 在 SnowLuma 容器内直接下载两个公网 JSON、匹配英雄、排序并生成分页；
- 插件仍保留内置封号查询直连公网 Provider 的旧配置能力。

本轮故障的直接原因是迁移前的 `查合集` 插件端公网请求和本地英雄匹配链路。Windows 内网接口同一时刻可用，因此必须消除插件端公网依赖。

## 2. 执行顺序

服务端必须先完成并部署兼容能力，再迁移插件生产环境。禁止先删除线上插件旧逻辑后等待服务端补齐。

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

### GG-CONTRACT-001：建立严格协议消费者

状态：`completed`

交付：

- `src/services/groupguard_query_delivery_client.ts`
- 跨仓固定夹具与 SHA-256 门禁
- `verify:groupguard-delivery-contract`

已证明：

- 只允许内网地址；
- 图片 Base64、字节数与 SHA-256 必须一致；
- 503 和 `fetch failed` 只请求一次；
- 不进行公网兜底。

### GG-CLIENT-001：建立统一内网查询客户端

状态：`implemented_pending_ci`（当前先覆盖“查合集”真实命令和管理测试器）

依赖：服务端 `LAPI-DELIVERY-001` 与生产 `LAPI-DEPLOY-001`

当前实现：

- `src/services/intranet_shard_query_service.ts` 统一构造合集交付请求；
- `src/dynamic-commands/intranet_query_runtime_plugin.ts` 复用该服务；
- `src/standalone/admin/query_api.ts` 的合集测试器复用同一服务；
- 请求带稳定 `request_id`、原始英雄名和期望交付类型；
- 严格校验 `groupguard-query-delivery.v1`；
- 统一超时、错误脱敏和无公网回退。

完成标准：

- 正式命令与管理测试器使用同一请求实现；
- 协议错误不会被显示为成功；
- 插件不解析业务字段；
- CI 与 SnowLuma 构建全部通过；
- 生产接口端版本得到确认。

### GG-SHARD-001：迁移“查合集”

状态：`implemented_pending_ci`

依赖：

- `LAPI-SNAPSHOT-001`
- `LAPI-SHARD-001`
- `LAPI-DELIVERY-001`
- `LAPI-DEPLOY-001`

当前实现：

- 新插件直接接收 `查合集`，不经过旧互动模块；
- 只传入用户原始英雄名；
- 服务返回最终图片、文字或合并转发；
- 插件按已验证的 delivery plan 发送；
- 保留原指令格式、功能开关、授权门禁和统一查询限流；
- 服务不可用时快速返回固定错误，不直连 GitHub Raw、腾讯英雄表或其他公网数据源；
- 旧配置暂不静默删除，WebUI 将其标记为废弃。

待完成：

- GroupGuard CI 与 Build；
- 接口端目标版本生产确认；
- SnowLuma 可回滚部署；
- 真人群成员执行 `查合集 滑板鞋`、中文名、英文 alias 和不存在英雄测试；
- 观察期通过后删除 `interaction_service.ts` 中不可达的旧合集代码。

### GG-LOL-UNIFY-001：统一战绩、海符榜和封号

状态：`blocked`

依赖：服务端交付协议完整覆盖对应查询，并先完成本次合集迁移验收。

改动建议：

- `查战绩`、`海符榜`、`查封号` 改为只消费最终交付载荷；
- 删除插件端业务分页、状态解释和公网备用 Provider；
- 保留插件端权限、限流和发送队列；
- 明确 `source=stale/snapshot` 的用户提示由服务生成。

### GG-CONFIG-001：收敛配置和 WebUI

状态：`partially_implemented_pending_ci`

当前已完成：

- “查合集”数据源显示为内网 `LOL API Base`；
- 管理测试器不再直接访问 `shardDataUrl` 或 `shardHeroListUrl`；
- 旧合集公网配置显示为废弃，不再作为运行时依赖。

后续：

- 内置 LOL 查询最终只保留一个内网 API Base；
- 删除或只读废弃内置封号公网 Provider；
- 管理页面显示当前契约版本、服务 build commit、就绪状态和最近错误；
- 旧配置迁移必须可回滚，不得静默覆盖。

### GG-GATE-001：增加架构门禁

状态：`partially_implemented_pending_ci`

已新增：

- `verify:intranet-shard-command`；
- 验证原始 `滑板鞋` 参数原样传给服务；
- 验证文字、Base64 图片和合并转发转换；
- 验证网络失败只请求一次并返回固定提示；
- 验证新运行模块不包含公网数据源字面量；
- 验证旧互动模块不再注册“查合集”；
- 门禁接入 `npm test`、release/debug/SnowLuma build。

后续在 `GG-LOL-UNIFY-001` 完成后扩展为全仓 LOL 公网访问禁令。

### GG-DEPLOY-001：生产部署与验收

状态：`blocked`

部署前置条件：

1. GroupGuard CI 与 Build 全绿；
2. `lolapisevers /build-info` 报告兼容目标提交；
3. `POST /api/v1/groupguard/query` 在生产 5001 可用；
4. 生产快照已预热并完成断网测试；
5. 已备份 SnowLuma 配置、数据和当前 dist。

部署顺序：

1. 验证已部署的新 `lolapisevers` 兼容旧插件；
2. 构建 GroupGuard SnowLuma 产物；
3. 使用现有可回滚部署脚本发布；
4. 验证 OneBot 连接和 `/api/readyz`；
5. 由真人群成员执行“查合集”验收；
6. 模拟服务上游断网，确认仍可收到受控快照结果；
7. 确认 SnowLuma 容器不再因“查合集”访问 GitHub Raw 或腾讯英雄列表。

## 3. 跨仓总顺序

```text
文档与规则
  -> lolapisevers 持久化快照基础设施
  -> lolapisevers 合集/英雄数据降级
  -> lolapisevers ARAM/封号持久化 LKG
  -> lolapisevers 最终交付协议
  -> GroupGuard 严格协议消费者
  -> GroupGuard 查合集真实命令与管理测试器迁移（代码已实现，待 CI）
  -> lolapisevers 生产目标版本确认
  -> GroupGuard SnowLuma 部署
  -> 真人群验收
  -> 统一其余 LOL 查询
```

## 4. 验收用例

至少覆盖：

1. `查合集 滑板鞋` 冷缓存成功。
2. 上游 GitHub Raw 不可达时，服务返回磁盘快照。
3. SnowLuma 容器无公网时，“查合集”仍通过内网服务工作。
4. 服务完全不可用时，插件快速返回明确错误，不等待多个公网超时。
5. 服务返回未知协议时，插件拒绝发送错误内容。
6. 相同请求并发时服务合并上游刷新，插件每个群请求只产生一个最终回复。
7. 重启服务后，合集、英雄表和允许的 LKG 仍存在。
8. 图片失败时，文本降级由服务决定并已格式化。
9. `查合集 亚索`、`查合集 Yasuo`、常见称号和不存在英雄均符合服务端结果。
10. WebUI 测试器与真实命令产生相同的交付协议请求。

## 5. 回滚边界

- 服务端新增能力必须向后兼容旧插件。
- 插件迁移后的版本可以回滚到上一份完整 dist，但不得恢复“新代码中公网兜底”的设计。
- 回滚只能恢复已校验的一整套 dist + config，不得跨版本只恢复单个文件。
- 不合并或部署任何包含运行时秘密、状态文件或本机备份的提交。
- 接口端版本不满足契约时，本插件分支必须保持未部署状态。

## 6. 下一步

下一步执行：

```text
GG-SHARD-CI-001
```

创建以 `feat/groupguard-contract-consumer-20260729` 为基线的堆叠草稿 PR，运行完整 GroupGuard CI 和 Build。所有检查通过后，再核对 `lolapisevers` 生产 `/build-info`；生产仍为旧提交时，不得部署插件。
