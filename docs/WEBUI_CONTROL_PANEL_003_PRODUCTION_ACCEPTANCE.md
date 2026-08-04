# WEBUI-CONTROL-PANEL-003 生产发布与验收记录

更新时间：2026-08-05 04:13 +08:00

## 最终结论

`WEBUI-CONTROL-PANEL-003` 已完成开发、浏览器验收、合并、生产部署和生产健康检查，任务关闭。

```text
task: WEBUI-CONTROL-PANEL-003
PR: #35
merge commit: 6b30b6cf04822893189c931e2419a1f1d9251de2
production source commit: fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
previous production commit: 7446e4f8225e5c3aff6f2e168acdad16d7b8e8d0
production container: groupguard-snowluma
production app: /mnt/sda1/groupguard/app
result: passed
```

## 发布前验证

生产候选从合并后的 `main` 精确构建，隔离 worktree 中通过：

```text
npm ci
verify:webui-ios-glass
npm test
TypeScript typecheck
架构门禁
OneBot 运行时边界
SnowLuma build
node --check
```

候选信息：

```text
candidate files: 362
candidate archive sha256: b66ab1ee97de3be0b87a123893ed49e73ae3350df1dd7dfb00e7829b72bed780
deployment bundle sha256: 62e5d85d1e09583dac8d27f2eae9ef4736d27d5ef12d033309ca30380df20e8a
```

## 生产预检

切换前生产状态：

```text
commit: 7446e4f8225e5c3aff6f2e168acdad16d7b8e8d0
ready: true
OneBot connected: true
bot id: 755396669
host profile: snowluma
```

## 备份

发布前完整备份：

```text
/mnt/sda1/groupguard/backups/webui-control-panel-003-20260804-200018-fa4f4a38f859
```

备份覆盖原 `dist`、配置、数据、容器信息、日志、健康状态和文件哈希。备份及回滚入口至少保留到下一次稳定发布周期结束。

## 发布过程

### v2

远端宿主系统没有 Node，脚本在生产预检前停止。生产未切换。

### v3

候选验证和备份通过，并完成原子切换。新版本首次健康探测尚处于启动重试阶段时，Windows PowerShell 5.1 把 SSH stderr 当成终止错误，导致客户端会话提前断开。生产目标版本随后正常启动，但发布状态尚未完成落盘。

### v4

使用 resume-safe 流程识别到目标版本已经运行：

```text
RECONCILE_OBSERVED_COMMIT=fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
RECONCILED_EXISTING_TARGET=true
```

随后重新执行候选哈希验证、控制台健康检查并补齐发布状态和回滚入口，没有重复覆盖未知版本。

## 最终生产验收

最终成功标记：

```text
PREFLIGHT_OK=true
CANDIDATE_VALIDATION_OK=true
BACKUP_CAPTURE_OK=true
SWITCH_OK=true
HEALTH_OK=true
WEBUI_CONTROL_PANEL_OK=true
DEPLOYMENT_OK=true
RESUME_FINALIZATION_OK=true
```

最终运行状态：

```text
running commit: fa4f4a38f85962ba787c5bf9541426d9a5a57ad2
ready: true
OneBot connected: true
bot id: 755396669
host profile: snowluma
unified control-panel markers: passed
```

生产状态文件：

```text
/mnt/sda1/groupguard/app/deployment-state/WEBUI-CONTROL-PANEL-003-latest.json
```

本地部署状态：

```text
deployment-state/deployment-state-20260805-041003.json
```

手动回滚入口：

```text
ROLLBACK-GROUPGUARD.cmd
```

## 发布安全结论

- 生产源来自已合并 `main`。
- 候选逐文件哈希验证通过。
- 切换前备份已创建。
- 目标提交、readiness、OneBot、机器人账号和控制台标记均通过。
- 后端 API、WebUI Token、业务控件 ID、配置保存和运行时刷新契约未改变。
- 回滚状态和旧版本备份已保留。

## 后续

本任务已关闭。后续页面组件拆分、依赖治理或构建警告处理应使用新的任务 ID，不再继续扩展 `WEBUI-CONTROL-PANEL-003`。
