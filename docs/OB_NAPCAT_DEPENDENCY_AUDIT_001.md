# OB-AUDIT-001：GroupGuard 全仓 NapCat 依赖审查

更新时间：2026-08-02 03:40 +08:00  
任务：`OB-NAPCAT-DECOUPLING-001`  
分支：`refactor/remove-napcat-onebot-runtime-20260802`

## 1. 审查基线与边界

- `main`：`45a4bff4443b137638d008082910a9db5a441772`
- 生产：`d0b79b6eab2514492196036bd79f14819b2d4102`
- 审查快照：`8c27c539eef365ceccc91c30f61705b79d4a8880`
- GitHub Actions 审查运行：`30714678707`
- 审查归档：`8822957965`
- 跟踪文件：758 个

本阶段只读取仓库并生成依赖清单。生产目录、容器、配置、SQLite、镜像状态和备份均未修改。

固定约束：

```text
禁止运行 GFM-DELETE-003
禁止根据 NapCat 参数推断 SnowLuma 扩展动作
未知宿主响应必须 fail-closed
无法确认删除时必须保留 pendingCleanup/重试状态
完整回归前禁止合并和部署
```

## 2. 审查结论

GroupGuard 对外已经使用 OneBot WebSocket：

```text
GroupGuard -> OneBot WebSocket -> SnowLuma -> QQ
```

但内部仍然是 NapCat 插件运行时：

```text
SnowLuma 启动器
  -> createStandaloneContext
  -> 伪造 NapCatPluginContext / NapCatConfig / pluginManager / router
  -> src/index.ts 的 NapCat 生命周期
  -> GroupGuard 业务服务
```

因此不能只删除 `napcat-types`。必须先建立 GroupGuard 自有运行时、OneBot 协议边界与 Host Profile，再逐步迁移生命周期、事件、动作、路由和构建。

量化结果：

| 项目 | 数量 |
|---|---:|
| 直接导入 NapCat 类型的生产文件 | 35 |
| NapCat 类型导入行 | 50 |
| 四参数动作调用 | 7 |
| 宿主扩展动作引用行 | 18 |
| 运行时绑定文件 | 44 |

## 3. 已确认绑定点

### 3.1 生命周期

- `onebot-plugin-groupguard/src/index.ts`
- `onebot-plugin-groupguard/src/standalone/standalone_context.ts`
- `onebot-plugin-groupguard/src/standalone/snowluma_service.ts`

`src/index.ts` 同时负责初始化、配置、数据库、授权、定时器、路由、消息、事件和清理；SnowLuma 启动器通过伪造 NapCat 上下文复用该入口。

### 3.2 动作调用与共享状态

主要文件：

- `src/core/state-infra/plugin_state_context_adapter.ts`
- `src/state.ts`
- `src/index.ts`
- `src/runtime/runtime_routes.ts`
- `src/services/qun_guanjia_service.ts`
- `src/services/action_guard_service.ts`
- `src/join_verifier.ts`

已确认的四参数调用位置：

```text
src/state.ts:947
src/state.ts:966
src/index.ts:219
src/runtime/runtime_routes.ts:331
src/services/qun_guanjia_service.ts:281
src/core/state-infra/plugin_state_context_adapter.ts:182
src/core/state-infra/plugin_state_context_adapter.ts:184
```

当前动作包装器仍保存 `adapterName` 和 `networkConfig`，并调用：

```text
call(action, params, adapter, config)
```

目标必须统一为：

```text
call(action, params)
```

但发送包装、Q群管家路由、风险包装、发送队列和自身撤回不能被绕过。

### 3.3 事件类型

消息、命令、动态命令和服务层共有 35 个文件直接依赖 NapCat 类型。核心入口包括：

- `src/runtime/runtime_message_pipeline.ts`
- `src/runtime/runtime_event_pipeline.ts`
- `src/commands.ts`
- `src/commands/dispatcher.ts`
- `src/commands/modules/*.ts`
- `src/dynamic-commands/*.ts`
- `src/services/command_service_types.ts`

必须改为项目自有的宽松 OneBot 事件类型，并在入口处规范化；不得把 SnowLuma 或未来宿主的原始变体直接扩散到业务层。

### 3.4 WebUI 与路由

- `src/index.ts`
- `src/runtime/runtime_routes.ts`
- `src/standalone/standalone_context.ts`
- `src/standalone/admin/types.ts`

当前独立模式使用空路由 shim，而真实 WebUI 由独立管理服务器承载。重构后需要明确的 `RuntimeRouter`/管理服务器契约，保留全部配置保存、补丁、健康检查和页面 API。

### 3.5 构建与发布

- `package.json`：包含 `napcat` 元数据、`napcat-types`、`build:napcat`
- `package-lock.json`：锁定 `napcat-types`
- `tsconfig.json`：映射本地 NapCat shim
- `vite.config.ts`：默认入口仍为 `src/index.ts`
- `scripts/build-all-clean.mjs`：先构建 NapCat release
- `.github/workflows/plugin-release.yml`：保留 NapCat 发布假设

这些都属于实际运行/发布绑定，不是单纯命名遗留。

## 4. 宿主扩展动作

审查确认以下动作不是可直接假定跨宿主一致的 OneBot 11 核心能力：

```text
get_group_file_url
upload_group_file
delete_group_file
get_group_root_files
get_group_files_by_folder
get_group_msg_history
```

集中位置：

- `src/services/group_file_mirror_service.ts`
- `src/services/group_file_mirror_message_adapter.ts`
- `src/services/qun_guanjia_service.ts`
- `src/standalone/admin/qun_guanjia_page.ts`
- `src/standalone/snowluma_service.ts`

群文件业务必须改为调用 Host Profile 能力接口，不能直接解释原始宿主响应。

## 5. 群文件删除专项结论

当前证据已经证明旧核验会产生误报：文件仍在群文件库中，日志却输出 `absent>absent>absent` 和“删除已确认”。

SnowLuma 的实际删除和列表语义尚未取得完整协议证据。重构必须采集：

```text
删除前完整列表原始响应
实际 delete_group_file 参数
原始动作响应
删除后完整列表原始响应
分页与目录元数据
file_id / busid / folder_id 实际格式
```

在证据齐全前：

- 未识别的列表结构不能判定 `absent`；
- 未识别的动作响应不能判定成功；
- 文件仍存在时不能清除待清理状态；
- 无法确认时必须返回 `indeterminate` 并保留重试。

## 6. 风险矩阵

| 风险 | 等级 | 控制 |
|---|---|---|
| 生命周期迁移改变初始化顺序 | 严重 | 单一幂等 Runtime 生命周期、事件缓冲、失败复位、身份刷新测试 |
| 未知 SnowLuma 文件响应被当作成功 | 严重 | Profile 边界、原始证据、严格规范化、未知即关闭式失败 |
| 两参数动作迁移绕过发送包装/队列 | 高 | 统一 RuntimeActionClient，发送、Q群管家、队列、自撤回专项回归 |
| 自有事件类型丢失宿主字段 | 高 | 宽松事件包、入口规范化、保留 raw、message_sent 测试 |
| 路由抽离破坏 WebUI | 高 | RuntimeRouter 契约、全 API 和保存路径回归 |
| 清理旧构建留下陈旧产物 | 中 | 清空 dist、单一 OneBot 构建、静态无 NapCat 门禁 |

## 7. 完成门槛

```text
无 napcat-types 依赖、导入、tsconfig 映射和活动 shim
无 NapCatPluginContext / PluginModule / NapCatConfig / pluginManager.config
无 adapter/config 四参数动作调用
SnowLuma 启动器直接创建 GroupGuardRuntimeContext
纯 OneBot WebSocket 运行时契约通过
SnowLumaProfile 契约通过
GenericOneBotProfile 契约通过
未知群文件列表/删除响应 fail-closed
pendingCleanup 在无法确认时保留
现有 npm test 全部通过
OneBot 与 SnowLuma 构建通过
完整回归前不合并、不部署
```

机器可读版本见 `docs/OB_NAPCAT_DEPENDENCY_AUDIT_001.json`。
