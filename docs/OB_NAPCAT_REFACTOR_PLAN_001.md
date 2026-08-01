# OB-NAPCAT-DECOUPLING-001：机器可执行重构计划

更新时间：2026-08-02 03:40 +08:00  
执行分支：`refactor/remove-napcat-onebot-runtime-20260802`  
生产冻结：`d0b79b6eab2514492196036bd79f14819b2d4102`

## 1. 目标结构

```text
GroupGuard 业务核心
  -> GroupGuardRuntime
  -> OneBot 11 事件与通用动作层
  -> HostProfile
       -> SnowLumaProfile
       -> GenericOneBotProfile
  -> WebSocket transport
```

业务层只依赖 GroupGuard 自有契约。宿主扩展动作必须由 Profile 声明、调用和规范化。

## 2. 固定执行规则

1. 每个阶段单独提交，禁止混入无关功能。
2. 生产在完整回归前保持运行现有版本。
3. 不运行 `GFM-DELETE-003`。
4. 不使用 NapCat 文档、参数或返回结构证明 SnowLuma 行为。
5. 未识别的宿主响应返回 `unsupported` 或 `indeterminate`，不得返回成功。
6. 配置、SQLite、群文件镜像状态和备份必须原样保留。
7. 草稿 PR 在全部门槛通过前不得转为可合并状态。

## 3. 阶段与变更集

### A. OB-AUDIT-001：全仓只读审查

状态：完成。

交付：

```text
docs/OB_NAPCAT_DEPENDENCY_AUDIT_001.md
docs/OB_NAPCAT_DEPENDENCY_AUDIT_001.json
docs/OB_NAPCAT_REFACTOR_PLAN_001.md
```

验收：依赖分类、调用位置、扩展动作、风险矩阵和门禁均已记录。

### B. OB-RUNTIME-001：GroupGuard 自有运行时契约

新增建议：

```text
src/runtime/runtime_context.ts
src/runtime/groupguard_runtime.ts
src/runtime/lifecycle.ts
src/protocol/onebot11/types.ts
src/protocol/onebot11/action_client.ts
src/protocol/onebot11/event_normalizer.ts
```

契约：

```text
RuntimeLogger
RuntimePaths
RuntimeRouter
OneBotActionClient.call(action, params)
GroupGuardRuntimeContext
GroupGuardLifecycle
```

实施要求：

- 路径由 `RuntimePaths` 提供；
- logger、actions、router、hostProfile 显式注入；
- 初始化和清理幂等；
- 初始化失败必须复位；
- 业务代码不再读取宿主插件上下文。

阶段测试：

```text
runtime context typecheck
initialize twice
shutdown twice
initialization failure then retry
pending event gate
```

### C. OB-CORE-001：抽离业务生命周期

把 `src/index.ts` 中以下逻辑迁入 `GroupGuardRuntime`：

```text
路径解析
配置加载与损坏备份
SQLite 初始化与迁移
授权初始化
动态命令验证
群文件/邀请/自撤回服务启动
后台保存和缓存清理定时器
路由注册
机器人身份刷新
消息与事件分发
完整清理
```

公开接口：

```text
initializeGroupGuard(runtime)
handleGroupGuardMessage(event)
handleGroupGuardEvent(event)
shutdownGroupGuard()
```

阶段门禁：SnowLuma 启动顺序、事件缓冲、身份刷新和清理测试通过。

### D. OB-PROTOCOL-001：OneBot 动作和事件边界

动作：

- 全仓统一 `call(action, params)`；
- 移除 `adapterName`、`networkConfig` 和四参数调用；
- 保留现有发送包装、风险包装、Q群管家路由和队列语义；
- 通用参数规范化只能处理项目确认的别名，不介入宿主扩展语义。

事件：

- 建立项目自有 OneBot 事件包；
- 支持 `message`、`message_sent`、`notice`、`request`、`meta_event`；
- 规范化标准字段，同时保留原始事件；
- 未知事件允许通过边界但不得触发错误动作。

阶段门禁：

```text
静态扫描无四参数动作
消息/私聊/message_sent fixture
notice/request/meta fixture
send wrapper regression
queue and self-recall regression
```

### E. OB-HOST-PROFILE-001：宿主能力 Profile

新增：

```text
src/hosts/host_profile.ts
src/hosts/snowluma_profile.ts
src/hosts/generic_onebot_profile.ts
```

统一能力结果：

```text
supported
unsupported
success
failed
indeterminate
rawResponse
reason
```

Profile 至少描述：

```text
self message events
message history
group file URL
group file upload
group file root/folder list
group file delete
folder and pagination
response normalization
```

`GenericOneBotProfile`：

- 只默认提供 OneBot 11 通用能力；
- 扩展能力未配置时明确 `unsupported`；
- 允许未来注入经验证的扩展适配器。

`SnowLumaProfile`：

- 只实现已有仓库证据或真实捕获证明的行为；
- 原始动作响应必须保留；
- 列表和删除结构未知时返回 `indeterminate`；
- 不使用 NapCat 参数作为 SnowLuma 合同。

阶段门禁：两个 Profile 契约测试全部通过。

### F. OB-SNOWLUMA-001：直接接入 SnowLuma

重写 `src/standalone/snowluma_service.ts`：

```text
OneBotWsClient
  -> OneBotActionClient
  -> SnowLumaProfile
  -> GroupGuardRuntimeContext
  -> GroupGuardRuntime
```

删除 `createStandaloneContext()` 调用，不再伪造：

```text
NapCatPluginContext
NapCatConfig
pluginManager.config
router shim
```

规范环境变量：

```text
ONEBOT_WS_URL
ONEBOT_ACCESS_TOKEN
ONEBOT_ACTION_TIMEOUT_MS
ONEBOT_RECONNECT_DELAY_MS
ONEBOT_HOST_PROFILE=snowluma
```

`SNOWLUMA_*` 仅可在启动器中作为有期限迁移别名，不能进入核心业务。

阶段门禁：连接、断线、自动重连、身份刷新、事件缓冲、WebUI 健康和关闭流程通过。

### G. OB-NAPCAT-REMOVE-001：删除 NapCat

删除：

```text
napcat-types
src/shims/napcat-types/**
NapCatPluginContext
PluginModule
NapCatConfig
pluginManager.config
createNapCatConfigShim
createRouterShim
adapterName/networkConfig 兼容状态
build:napcat
NapCat 专用包元数据与构建入口
```

更新：

```text
package.json
package-lock.json
tsconfig.json
vite.config.ts
build-all-clean.mjs
release workflows
README and active docs
```

历史文档允许保留事实记录，但必须明确标记为旧架构，不得被当前构建引用。

静态门禁：活动源码、依赖和构建脚本中无 NapCat 运行时绑定。

### H. OB-REGRESSION-001：完整回归

必须执行：

```text
npm test
npm run build:onebot
npm run build:snowluma
static no-NapCat gate
runtime lifecycle contracts
SnowLumaProfile contracts
GenericOneBotProfile contracts
```

功能矩阵：

```text
OneBot WS 连接/重连/身份
普通群消息/私聊/message_sent
notice/request/meta
问答、主动回复、所有查询和图片发送
动态命令
违禁词、刷屏、名片、头衔、禁言、踢人、撤回
发送队列、自身消息撤回、风险包装
配置加载/保存/损坏保护
SQLite 与迁移
WebUI 6108 页面与 API
授权和 Q群管家边界
群文件 URL/上传/列表/目录/分页/删除/历史/重试/重启恢复
```

群文件误报专项必须覆盖：

1. 未知列表结构不能生成 `absent`；
2. 未知删除响应不能生成 `success`；
3. 删除动作返回成功但文件仍在时必须失败；
4. 无法确认时 `pendingCleanup` 保留；
5. 分页未完整读取时不能确认不存在；
6. 文件夹未完整遍历时不能确认不存在；
7. 原始请求和响应可被审计记录。

### I. OB-PRODUCTION-001：合并与安全部署

只有全部回归通过后才能：

1. 将草稿 PR 转为可审查；
2. 核对 `main` 无新冲突；
3. 合并；
4. 生成来源可验证的不可变候选；
5. 生产切换前确认旧版：

```text
ready=true
OneBot connected=true
bot identity known=true
```

6. 候选离线验证；
7. 完整备份配置、数据、状态和当前程序；
8. 原子切换；
9. 校验健康、OneBot、身份、WebUI 和来源；
10. 任一步失败自动回滚；
11. 回滚后旧版重新 `ready=true` 才算回滚成功。

## 4. 提交顺序

```text
1 docs: audit and plan
2 refactor: add runtime and OneBot contracts
3 refactor: extract GroupGuard lifecycle
4 refactor: normalize OneBot actions and events
5 refactor: add SnowLuma and Generic profiles
6 refactor: connect SnowLuma directly
7 refactor: remove NapCat dependencies and builds
8 test: add complete protocol/profile/regression gates
9 docs: record final regression and production readiness
```

每个提交必须独立通过类型检查或其对应的迁移门禁。最终提交前不得生成正式生产部署包。
