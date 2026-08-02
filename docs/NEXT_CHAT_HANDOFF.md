# GroupGuard 下一步交接

更新时间：2026-08-02 15:41 +08:00  
已完成任务：`OB-NAPCAT-DECOUPLING-001`

## 最终结论

NapCat 运行时剥离已经完成开发、完整回归、不可变候选构建、生产安全部署、操作者实机验证和主分支合并。

PR #30 已标记 Ready 并合并到 `main`：

```text
merge commit: 0838c546b186cb5d588397efdaf35053b0766b8b
```

生产当前运行：

```text
commit: 8c049a0b6bb5fab5ca65ce77050e021c468f1a84
container: groupguard-snowluma
ready: true
OneBot connected: true
bot: 755396669
Host Profile: snowluma
```

生产运行提交与仓库 merge commit 不同是正常的：`8c049a0b...` 是经过不可变候选验证并实际部署的代码提交；其后的提交只增加生产验收和状态文档，最后由 `0838c546...` 合并进 `main`，没有追加生产代码变化。

操作者测试机器人后确认生产正常，没有感到用户侧行为变化。这符合本次任务目标：本次是运行时架构重构，不是业务功能改版。

## 生产部署结果

```text
CANDIDATE_VALIDATION_OK=true
BACKUP_CAPTURE_OK=true
SWITCH_OK=true
HEALTH_OK=true
DEPLOYMENT_OK=true
```

生产备份：

```text
backups/ob-napcat-decoupling-001-20260802-153053-e20fde3d
```

部署状态：

```text
deployment-state/OB-NAPCAT-DECOUPLING-001-latest.json
```

首次健康探测在容器启动期间返回一次 `ECONNREFUSED 127.0.0.1:6108`，自动重试后通过，没有触发自动回滚。

## 代码层变化

```text
删除 napcat-types 依赖和 NapCat shim
删除 NapCat Plugin Context / PluginModule / NapCatConfig 运行时绑定
删除四参数 Action 调用状态和 build:napcat
新增 GroupGuard 自有 OneBot 事件类型
新增两参数 OneBot Action Client
新增 GroupGuard Runtime Context
新增 SnowLumaProfile
新增 GenericOneBotProfile
SnowLuma 启动器直接创建 GroupGuard Runtime
群文件和消息历史扩展动作统一通过 Host Profile
未知 SnowLuma 群文件列表/删除响应返回 indeterminate
未知响应不确认删除成功、不确认文件不存在，并保留重试状态
```

## 为什么用户侧没有明显变化

查询、问答、风控、群管理、WebUI、SQLite 配置和 OneBot 连接方式的业务行为没有被重做。改变的是内部依赖方向：以前核心代码通过 NapCat 类型和伪造上下文运行；现在核心代码只依赖 GroupGuard 自有协议，SnowLuma 作为明确的 Host Profile 接入。

因此正常情况下，群成员和管理员不应看到命令格式或回复结果变化。

## 已通过验证

```text
workflow 30717036168 / job 91414108890: success
npm ci: passed
npm test: passed
npm run build:onebot: passed
npm run build:snowluma: passed
CI 30717204473: success
Build 30717204475: success
Audit 30717204512: success
Pre-merge docs CI 30738196132: success
Pre-merge docs Build 30738196144: success
活动 NapCat runtime bindings: 0
四参数 action calls: 0
生产实机验证: passed_user_reported
PR #30: merged
```

## 安全状态

```text
GFM-DELETE-003: 未运行
NapCat 参数推断 SnowLuma 扩展动作: 未使用
未知响应策略: fail-closed，保留重试状态
自动回滚入口: 已保留
生产备份: 已保留
```

## 后续规则

`OB-NAPCAT-DECOUPLING-001` 已关闭。后续功能、Host Profile 扩展或群文件动作研究必须创建新任务 ID，不得继续改写本任务的已验收结论。

生产备份和一键回滚状态至少保留到下一次稳定发布周期结束。

## 参考

- `docs/OB_NAPCAT_PRODUCTION_ACCEPTANCE_001.md`
- `docs/OB_NAPCAT_PRODUCTION_ACCEPTANCE_001.json`
- `docs/OB_NAPCAT_REFACTOR_EXECUTION_STATE_001.json`
- `docs/CURRENT_TASK_STATE.json`
