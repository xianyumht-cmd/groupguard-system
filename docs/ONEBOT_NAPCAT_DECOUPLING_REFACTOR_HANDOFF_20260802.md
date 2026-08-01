# GroupGuard 完整剥离 NapCat 重构交接

更新时间：2026-08-02 03:04 +08:00  
任务 ID：`OB-NAPCAT-DECOUPLING-001`  
状态：`approved_for_audit_planning_and_execution`  
仓库：`xianyumht-cmd/groupguard-system`

## 1. 用户已确认的方向

用户已明确同意执行完整重构：

> 完整剥离 NapCat。当前不再需要 NapCat 运行模式；GroupGuard 核心面向 OneBot WebSocket，当前宿主为 SnowLuma，未来允许接入其他第三方 OneBot WebSocket 框架。

本任务不是只改文件名或移除一个依赖。目标是把运行时边界、动作调用、事件输入、宿主能力和构建测试改成真正独立于 NapCat 的结构。

## 2. 当前生产基线

当前生产已成功部署并通过健康与来源校验：

```text
Production commit: d0b79b6eab2514492196036bd79f14819b2d4102
Container: groupguard-snowluma
Remote app: /mnt/sda1/groupguard/app
OneBot WebSocket: ws://127.0.0.1:3001
Upstream container: snowluma
WebUI: 6108
Production backup: /mnt/sda1/groupguard/backups/project-wide-bugfix-d0b79b6e-20260801T133634Z
Deployment report: /mnt/sda1/groupguard/backups/project-wide-bugfix-d0b79b6e-20260801T133634Z/deployment-report.txt
```

生产状态在重构完成前必须保持不变。审查、规划和开发均在独立分支执行；不得直接修改生产目录、覆盖生产 `dist`、重启生产容器、合并 `main` 或部署未完成候选。

## 3. 当前架构事实

### 3.1 对外连接已经是 OneBot WebSocket

当前 SnowLuma 服务通过以下组件连接 OneBot WebSocket：

```text
src/standalone/snowluma_service.ts
src/standalone/onebot_ws_client.ts
src/standalone/onebot_action_caller.ts
```

对外通信形式是：

```text
GroupGuard
  -> OneBot WebSocket action/params/echo
  -> SnowLuma
  -> QQ 客户端
```

当前不是通过 SnowLuma SDK 或 SnowLuma 内部插件 API 调用。

### 3.2 内部仍保留 NapCat 运行时

以下结构仍然绑定 NapCat：

```text
src/index.ts
  - PluginModule
  - NapCatPluginContext
  - OB11Message from napcat-types
  - NapCatConfig
  - pluginManager.config

src/standalone/standalone_context.ts
  - createNapCatConfigShim
  - createRouterShim
  - fake pluginManager.config
  - cast to NapCatPluginContext

src/core/state-infra/plugin_state_context_adapter.ts
  - action + params + adapter + config 四参数调用
  - adapterName/networkConfig 状态

package.json
  - napcat-types
  - build:napcat
```

因此当前真实结构是：

```text
OneBot WebSocket/SnowLuma
  -> 伪造 NapCatPluginContext
  -> 原 NapCat 插件生命周期
  -> GroupGuard 业务核心
```

### 3.3 OneBot 通用动作与宿主扩展必须分层

基础消息与群管理动作可作为 OneBot 通用能力，例如：

```text
get_login_info
send_group_msg
send_private_msg
delete_msg
set_group_ban
set_group_kick
get_group_member_info
get_group_list
get_group_member_list
```

以下群文件和历史动作不是 OneBot 11 核心统一标准，必须作为宿主能力处理：

```text
get_group_file_url
upload_group_file
delete_group_file
get_group_root_files
get_group_files_by_folder
get_group_msg_history
```

参数、分页、返回结构、`file_id`、`busid`、`folder_id` 和成功语义不能根据 NapCat 推断 SnowLuma，也不能假定未来所有 OneBot 框架完全一致。

## 4. 当前群文件故障及重要纠正

用户生产截图证明：目标群中存在实际未删除的群文件，而当前日志曾输出：

```text
absent>absent>absent
删除旧群文件已确认消失
```

因此当前删除核验存在误报。此前生成的以下热修复包基于 NapCat 接口假设，证据不足：

```text
GFM-DELETE-003
文件名：groupguard-gfm-delete-003-safe-deployment.zip
```

**禁止运行该包。**

不能把 NapCat 的 `delete_group_file` 参数要求直接套到 SnowLuma。后续必须基于 SnowLuma/OneBot WebSocket 的真实请求与原始响应修复，包括：

```text
删除前完整文件列表原始响应
实际 delete_group_file 请求参数
SnowLuma 原始动作响应
删除后完整文件列表原始响应
分页/目录字段
file_id/busid/folder_id 实际格式
返回结构无法识别时 fail-closed
```

完整剥离重构必须把该问题纳入宿主能力 Profile 和契约测试，禁止业务服务直接解析未经规范化的宿主响应。

## 5. 目标架构

最终目标：

```text
GroupGuard 业务核心
  -> GroupGuardRuntime
  -> OneBot 11 通用协议层
  -> Host Capability/Profile
       - SnowLumaProfile
       - GenericOneBotProfile
       - future profiles
  -> WebSocket transport
```

推荐目录：

```text
onebot-plugin-groupguard/src/
  core/
  runtime/
    groupguard_runtime.ts
    runtime_context.ts
    lifecycle.ts
  protocol/onebot11/
    types.ts
    events.ts
    event_normalizer.ts
    action_client.ts
    response_normalizer.ts
  transport/websocket/
    onebot_ws_client.ts
  hosts/
    host_profile.ts
    snowluma_profile.ts
    generic_onebot_profile.ts
  services/
  standalone/
    service.ts
    admin_server.ts
```

核心业务中不得再出现：

```text
NapCatPluginContext
NapCatConfig
pluginManager.config
napcat-types
NapCat 路由器 shim
NapCat 配置器 shim
```

## 6. 分阶段执行计划

### Phase 0：只读审查与基线冻结

任务：`OB-AUDIT-001`

1. 从当前 `main` 创建独立重构分支，建议：
   `refactor/remove-napcat-onebot-runtime-20260802`。
2. 记录基线提交、构建脚本、测试脚本和生产提交。
3. 全仓搜索所有 NapCat 类型、字段、运行时调用、配置、构建和文档引用。
4. 生成机器可读依赖清单，按以下类别分类：
   - 编译时类型依赖
   - 生命周期依赖
   - 动作调用依赖
   - 事件类型依赖
   - WebUI/路由依赖
   - 构建与发布依赖
   - 仅命名遗留
5. 审查所有直接调用 OneBot 扩展动作的业务服务。
6. 第一阶段只提交审查报告和执行计划，不修改生产。

交付：

```text
docs/OB_NAPCAT_DEPENDENCY_AUDIT_001.md
docs/OB_NAPCAT_DEPENDENCY_AUDIT_001.json
docs/OB_NAPCAT_REFACTOR_PLAN_001.md
```

### Phase 1：建立 GroupGuard 自有运行时契约

任务：`OB-RUNTIME-001`

新增：

```text
RuntimeLogger
RuntimePaths
OneBotActionClient
GroupGuardRuntimeContext
GroupGuardLifecycle
```

业务层只允许依赖 `GroupGuardRuntimeContext`，禁止继续依赖宿主插件上下文。

### Phase 2：抽离核心生命周期

任务：`OB-CORE-001`

把通用初始化和清理逻辑从 `src/index.ts` 提取为：

```text
initializeGroupGuard(runtime)
handleGroupGuardMessage(event)
handleGroupGuardEvent(event)
shutdownGroupGuard()
```

保留配置、数据库、授权、问答、查询、群管、队列、风控和 WebUI 业务。

### Phase 3：统一 OneBot 动作与事件边界

任务：`OB-PROTOCOL-001`

1. 所有动作统一为：
   `call(action, params)`。
2. 移除 `adapter/config` 四参数传递。
3. 定义项目自有 OneBot 事件类型。
4. 在入口处规范化事件，业务服务不得直接依赖 SnowLuma/NapCat 原始事件变体。
5. 原始响应必须先通过 response normalizer 或 capability adapter。

### Phase 4：建立宿主能力 Profile

任务：`OB-HOST-PROFILE-001`

建立：

```text
SnowLumaProfile
GenericOneBotProfile
```

Profile 至少声明和实现：

```text
self message event support
message history support
group file list support
group file upload support
group file delete support
group file URL support
folder/pagination support
response shape normalization
capability unavailable behavior
```

群文件服务只能调用能力接口，不允许直接调用或解析宿主扩展动作。

### Phase 5：SnowLuma 直接接入新运行时

任务：`OB-SNOWLUMA-001`

重写当前 SnowLuma 启动器：

1. 直接创建 `GroupGuardRuntimeContext`。
2. 删除 `createStandaloneContext()` NapCat shim。
3. 继续使用 OneBot WebSocket 客户端、自动重连、身份刷新和 WebUI。
4. 环境变量标准化为：

```text
ONEBOT_WS_URL
ONEBOT_ACCESS_TOKEN
ONEBOT_ACTION_TIMEOUT_MS
ONEBOT_RECONNECT_DELAY_MS
ONEBOT_HOST_PROFILE=snowluma
```

旧 `SNOWLUMA_*` 变量可短期作为迁移别名，但不得进入业务核心。

### Phase 6：删除 NapCat 入口和依赖

任务：`OB-NAPCAT-REMOVE-001`

删除：

```text
napcat-types
NapCatPluginContext
PluginModule
NapCatConfig
pluginManager.config
createNapCatConfigShim
createRouterShim
build:napcat
NapCat 专用入口导出
```

清理文档、脚本、测试、注释和包元数据中的失效 NapCat 声明。

### Phase 7：完整回归与通用 OneBot 契约测试

任务：`OB-REGRESSION-001`

必须验证：

```text
OneBot WS 连接、断线与自动重连
机器人身份刷新
普通群消息和私聊消息
notice/request/meta 事件
问答和主动回复
所有查询与图片发送
动态命令
违禁词、刷屏、名片、头衔、禁言、踢人、撤回
发送队列和自身消息撤回
配置加载、保存和损坏保护
SQLite 数据和迁移
WebUI 6108 全页面和 API
授权
Q群管家相关边界
群文件上传、列表、URL、删除、消息历史、分页、目录、重试和重启恢复
SnowLuma Profile 契约
Generic OneBot 模拟服务契约
```

群文件删除专项门槛：

```text
列表结构未知时不得判定 absent
动作响应未知时不得判定 success
无法确认删除时必须保留 pendingCleanup
测试必须覆盖“日志声称删除成功但文件仍存在”的回归场景
```

### Phase 8：文档、合并和安全生产迁移

任务：`OB-PRODUCTION-001`

合并和部署前必须满足：

```text
npm test 通过
纯 OneBot/SnowLuma 构建通过
无 napcat-types 依赖
无 NapCat 运行时代码
静态搜索门禁通过
所有核心功能回归通过
候选构建来源可验证
```

部署必须沿用已验证的安全流程：

```text
旧生产 ready=true
OneBot connected=true
bot identity known=true
候选离线验证
完整备份
原子切换
健康与来源验证
失败自动回滚
旧版本回滚后重新 ready 才算成功
```

## 7. 不可违反的执行约束

1. 不在生产目录直接开发或测试。
2. 不使用 Git pull/checkout 直接覆盖生产。
3. 不把群文件故障按 NapCat 文档或参数猜测修复。
4. 不在同一提交中混入无关功能。
5. 不删除用户配置、SQLite、状态文件或历史备份。
6. 不在完整回归前合并 `main`。
7. 不在完整回归前生成正式生产部署包。
8. 任何宿主返回结构未知时必须 fail-closed，不得误报成功。
9. 生产继续运行 `d0b79b6e`，直到新候选通过全部门槛。

## 8. 完成定义

只有同时满足以下条件才算完整剥离：

```text
代码和依赖中不存在 napcat-types
运行时不再创建或接收 NapCatPluginContext
SnowLuma 启动不再伪造 NapCatConfig/pluginManager/router
动作调用不再传 adapter/config
核心事件类型不再从 napcat-types 导入
构建和测试不再包含 build:napcat
SnowLuma 通过纯 OneBot WS 运行
Generic OneBot 模拟宿主通过核心契约
现有生产功能完整回归
群文件扩展动作通过 SnowLuma Profile 处理
安全部署和回滚验证成功
```

仅重命名文件或保留 NapCat shim 不算完成。

## 9. 新聊天第一步

新聊天不得直接开始大面积改代码。先执行：

1. 读取：
   - `docs/CURRENT_TASK_STATE.json`
   - `docs/NEXT_CHAT_HANDOFF.md`
   - `docs/ONEBOT_NAPCAT_DECOUPLING_REFACTOR_HANDOFF_20260802.md`
   - `docs/PROJECT_IDENTITY.md`
2. 核对当前 `main`、生产提交和工作树。
3. 创建独立重构分支。
4. 完成 `OB-AUDIT-001` 全仓依赖审查。
5. 输出准确的文件级改造计划、风险矩阵和验收矩阵。
6. 审查报告确认后按 Phase 1 开始执行，逐阶段提交和验证。

## 10. 新聊天启动语句

```text
继续 GroupGuard 项目，按仓库 docs/CURRENT_TASK_STATE.json、docs/NEXT_CHAT_HANDOFF.md 和 docs/ONEBOT_NAPCAT_DECOUPLING_REFACTOR_HANDOFF_20260802.md 开始 OB-NAPCAT-DECOUPLING-001。先完成全仓只读审查和机器可读规划，再在独立分支执行完整剥离 NapCat：建立纯 OneBot 运行时、SnowLuma Profile 和 Generic OneBot Profile，完整回归后再合并和安全部署。禁止运行 GFM-DELETE-003，禁止依据 NapCat 参数推断 SnowLuma 扩展接口。
```
