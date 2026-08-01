# GroupGuard 当前任务交接

更新时间：2026-08-02 03:04 +08:00  
状态：`napcat_decoupling_approved_pending_audit`

## 当前主任务

任务 ID：

```text
OB-NAPCAT-DECOUPLING-001
```

用户已确认执行完整重构：

```text
完整剥离 NapCat
保留并强化纯 OneBot WebSocket 运行方式
当前宿主为 SnowLuma
未来允许接入其他第三方 OneBot WebSocket 框架
```

详细交接与执行计划：

```text
docs/ONEBOT_NAPCAT_DECOUPLING_REFACTOR_HANDOFF_20260802.md
```

## 当前生产基线

```text
Production commit: d0b79b6eab2514492196036bd79f14819b2d4102
Container: groupguard-snowluma
Remote app: /mnt/sda1/groupguard/app
OneBot WebSocket: ws://127.0.0.1:3001
Upstream container: snowluma
WebUI: 6108
Backup: /mnt/sda1/groupguard/backups/project-wide-bugfix-d0b79b6e-20260801T133634Z
Report: /mnt/sda1/groupguard/backups/project-wide-bugfix-d0b79b6e-20260801T133634Z/deployment-report.txt
```

生产版本已通过：

```text
UPSTREAM_READINESS_PRECHECK_OK=true
CANDIDATE_VALIDATION_OK=true
BACKUP_CAPTURE_OK=true
SWITCH_OK=true
HEALTH_OK=true
PROVENANCE_OK=true
DEPLOYMENT_OK=true
```

重构完成并通过完整回归前，生产继续运行该版本。

## 已确认的架构事实

当前外部连接已经是 OneBot WebSocket：

```text
GroupGuard -> ws://127.0.0.1:3001 -> SnowLuma -> QQ
```

但内部仍通过伪造的 NapCat 上下文复用旧插件入口：

```text
SnowLuma OneBot WS
  -> createStandaloneContext
  -> fake NapCatPluginContext/NapCatConfig/pluginManager/router
  -> src/index.ts NapCat 生命周期
  -> GroupGuard 业务
```

主要 NapCat 绑定点：

```text
src/index.ts
src/standalone/standalone_context.ts
src/core/state-infra/plugin_state_context_adapter.ts
package.json -> napcat-types/build:napcat
```

当前目标不是改成 SnowLuma 私有插件，而是：

```text
纯 OneBot 11 WebSocket 核心
+ SnowLuma Host Profile
+ Generic OneBot Profile
```

基础消息和群管动作可走通用 OneBot；群文件、消息历史等扩展动作必须由宿主 Profile 规范化，不得跨框架猜参数或返回结构。

## 群文件故障状态

用户截图证明：目标群存在实际未删除文件，但 GroupGuard 日志曾错误输出：

```text
absent>absent>absent
删除旧群文件已确认消失
```

因此当前删除核验存在误报。

此前生成的：

```text
GFM-DELETE-003
groupguard-gfm-delete-003-safe-deployment.zip
```

基于 NapCat 接口假设，证据不足，**禁止运行**。

后续必须记录 SnowLuma 的真实 OneBot 请求和原始响应，再在 Host Profile 中修复：

```text
删除前完整文件列表
实际删除请求参数
原始动作响应
删除后完整文件列表
分页、目录、file_id、busid、folder_id
未知结构 fail-closed
```

## 新聊天执行顺序

1. 读取：
   - `docs/CURRENT_TASK_STATE.json`
   - `docs/NEXT_CHAT_HANDOFF.md`
   - `docs/ONEBOT_NAPCAT_DECOUPLING_REFACTOR_HANDOFF_20260802.md`
   - `docs/PROJECT_IDENTITY.md`
2. 核对 `main`、生产提交和工作树。
3. 从当前 `main` 创建独立分支，建议：

```text
refactor/remove-napcat-onebot-runtime-20260802
```

4. 先完成 `OB-AUDIT-001`：全仓只读依赖审查、文件级清单、风险矩阵、验收矩阵和机器可读执行计划。
5. 审查完成后再按阶段执行：

```text
OB-RUNTIME-001
OB-CORE-001
OB-PROTOCOL-001
OB-HOST-PROFILE-001
OB-SNOWLUMA-001
OB-NAPCAT-REMOVE-001
OB-REGRESSION-001
OB-PRODUCTION-001
```

6. 完整回归前禁止合并、部署或修改生产。

## 完成门槛

```text
无 napcat-types
无 NapCatPluginContext
无 NapCatConfig/pluginManager shim
无 adapter/config 四参数动作调用
SnowLuma 直接接入 GroupGuardRuntime
纯 OneBot WS 运行通过
SnowLuma Profile 契约通过
Generic OneBot 模拟契约通过
全部现有功能回归通过
群文件误报删除回归测试通过
安全部署和回滚验证通过
```

## 新聊天启动语句

```text
继续 GroupGuard 项目，按仓库 docs/CURRENT_TASK_STATE.json、docs/NEXT_CHAT_HANDOFF.md 和 docs/ONEBOT_NAPCAT_DECOUPLING_REFACTOR_HANDOFF_20260802.md 开始 OB-NAPCAT-DECOUPLING-001。先完成全仓只读审查和机器可读规划，再在独立分支执行完整剥离 NapCat：建立纯 OneBot 运行时、SnowLuma Profile 和 Generic OneBot Profile，完整回归后再合并和安全部署。禁止运行 GFM-DELETE-003，禁止依据 NapCat 参数推断 SnowLuma 扩展接口。
```
