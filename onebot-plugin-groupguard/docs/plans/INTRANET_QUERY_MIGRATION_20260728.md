# GroupGuard 内网查询迁移执行计划（2026-07-28）

> 计划 ID：`GGK-INTRANET-QUERY-20260728`  
> 目标：GroupGuard 仅负责命令入口、权限与限流、内网请求、协议校验和 OneBot 下发；公网抓取、业务处理、绘图、缓存、持久化与降级由 `lolapisevers` 负责。

## 0. 当前状态（2026-07-29）

“查合集”插件端迁移代码和自动验证已经完成，生产部署仍被接口端版本阻塞。

实现分支：

```text
feat/groupguard-shard-intranet-migration-20260729
```

草稿 PR：

```text
GroupGuard PR #16
```

已验证提交：

```text
97372f1cac6236b1adaab0dfc5406bff1d001538
```

自动验证：

- GroupGuard CI run `30444675739`：成功；
- GroupGuard Build run `30444675748`：成功；
- 完整 `npm test`：成功；
- 部署 PowerShell 语法：成功；
- SnowLuma 构建：成功；
- 跨仓本地契约模拟：成功。

首次 Build run `30444549792` 曾失败，原因是测试错误地把 `feature=aram` 的合并转发夹具用于合集请求。正式请求组件按设计抛出 `delivery_feature_mismatch`。测试改为相同转发结构的 `feature=shard` 变体后全部通过；运行代码无需放宽功能隔离。

## 1. 已完成的“查合集”迁移

### 1.1 真实命令入口

新增原生命令插件：

```text
builtin.query.shard.intranet
```

关键规则：

- 触发词仍为 `查合集`；
- 优先级为 90，高于旧互动模块；
- 保留 `query.lol_shard` 功能开关、群范围、商业授权和统一查询限流；
- 用户输入的原始英雄名直接提交给内网服务；
- 插件不再匹配英雄、不再排序、不再分页、不再生成业务文案。

### 1.2 内网请求

统一请求入口：

```http
POST /api/v1/groupguard/query
```

请求内容：

- `feature=shard`；
- `parameters.hero=<用户原始输入>`；
- `preferred=auto|image|text|forward`；
- 客户端能力 `text/image/forward=true`；
- 稳定 `request_id`。

一次命令只允许一次内网请求。网络失败、超时、HTTP 503 或协议异常均不得触发第二个公网请求。

### 1.3 最终消息下发

插件严格校验 `groupguard-query-delivery.v1` 后，只执行服务端决定的最终载荷：

- 文字段；
- Base64 图片段，并复验字节数和 SHA-256；
- 合并转发节点；
- 服务端生成的错误提示和重试语义。

插件不读取合集 rows、来源 URL、英雄业务字段或第三方响应结构。

### 1.4 旧命令隔离

旧互动模块的触发器列表已经移除 `查合集`，因此 `interaction_service.ts` 中原有的：

- GitHub Raw 合集 JSON 下载；
- 腾讯英雄表下载；
- 本地英雄匹配；
- 排序、分页和图片/文字降级；

均无法再由真实命令调度器触发。

旧代码目前作为不可达的迁移观察期残留保留。它不得重新注册为服务故障兜底；新链路完成生产验收后再删除。

### 1.5 WebUI 管理测试器

`lol_shard` 测试器已经复用与真实命令相同的 `requestShardDelivery()`：

- 数据源显示为 `local-api`；
- 使用最终交付协议 POST；
- 不直接访问 `shardDataUrl` 或 `shardHeroListUrl`；
- 不回显完整内网主机地址；
- 不回显大段 Base64；
- 旧合集公网配置仅显示废弃提示。

## 2. 发布门禁

新增：

```text
npm run verify:intranet-shard-command
```

门禁验证：

1. 新插件优先级高于旧互动模块；
2. 旧互动模块不再注册 `查合集`；
3. `滑板鞋` 原样传给服务端；
4. 一次命令只执行一次内网请求；
5. 文字、Base64 图片和合并转发正确转换；
6. 功能不匹配的 envelope 被拒绝；
7. `fetch failed` 不触发第二次或公网请求；
8. 新运行模块不包含 GitHub Raw、腾讯英雄表、OP.GG 等公网数据源字面量；
9. 正式命令注册存在。

该门禁已接入：

- `npm test`；
- `build:release`；
- `build:debug`；
- `build:snowluma`。

## 3. 当前生产阻塞

GroupGuard 代码已经通过 CI，但不能部署。

`lolapisevers` PR #17 当前仓库记录的生产提交仍是：

```text
bd2d92996f8c7af4e6fd51f021f1546bda250a8a
```

包含最终交付协议、快照强化和“滑板鞋”别名的目标提交是：

```text
8de85a855b8338c3a9a69cbb2a937cd0a6ef8b82
```

生产部署 GroupGuard 前必须取得以下证据：

1. `lolapisevers` 部署记录 `status=completed`；
2. 验证报告 `status=pass`；
3. `/build-info` 报告目标提交；
4. `POST /api/v1/groupguard/query` 在生产 5001 可用；
5. 合集与英雄快照已预热；
6. 服务端断开公网上游时仍能返回允许的快照结果。

在这些条件满足前，PR #16 保持 Draft，不合并、不部署。

## 4. 分步状态

### GG-DOC-001

状态：`completed`

架构边界、人工计划和机器计划已经建立。

### GG-CONTRACT-001

状态：`completed`

严格协议消费者、固定夹具、图片完整性和无公网兜底门禁已经完成，见 GroupGuard PR #15。

### GG-CLIENT-001

状态：`code_and_ci_completed_for_shard_scope`

真实“查合集”和 WebUI 测试器共用统一请求实现。其余 LOL 查询的迁移仍属于后续步骤。

### GG-SHARD-001

状态：`code_and_ci_completed_pending_production_dependency`

命令路由、内网请求、最终载荷下发和专项门禁均已完成。等待 `LAPI-DEPLOY-001`。

### GG-CONFIG-001

状态：`shard_scope_code_and_ci_completed`

合集运行路径只使用 `LOL API Base`。旧公网配置暂保留为废弃只读信息，待其余 LOL 查询统一时集中清理。

### GG-GATE-001

状态：`shard_scope_completed`

合集专项架构门禁已通过。全仓 LOL 公网访问禁令将在 `GG-LOL-UNIFY-001` 完成后扩展。

### GG-LOL-UNIFY-001

状态：`blocked`

后续迁移海符榜和查封号到最终交付 envelope；查战绩需先确认服务端 delivery feature 设计。不得在接口端生产版本未确认时扩大生产变更范围。

### GG-DEPLOY-001

状态：`blocked_by_lapi_deploy_001`

GroupGuard 构建已具备部署条件，但生产依赖尚未满足。

## 5. 生产部署顺序

接口端满足前置条件后，按以下顺序执行：

1. 记录接口端 `/build-info`、`/livez`、`/readyz` 和交付接口证据；
2. 备份 SnowLuma 当前配置、数据和 `dist`；
3. 从已验证提交构建 SnowLuma 产物；
4. 使用现有可回滚部署脚本发布；
5. 验证 OneBot 连接和 GroupGuard `/api/readyz`；
6. 真人群成员执行 `查合集 滑板鞋`；
7. 执行中文名、英文 alias、称号和不存在英雄测试；
8. 故障注入公网上游不可达，确认结果由 Windows 接口快照提供；
9. 确认 SnowLuma 容器没有因“查合集”访问 GitHub Raw 或腾讯英雄表；
10. 观察期通过后删除插件中不可达的旧合集实现。

## 6. 验收用例

至少覆盖：

- `查合集 滑板鞋` 冷缓存成功；
- `查合集 亚索` 与 `查合集 Yasuo` 结果一致；
- 服务端返回 Base64 图片时可正常发送；
- 图片构建失败时由服务端给出最终文字或转发降级；
- 服务完全不可用时插件快速返回固定提示；
- 服务返回未知协议或错误 feature 时插件拒绝载荷；
- 同一命令不会产生公网备用请求；
- WebUI 测试器与真实命令使用同一交付请求；
- 服务重启和公网上游断开后仍可使用有效快照。

## 7. 回滚边界

- 回滚 GroupGuard 时恢复一整套已校验的 `dist + config`；
- 不允许跨版本只替换单个 JS 文件；
- 不允许把公网抓取重新加入新内网插件；
- 运行时秘密、状态、快照和本机备份禁止提交；
- 接口端契约不满足时，GroupGuard 新版本保持未部署状态。

## 8. 下一步

当前下一步骤恢复为接口仓：

```text
LAPI-DEPLOY-001
```

执行准备好的 v6 安全部署，取得完整部署记录和验证报告，确认生产 `/build-info` 为 `8de85a855b8338c3a9a69cbb2a937cd0a6ef8b82`。完成后再返回 GroupGuard 执行 `GG-DEPLOY-001`。
